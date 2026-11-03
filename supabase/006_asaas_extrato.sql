-- 006 — Importação do extrato OFX do Asaas (recebimentos passados) e vínculo de cliente pelo nome
-- Idempotente: pode rodar mais de uma vez. Rodar no Supabase → SQL Editor depois do 005.
--
-- • recibos.asaas_fatura: nº da fatura do Asaas ("fatura nr." do extrato = invoiceNumber da API).
--   Impede baixar a mesma fatura duas vezes, venha ela do extrato ou do aviso automático (webhook).
-- • clientes.asaas_nome: nome do cliente no Asaas, gravado na 1ª importação; nas próximas o Siscon reconhece sozinho.
-- • asaas_baixar_extrato(...): baixa SEM recibo de uma fatura do extrato, com os itens escolhidos na prévia,
--   juros/multa do Asaas como "Juros/Multa Asaas" (juros recebido).

alter table recibos add column if not exists asaas_fatura text;
create unique index if not exists recibos_asaas_fatura_uidx on recibos (asaas_fatura)
  where asaas_fatura is not null and not cancelado;
alter table clientes add column if not exists asaas_nome text;

create or replace function asaas_baixar_extrato(
  p_fatura text, p_cliente_id uuid, p_data date, p_itens jsonb, p_juros numeric default 0, p_nome_asaas text default null
) returns recibos
language plpgsql as $$
declare r recibos; c clientes; v_comp date;
begin
  if exists (select 1 from recibos where asaas_fatura = p_fatura and not cancelado) then
    raise exception 'A fatura % do Asaas já foi baixada', p_fatura;
  end if;
  select * into c from clientes where id = p_cliente_id;
  if not found then raise exception 'Cliente não encontrado'; end if;

  r := registrar_recebimento(p_cliente_id, p_data, 'Boleto', p_itens, null, null,
                             'Baixa Asaas (extrato) — fatura ' || p_fatura, false);
  if coalesce(p_juros, 0) > 0 then
    select max(competencia) into v_comp from recibo_itens where recibo_id = r.id;
    insert into recibo_itens (recibo_id, tipo, descricao, valor, competencia, cliente_id, cliente_nome)
    values (r.id, 'Juros/Multa Asaas', 'Juros e multa recebidos pelo Asaas', round(p_juros, 2), v_comp, c.id, c.razao_social);
  end if;
  update recibos set valor = valor + round(coalesce(p_juros, 0), 2), asaas_fatura = p_fatura where id = r.id returning * into r;
  if nullif(trim(p_nome_asaas), '') is not null then
    update clientes set asaas_nome = null where asaas_nome = trim(p_nome_asaas) and id <> p_cliente_id;
    update clientes set asaas_nome = trim(p_nome_asaas) where id = p_cliente_id;
  end if;
  return r;
end $$;

-- Aviso automático (webhook) também reconhece faturas já baixadas pelo extrato
create or replace function asaas_processar(p_id text) returns asaas_eventos
language plpgsql as $$
declare
  e asaas_eventos; p jsonb; c clientes; r recibos; it record;
  v_comp date; v_valor numeric; v_base numeric; v_juros numeric; v_resto numeric; v_pag numeric; v_desc numeric;
  v_data date; v_metodo text; v_rid uuid; v_itens jsonb := '[]'; v_aviso text := null;
