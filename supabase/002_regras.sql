-- Siscon — regras de negócio (rodar depois do schema.sql)
-- Cálculos e operações ficam no banco: rápido, consistente e igual para os 3 usuários.

-- ---------- Ajustes de estrutura ----------
alter table honorarios   add column if not exists desconto numeric(12,2) not null default 0;
-- Competência a partir da qual os juros contam (normalmente a própria competência).
-- Na importação, preserva exatamente os juros que o Base44 já tinha calculado.
alter table honorarios   add column if not exists juros_desde date;
update honorarios set juros_desde = competencia where juros_desde is null;
update honorarios h set juros_desde = (comp_para_data_tmp.c - make_interval(months => round(h.juros / (h.valor_original * 0.0155))::int))::date
from (select to_date('01/' || valor, 'DD/MM/YYYY') c from configuracoes where chave = 'competencia_atual') comp_para_data_tmp
where h.status in ('Pendente','Atrasado') and h.calcular_juros and h.juros > 0 and h.valor_original > 0;
alter table honorarios   alter column juros_desde set not null;
alter table recibo_itens add column if not exists desconto numeric(12,2) not null default 0;
alter table recibos
  add column if not exists metodo_pagamento     text,
  add column if not exists observacao           text,
  add column if not exists cancelado            boolean not null default false,
  add column if not exists cancelado_em         timestamptz,
  add column if not exists motivo_cancelamento  text,
  add column if not exists criado_por           text default (auth.jwt() ->> 'email');

-- ---------- Funções auxiliares ----------
create or replace function cfg(p_chave text) returns text
language sql stable as $$ select valor from configuracoes where chave = p_chave $$;

create or replace function hoje() returns date
language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- 'MM/AAAA' -> date (dia 1)
create or replace function comp_para_data(p text) returns date
language sql immutable as $$ select to_date('01/' || p, 'DD/MM/YYYY') $$;

create or replace function ano_mes(d date) returns int
language sql immutable as $$ select (extract(year from d) * 12 + extract(month from d))::int $$;

-- ---------- Visão de honorários com juros calculados ----------
-- Juros simples: valor original × taxa mensal × meses entre a competência e a competência atual
-- (mesma regra do Base44, mas lendo a taxa da configuração — no Base44 a taxa configurada era ignorada).
create or replace view v_honorarios with (security_invoker = true) as
with p as (
  select comp_para_data(cfg('competencia_atual')) as comp_atual,
         coalesce(nullif(cfg('taxa_juros'), '')::numeric, 1.55) as taxa
), base as (
  select h.*, c.razao_social as cliente_nome, c.cnpj as cliente_cnpj, c.status as cliente_status,
         case when h.status in ('Pendente','Atrasado') and h.calcular_juros
              then greatest(0, ano_mes(p.comp_atual) - ano_mes(h.juros_desde)) else 0 end as meses_atraso,
         p.taxa
  from honorarios h join clientes c on c.id = h.cliente_id cross join p
), calc as (
  select b.*,
         case when b.status in ('Pendente','Atrasado') and b.calcular_juros
              then round(b.valor_original * b.taxa / 100 * b.meses_atraso, 2) else b.juros end as juros_calc
  from base b
)
select calc.*,
       calc.valor_original + calc.juros_calc as valor_atualizado_calc,
       greatest(0, calc.valor_original + calc.juros_calc - calc.valor_pago_acumulado - calc.desconto) as saldo,
       case when calc.status in ('Pago','Pago Parcial') then calc.status
            when calc.vencimento < hoje() then 'Atrasado' else 'Pendente' end as situacao
from calc;

create or replace view v_despesas with (security_invoker = true) as
select d.*, c.razao_social as cliente_nome, c.cnpj as cliente_cnpj,
       greatest(0, d.valor - d.valor_pago) as saldo
from despesas d join clientes c on c.id = d.cliente_id;

