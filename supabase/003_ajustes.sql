-- Siscon — ajustes conforme o Manual de Regras (rodar depois do 002_regras.sql)

-- ---------- Clientes: multa por atraso (padrão SIM) e vencimento padrão dia 10 ----------
-- No Base44, cliente sem a opção preenchida recebia juros. Só 7 tinham "não" marcado.
update clientes set multa_por_atraso = true
where legacy_id is null or legacy_id not in ('6ac406e2d0f23fc7ac9a15a6','6a8de6204305361a40fd2e9d','6a7f7b8588e2a386b2b7b4a5',
  '6a7f7ab2a243304f556e0457','6a1436d04f206f3e0252153d','6a1436d04f206f3e02521522','6a1436d04f206f3e02521521');
alter table clientes alter column multa_por_atraso set default true;
alter table clientes alter column dia_vencimento set default 10;

-- ---------- Configurações: dados do escritório; taxa de juros fixa em 1,55% ----------
insert into configuracoes (chave, valor, descricao) values
  ('escritorio_nome', 'Orgacon Contabilidade', 'Nome do escritório (recibo)'),
  ('escritorio_cnpj', '02.345.207/0001-23', 'CNPJ do escritório (recibo)'),
  ('escritorio_endereco', 'Rua José Roberto de Moraes, 23, Centro', 'Endereço do escritório (recibo)'),
  ('escritorio_cidade', 'Iúna/ES', 'Cidade/UF (local do recibo)'),
  ('escritorio_telefone', '', 'Telefone do escritório (recibo)')
on conflict (chave) do update set valor = excluded.valor where configuracoes.valor = '';
update configuracoes set valor = '1.55', descricao = 'Taxa de juros mensal (%) — fixa' where chave = 'taxa_juros';

-- ---------- Baixas com e sem recibo ----------
-- Toda baixa fica registrada (para poder cancelar). Só a "com recibo" recebe número.
alter table recibos add column if not exists com_recibo boolean not null default true;
alter table recibos alter column numero drop default;
update recibos set com_recibo = false where numero is null;   -- internos da conciliação do Base44 (nº 0)

-- Pago Parcial também acumula juros (regra do manual): preserva os juros que o Base44 já tinha calculado
update honorarios h set juros_desde = (comp_para_data(cfg('competencia_atual')) - make_interval(months => round(h.juros / (h.valor_original * 0.0155))::int))::date
where h.status = 'Pago Parcial' and h.calcular_juros and h.juros > 0 and h.valor_original > 0 and h.legacy_id is not null;

-- ---------- Visão de honorários (regras do manual) ----------
-- Atrasado = competência anterior à competência atual e não quitado.
-- Competência igual ou posterior à atual é sempre "Pendente".
-- Juros só para cliente com multa por atraso; taxa fixa 1,55% a.m.
drop view if exists v_honorarios;
create view v_honorarios with (security_invoker = true) as
with p as (select comp_para_data(cfg('competencia_atual')) as comp_atual, 1.55::numeric as taxa),
base as (
  select h.*, c.razao_social as cliente_nome, c.cnpj as cliente_cnpj, c.status as cliente_status,
         c.telefone as cliente_telefone, c.multa_por_atraso,
         case when h.status <> 'Pago' and h.calcular_juros and c.multa_por_atraso and h.competencia < p.comp_atual
              then greatest(0, ano_mes(p.comp_atual) - ano_mes(h.juros_desde)) else 0 end as meses_atraso,
         p.taxa, p.comp_atual
  from honorarios h join clientes c on c.id = h.cliente_id cross join p
), calc as (
  select b.*,
         case when b.status <> 'Pago'
              then round(b.valor_original * b.taxa / 100 * b.meses_atraso, 2) else b.juros end as juros_calc
  from base b
)
select calc.*,
       calc.valor_original + calc.juros_calc as valor_atualizado_calc,
       greatest(0, calc.valor_original + calc.juros_calc - calc.valor_pago_acumulado - calc.desconto) as saldo,
       case when calc.status = 'Pago' then 'Pago'
            when calc.status = 'Pago Parcial' then 'Pago Parcial'
            when calc.competencia < calc.comp_atual then 'Atrasado' else 'Pendente' end as situacao,
       calc.competencia < calc.comp_atual as em_atraso
from calc;

drop view if exists v_despesas;
create view v_despesas with (security_invoker = true) as
select d.*, c.razao_social as cliente_nome, c.cnpj as cliente_cnpj, c.telefone as cliente_telefone,
       greatest(0, d.valor - d.valor_pago) as saldo,
       d.competencia < comp_para_data(cfg('competencia_atual')) as em_atraso
from despesas d join clientes c on c.id = d.cliente_id;