begin
  select * into e from asaas_eventos where id = p_id for update;
  if not found then raise exception 'Evento % não encontrado', p_id; end if;
  if e.status in ('processado', 'ignorado') then return e; end if;
  p := e.payload->'payment';

  begin
    -- Estorno / pagamento desfeito no Asaas → cancela a baixa
    if e.evento in ('PAYMENT_REFUNDED', 'PAYMENT_RECEIVED_IN_CASH_UNDONE', 'PAYMENT_CHARGEBACK_DONE') then
      select id into v_rid from recibos where asaas_payment_id = e.payment_id and not cancelado;
      if v_rid is null then
        update asaas_eventos set status = 'ignorado', mensagem = 'Não havia baixa ativa deste pagamento', processado_em = now()
        where id = e.id returning * into e;
      else
        perform estornar_recibo(v_rid, 'Estorno no Asaas (' || e.evento || ')');
        update asaas_eventos set status = 'processado', recibo_id = v_rid, mensagem = 'Baixa cancelada: pagamento estornado no Asaas', processado_em = now()
        where id = e.id returning * into e;
      end if;
      return e;
    end if;

    if e.evento not in ('PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED') then
      update asaas_eventos set status = 'ignorado', mensagem = 'Evento não tratado', processado_em = now() where id = e.id returning * into e;
      return e;
    end if;

    -- Já baixado (ex.: CONFIRMED e depois RECEIVED do mesmo pagamento)
    select id into v_rid from recibos where not cancelado
      and (asaas_payment_id = e.payment_id or asaas_fatura = nullif(p->>'invoiceNumber', ''));
    if v_rid is not null then
      update asaas_eventos set status = 'ignorado', recibo_id = v_rid, mensagem = 'Pagamento já baixado', processado_em = now()
      where id = e.id returning * into e;
      return e;
    end if;

    select * into c from clientes where asaas_customer_id = e.customer_id order by status = 'Ativo' desc limit 1;
    if not found then
      update asaas_eventos set status = 'pendente', mensagem = 'Cliente do Asaas ainda não vinculado a um cliente do Siscon' where id = e.id returning * into e;
      return e;
    end if;

    v_valor := round(coalesce(nullif(p->>'value', '')::numeric, e.valor, 0), 2);
    v_base  := round(coalesce(nullif(p->>'originalValue', '')::numeric, v_valor), 2);   -- valor antes de juros/multa do Asaas
    v_juros := greatest(0, v_valor - v_base);
    v_comp  := (date_trunc('month', e.vencimento) - interval '1 month')::date;
    v_data  := coalesce(e.data_pagamento, current_date);
    v_metodo := case p->>'billingType' when 'BOLETO' then 'Boleto' when 'PIX' then 'Pix' when 'CREDIT_CARD' then 'Cartão' else 'Pix/Boleto' end;
    v_resto := v_base;

    -- 1) Honorário da competência do boleto: baixa integral
    for it in select id, saldo, juros_calc from v_honorarios
              where cliente_id = c.id and competencia = v_comp and saldo > 0 loop
      v_pag := least(v_resto, it.saldo);
      v_desc := it.saldo - v_pag;
      if v_desc > coalesce(it.juros_calc, 0) + 1.00 then
        update asaas_eventos set status = 'pendente',
          mensagem = format('Boleto (%s) menor que o honorário de %s (saldo %s). Conferir e baixar manualmente.',
                            brl(v_base), to_char(v_comp, 'MM/YYYY'), brl(it.saldo))
        where id = e.id returning * into e;
        return e;
      end if;
      v_itens := v_itens || jsonb_build_object('tipo', 'honorario', 'id', it.id, 'valor', v_pag, 'desconto', v_desc);
      v_resto := v_resto - v_pag;
    end loop;

    -- 2) Despesas extras da mesma competência; 3) sobra vai para os itens em aberto mais antigos
    for it in
      select * from (
        select 'despesa' tipo, d.id, d.saldo, 1 ordem, d.competencia, d.data dt from v_despesas d
          where d.cliente_id = c.id and d.competencia = v_comp and d.saldo > 0
        union all
        select 'honorario', h.id, h.saldo, 2, h.competencia, h.vencimento from v_honorarios h
          where h.cliente_id = c.id and h.competencia < v_comp and h.saldo > 0
        union all
        select 'despesa', d.id, d.saldo, 2, d.competencia, d.data from v_despesas d
          where d.cliente_id = c.id and d.competencia < v_comp and d.saldo > 0
      ) x order by ordem, competencia, tipo desc, dt
    loop
      exit when v_resto <= 0.009;
      v_pag := least(v_resto, it.saldo);
      v_itens := v_itens || jsonb_build_object('tipo', it.tipo, 'id', it.id, 'valor', v_pag);
      v_resto := v_resto - v_pag;
    end loop;

    if jsonb_array_length(v_itens) = 0 then
      update asaas_eventos set status = 'pendente',
        mensagem = format('Nenhum débito em aberto do cliente até a competência %s. Conferir.', to_char(v_comp, 'MM/YYYY'))
      where id = e.id returning * into e;
      return e;
    end if;

    r := registrar_recebimento(c.id, v_data, v_metodo, v_itens, null, null,
                               'Baixa automática Asaas — cobrança ' || e.payment_id, false);

    -- Juros/multa do Asaas (juros recebido) e eventual valor excedente
    if v_juros > 0 then
      insert into recibo_itens (recibo_id, tipo, descricao, valor, competencia, cliente_id, cliente_nome)
      values (r.id, 'Juros/Multa Asaas', 'Juros e multa recebidos pelo Asaas', v_juros, v_comp, c.id, c.razao_social);
    end if;
    if v_resto > 0.009 then
      insert into recibo_itens (recibo_id, tipo, descricao, valor, competencia, cliente_id, cliente_nome)
      values (r.id, 'Excedente Asaas', 'Valor pago acima dos débitos em aberto', round(v_resto, 2), v_comp, c.id, c.razao_social);
      v_aviso := format('Baixado, mas sobrou %s acima dos débitos em aberto. Conferir.', brl(v_resto));
    end if;
    update recibos set valor = valor + v_juros + greatest(0, round(v_resto, 2)), asaas_payment_id = e.payment_id,
      asaas_fatura = nullif(p->>'invoiceNumber', '')
    where id = r.id;

    update asaas_eventos set status = 'processado', recibo_id = r.id, processado_em = now(),
      mensagem = coalesce(v_aviso, 'Baixa registrada' || case when v_juros > 0 then ' (com juros/multa do Asaas)' else '' end)
    where id = e.id returning * into e;
    return e;

  exception when others then
    update asaas_eventos set status = 'erro', mensagem = sqlerrm where id = p_id returning * into e;
    return e;
  end;
end $$;

grant execute on function asaas_baixar_extrato(text, uuid, date, jsonb, numeric, text) to authenticated;
revoke execute on function asaas_baixar_extrato(text, uuid, date, jsonb, numeric, text) from anon, public;