-- ---------- Gerar honorários de uma competência ----------
-- Valor = salário mínimo vigente × % do cliente; vencimento no mês seguinte, no dia do cliente.
create or replace function gerar_honorarios(p_competencia date) returns int
language plpgsql as $$
declare
  v_sm numeric := cfg('salario_minimo')::numeric;
  v_comp date := date_trunc('month', p_competencia)::date;
  v_prox date := (date_trunc('month', p_competencia) + interval '1 month')::date;
  v_ultimo int := extract(day from (v_prox + interval '1 month - 1 day'))::int;
  n int;
begin
  insert into honorarios (cliente_id, competencia, juros_desde, vencimento, valor_original, juros, valor_atualizado, status, calcular_juros)
  select c.id, v_comp, v_comp,
         make_date(extract(year from v_prox)::int, extract(month from v_prox)::int, least(c.dia_vencimento, v_ultimo)),
         round(v_sm * c.percentual_honorario / 100, 2), 0, round(v_sm * c.percentual_honorario / 100, 2),
         'Pendente', true
  from clientes c
  where c.status = 'Ativo' and c.percentual_honorario > 0
  on conflict (cliente_id, competencia) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- Registrar recebimento (gera recibo numerado) ----------
-- p_itens: [{"tipo":"honorario"|"despesa"|"avulso", "id":uuid, "valor":num, "desconto":num, "descricao":txt}]
create or replace function registrar_recebimento(
  p_cliente_id uuid, p_data date, p_metodo text, p_itens jsonb,
  p_cliente_nome text default null, p_cliente_cnpj text default null, p_observacao text default null
) returns recibos
language plpgsql as $$
declare
  r recibos; it jsonb; h record; d despesas; v numeric; desc_ numeric; total numeric := 0;
  v_nome text := p_cliente_nome; v_cnpj text := p_cliente_cnpj;
begin
  if jsonb_array_length(coalesce(p_itens, '[]')) = 0 then raise exception 'Nenhum item informado'; end if;
  if p_cliente_id is not null then
    select razao_social, cnpj into v_nome, v_cnpj from clientes where id = p_cliente_id;
  end if;
  if v_nome is null then raise exception 'Informe o cliente ou o nome do pagador'; end if;

  insert into recibos (cliente_id, cliente_nome, cliente_cnpj, valor, data_pagamento, metodo_pagamento, observacao)
  values (p_cliente_id, v_nome, v_cnpj, 0, p_data, p_metodo, p_observacao) returning * into r;

  for it in select * from jsonb_array_elements(p_itens) loop
    v := round(coalesce((it->>'valor')::numeric, 0), 2);
    desc_ := round(coalesce((it->>'desconto')::numeric, 0), 2);
    if v < 0 or desc_ < 0 or (v = 0 and desc_ = 0) then raise exception 'Valor inválido em um dos itens'; end if;

    if it->>'tipo' = 'honorario' then
      select * into h from v_honorarios where id = (it->>'id')::uuid;
      if not found then raise exception 'Honorário não encontrado'; end if;
      if v + desc_ > h.saldo + 0.009 then
        raise exception 'Valor maior que o saldo do honorário % (saldo %)', to_char(h.competencia, 'MM/YYYY'), h.saldo;
      end if;
      update honorarios set
        juros = h.juros_calc,
        valor_atualizado = h.valor_atualizado_calc,
        valor_pago = v,
        valor_pago_acumulado = valor_pago_acumulado + v,
        desconto = desconto + desc_,
        data_pagamento = p_data,
        metodo_pagamento = p_metodo,
        status = case when valor_pago_acumulado + v + desconto + desc_ >= h.valor_atualizado_calc - 0.009
                      then 'Pago' else 'Pago Parcial' end
      where id = h.id;
      insert into recibo_itens (recibo_id, tipo, descricao, valor, desconto, competencia, honorario_id)
      values (r.id, 'Honorário Contábil', 'Honorários — Competência ' || to_char(h.competencia, 'MM/YYYY'),
              v, desc_, h.competencia, h.id);

    elsif it->>'tipo' = 'despesa' then
      select * into d from despesas where id = (it->>'id')::uuid for update;
      if not found then raise exception 'Despesa não encontrada'; end if;
      if v + desc_ > d.valor - d.valor_pago + 0.009 then raise exception 'Valor maior que o saldo da despesa "%"', d.descricao; end if;
      update despesas set
        valor_pago = valor_pago + v + desc_,
        data_pagamento = p_data,
        metodo_pagamento = p_metodo,
        status = case when valor_pago + v + desc_ >= valor - 0.009 then 'Pago' else 'Pago Parcial' end
      where id = d.id;
      insert into recibo_itens (recibo_id, tipo, descricao, valor, desconto, competencia, despesa_id)
      values (r.id, 'Despesa Extra', d.descricao, v, desc_, d.competencia, d.id);

    elsif it->>'tipo' = 'avulso' then
      insert into recibo_itens (recibo_id, tipo, descricao, valor)
      values (r.id, 'Serviço Avulso', coalesce(nullif(it->>'descricao', ''), 'Serviço'), v);
    else
      raise exception 'Tipo de item inválido: %', it->>'tipo';
    end if;
    total := total + v;
  end loop;

  update recibos set valor = total where id = r.id returning * into r;
  return r;
