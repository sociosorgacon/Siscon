-- 004 — Recibo único para vários clientes
-- Idempotente: pode rodar mais de uma vez. Rodar no Supabase → SQL Editor depois do 003_ajustes.sql.
-- Cada item do recibo passa a guardar a empresa a que se refere (cópia histórica do nome).

alter table recibo_itens add column if not exists cliente_id uuid references clientes(id);
alter table recibo_itens add column if not exists cliente_nome text;
create index if not exists recibo_itens_cliente_idx on recibo_itens (cliente_id);

-- Preenche os itens já existentes a partir do honorário/despesa (ou do próprio recibo)
update recibo_itens i set cliente_id = coalesce(
    (select h.cliente_id from honorarios h where h.id = i.honorario_id),
    (select d.cliente_id from despesas d where d.id = i.despesa_id),
    (select r.cliente_id from recibos r where r.id = i.recibo_id))
where i.cliente_id is null;
update recibo_itens i set cliente_nome = c.razao_social
from clientes c where c.id = i.cliente_id and i.cliente_nome is null;

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
  -- Recibo único (vários clientes): o front envia o nome/CNPJ de todos; senão usa o cadastro do cliente
  if p_cliente_id is not null and nullif(trim(v_nome), '') is null then
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
      insert into recibo_itens (recibo_id, tipo, descricao, valor, desconto, competencia, honorario_id, cliente_id, cliente_nome)
      values (r.id, 'Honorário Contábil', 'Honorários — Competência ' || to_char(h.competencia, 'MM/YYYY'), v, desc_, h.competencia, h.id,
              h.cliente_id, (select razao_social from clientes where id = h.cliente_id));

    elsif it->>'tipo' = 'despesa' then
      select * into d from despesas where id = (it->>'id')::uuid for update;
      if not found then raise exception 'Despesa não encontrada'; end if;
      if v + desc_ > d.valor - d.valor_pago + 0.009 then raise exception 'Valor maior que o saldo da despesa "%"', d.descricao; end if;
      update despesas set
        valor_pago = valor_pago + v + desc_, data_pagamento = p_data, metodo_pagamento = p_metodo,
        status = case when valor_pago + v + desc_ >= valor - 0.009 then 'Pago' else 'Pago Parcial' end
      where id = d.id;
      insert into recibo_itens (recibo_id, tipo, descricao, valor, desconto, competencia, despesa_id, cliente_id, cliente_nome)
      values (r.id, 'Despesa Extra', d.descricao, v, desc_, d.competencia, d.id,
              d.cliente_id, (select razao_social from clientes where id = d.cliente_id));

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

grant execute on function registrar_recebimento(uuid, date, text, jsonb, text, text, text, boolean) to authenticated;
revoke execute on function registrar_recebimento(uuid, date, text, jsonb, text, text, text, boolean) from anon, public;