-- ---------- Registrar baixa (com ou sem recibo) ----------
drop function if exists registrar_recebimento(uuid, date, text, jsonb, text, text, text);
create or replace function registrar_recebimento(
  p_cliente_id uuid, p_data date, p_metodo text, p_itens jsonb,
  p_cliente_nome text default null, p_cliente_cnpj text default null, p_observacao text default null,
  p_com_recibo boolean default true
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
  if not p_com_recibo and exists (select 1 from jsonb_array_elements(p_itens) e where e->>'tipo' = 'avulso') then
    raise exception 'Serviço avulso só pode ser baixado com recibo';
  end if;

  insert into recibos (numero, com_recibo, cliente_id, cliente_nome, cliente_cnpj, valor, data_pagamento, metodo_pagamento, observacao)
  values (case when p_com_recibo then nextval('recibo_numero_seq') end, p_com_recibo,
          p_cliente_id, v_nome, v_cnpj, 0, p_data, p_metodo, p_observacao) returning * into r;

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
        juros = h.juros_calc, valor_atualizado = h.valor_atualizado_calc,
        valor_pago = v, valor_pago_acumulado = valor_pago_acumulado + v, desconto = desconto + desc_,
        data_pagamento = p_data, metodo_pagamento = p_metodo,
        status = case when valor_pago_acumulado + v + desconto + desc_ >= h.valor_atualizado_calc - 0.009 then 'Pago' else 'Pago Parcial' end
      where id = h.id;
      insert into recibo_itens (recibo_id, tipo, descricao, valor, desconto, competencia, honorario_id)
      values (r.id, 'Honorário Contábil', 'Honorários — Competência ' || to_char(h.competencia, 'MM/YYYY'), v, desc_, h.competencia, h.id);

    elsif it->>'tipo' = 'despesa' then
      select * into d from despesas where id = (it->>'id')::uuid for update;
      if not found then raise exception 'Despesa não encontrada'; end if;
      if v + desc_ > d.valor - d.valor_pago + 0.009 then raise exception 'Valor maior que o saldo da despesa "%"', d.descricao; end if;
      update despesas set
        valor_pago = valor_pago + v + desc_, data_pagamento = p_data, metodo_pagamento = p_metodo,
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

-- Estorno: ao voltar a ficar em aberto, a situação (Atrasado/Pendente) é recalculada pela competência
create or replace function estornar_recibo(p_recibo_id uuid, p_motivo text) returns recibos
language plpgsql as $$
declare r recibos; i recibo_itens; v_atual date := comp_para_data(cfg('competencia_atual'));
begin
  select * into r from recibos where id = p_recibo_id for update;
  if not found then raise exception 'Baixa não encontrada'; end if;
  if r.cancelado then raise exception 'Esta baixa já está cancelada'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do cancelamento'; end if;

  for i in select * from recibo_itens where recibo_id = r.id loop
    if i.honorario_id is not null then
      update honorarios set
        valor_pago_acumulado = greatest(0, valor_pago_acumulado - i.valor),
        desconto = greatest(0, desconto - i.desconto),
        status = case when valor_pago_acumulado - i.valor > 0.009 then 'Pago Parcial'
                      when competencia < v_atual then 'Atrasado' else 'Pendente' end,
        data_pagamento = case when valor_pago_acumulado - i.valor > 0.009 then data_pagamento end,
        metodo_pagamento = case when valor_pago_acumulado - i.valor > 0.009 then metodo_pagamento end
      where id = i.honorario_id;
    elsif i.despesa_id is not null then
      update despesas set
        valor_pago = greatest(0, valor_pago - i.valor - i.desconto),
        status = case when valor_pago - i.valor - i.desconto > 0.009 then 'Pago Parcial' else 'Pendente' end,
        data_pagamento = case when valor_pago - i.valor - i.desconto > 0.009 then data_pagamento end,
        metodo_pagamento = case when valor_pago - i.valor - i.desconto > 0.009 then metodo_pagamento end
      where id = i.despesa_id;
    end if;
  end loop;

  update recibos set cancelado = true, cancelado_em = now(), motivo_cancelamento = p_motivo where id = r.id returning * into r;
  return r;
end $$;

-- ---------- Despesas fixas (recorrentes) ----------
create table if not exists despesas_fixas (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references clientes(id),
  descricao   text not null,
  valor       numeric(12,2) not null check (valor > 0),
  observacoes text,
  ativa       boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table despesas_fixas enable row level security;
drop policy if exists "logados" on despesas_fixas;
create policy "logados" on despesas_fixas for all to authenticated using (true) with check (true);

-- Gera as despesas fixas na competência informada (não duplica cliente + descrição + competência)
create or replace function gerar_despesas_fixas(p_competencia date) returns int
language plpgsql as $$
declare n int; v_comp date := date_trunc('month', p_competencia)::date;
begin
  insert into despesas (cliente_id, descricao, valor, data, competencia, status, observacoes)
  select f.cliente_id, f.descricao, f.valor, hoje(), v_comp, 'Pendente', f.observacoes
  from despesas_fixas f join clientes c on c.id = f.cliente_id
  where f.ativa and c.status = 'Ativo'
    and not exists (select 1 from despesas d where d.cliente_id = f.cliente_id and d.competencia = v_comp
                    and lower(trim(d.descricao)) = lower(trim(f.descricao)));
  get diagnostics n = row_count;
  return n;
end $$;

-- Avançar competência: abre o novo mês (juros dos atrasados passam a contar) e gera honorários + despesas fixas
create or replace function avancar_competencia() returns json
language plpgsql as $$
declare v_nova date := (comp_para_data(cfg('competencia_atual')) + interval '1 month')::date; n int; f int;
begin
  update configuracoes set valor = to_char(v_nova, 'MM/YYYY'), updated_at = now() where chave = 'competencia_atual';
  n := gerar_honorarios(v_nova);
  f := gerar_despesas_fixas(v_nova);
  return json_build_object('competencia', to_char(v_nova, 'MM/YYYY'), 'gerados', n, 'despesas_fixas', f);
end $$;

grant execute on function registrar_recebimento(uuid, date, text, jsonb, text, text, text, boolean),
  estornar_recibo(uuid, text), gerar_despesas_fixas(date), avancar_competencia() to authenticated;
revoke execute on function registrar_recebimento(uuid, date, text, jsonb, text, text, text, boolean),
  gerar_despesas_fixas(date) from anon, public;