end $$;

-- ---------- Estornar (cancelar) recibo — devolve os itens para "em aberto" ----------
create or replace function estornar_recibo(p_recibo_id uuid, p_motivo text) returns recibos
language plpgsql as $$
declare r recibos; i recibo_itens;
begin
  select * into r from recibos where id = p_recibo_id for update;
  if not found then raise exception 'Recibo não encontrado'; end if;
  if r.cancelado then raise exception 'Recibo já está cancelado'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do cancelamento'; end if;

  for i in select * from recibo_itens where recibo_id = r.id loop
    if i.honorario_id is not null then
      update honorarios set
        valor_pago_acumulado = greatest(0, valor_pago_acumulado - i.valor),
        desconto = greatest(0, desconto - i.desconto),
        status = case when valor_pago_acumulado - i.valor > 0.009 then 'Pago Parcial'
                      when vencimento < hoje() then 'Atrasado' else 'Pendente' end,
        data_pagamento = case when valor_pago_acumulado - i.valor > 0.009 then data_pagamento end
      where id = i.honorario_id;
    elsif i.despesa_id is not null then
      update despesas set
        valor_pago = greatest(0, valor_pago - i.valor - i.desconto),
        status = case when valor_pago - i.valor - i.desconto > 0.009 then 'Pago Parcial' else 'Pendente' end,
        data_pagamento = case when valor_pago - i.valor - i.desconto > 0.009 then data_pagamento end
      where id = i.despesa_id;
    end if;
  end loop;

  update recibos set cancelado = true, cancelado_em = now(), motivo_cancelamento = p_motivo
  where id = r.id returning * into r;
  return r;
end $$;

-- ---------- Avançar competência (gera os honorários do novo mês) ----------
create or replace function avancar_competencia() returns json
language plpgsql as $$
declare v_nova date := (comp_para_data(cfg('competencia_atual')) + interval '1 month')::date; n int;
begin
  update configuracoes set valor = to_char(v_nova, 'MM/YYYY'), updated_at = now() where chave = 'competencia_atual';
  n := gerar_honorarios(v_nova);
  return json_build_object('competencia', to_char(v_nova, 'MM/YYYY'), 'gerados', n);
end $$;

grant execute on function gerar_honorarios(date), registrar_recebimento(uuid, date, text, jsonb, text, text, text),
  estornar_recibo(uuid, text), avancar_competencia() to authenticated;
revoke execute on function gerar_honorarios(date), registrar_recebimento(uuid, date, text, jsonb, text, text, text),
  estornar_recibo(uuid, text), avancar_competencia() from anon, public;
