-- 005 — Baixa automática dos boletos pagos no Asaas (webhook)
-- Idempotente: pode rodar mais de uma vez. Rodar no Supabase → SQL Editor depois do 004.
--
-- Fluxo: Asaas avisa o pagamento → Edge Function "asaas-webhook" → asaas_receber_evento(payload)
--   → grava o evento (sem duplicar) → asaas_processar(evento):
--   • cliente: clientes.asaas_customer_id (se não houver vínculo, fica PENDENTE até vincular na tela)
--   • competência do boleto = mês anterior ao vencimento
--   • valor original do boleto quita o honorário da competência (baixa INTEGRAL: a diferença até o saldo,
--     limitada aos juros do Siscon + R$ 1,00, vira desconto) e depois as despesas da competência;
--     sobra → itens em aberto mais antigos
--   • juros/multa cobrados pelo Asaas entram no recibo como "Juros/Multa Asaas" (juros recebido)
--   • tarifas do Asaas não afetam a baixa (usa o valor bruto)
--   • baixa SEM recibo, data = data em que o cliente pagou; nunca baixa o mesmo pagamento duas vezes
--   • estorno no Asaas cancela a baixa (estornar_recibo)

alter table recibos add column if not exists asaas_payment_id text;
create unique index if not exists recibos_asaas_payment_uidx on recibos (asaas_payment_id)
  where asaas_payment_id is not null and not cancelado;
create index if not exists clientes_asaas_customer_idx on clientes (asaas_customer_id);

create table if not exists asaas_eventos (
  id             text primary key,               -- id do evento no Asaas (evita processar o mesmo aviso duas vezes)
  evento         text not null,                  -- PAYMENT_RECEIVED, PAYMENT_REFUNDED...
  payment_id     text,
  customer_id    text,
  valor          numeric(12,2),
  vencimento     date,
  data_pagamento date,
  descricao      text,
  payload        jsonb not null,
  status         text not null default 'pendente' check (status in ('processado','pendente','ignorado','erro')),
  mensagem       text,
  recibo_id      uuid references recibos(id),
  recebido_em    timestamptz not null default now(),
  processado_em  timestamptz
);
create index if not exists asaas_eventos_status_idx on asaas_eventos (status);
create index if not exists asaas_eventos_payment_idx on asaas_eventos (payment_id);
alter table asaas_eventos enable row level security;
drop policy if exists "logados" on asaas_eventos;
create policy "logados" on asaas_eventos for all to authenticated using (true) with check (true);

-- Valor no formato brasileiro para as mensagens (R$ 1234,56)
create or replace function brl(v numeric) returns text language sql immutable as
$$ select 'R$ ' || replace(to_char(round(v, 2), 'FM9999999990.00'), '.', ',') $$;

-- Processa (ou reprocessa) um evento já gravado
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
    select id into v_rid from recibos where asaas_payment_id = e.payment_id and not cancelado;
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
    update recibos set valor = valor + v_juros + greatest(0, round(v_resto, 2)), asaas_payment_id = e.payment_id
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

-- Grava o aviso do Asaas (sem duplicar) e processa. Chamado só pela Edge Function (service role).
create or replace function asaas_receber_evento(p_payload jsonb) returns asaas_eventos
language plpgsql as $$
declare v_id text; p jsonb := p_payload->'payment';
begin
  v_id := coalesce(nullif(p_payload->>'id', ''), (p_payload->>'event') || ':' || coalesce(p->>'id', md5(p_payload::text)));
  insert into asaas_eventos (id, evento, payment_id, customer_id, valor, vencimento, data_pagamento, descricao, payload)
  values (v_id, p_payload->>'event', p->>'id', p->>'customer', nullif(p->>'value', '')::numeric,
          nullif(p->>'dueDate', '')::date,
          coalesce(nullif(p->>'clientPaymentDate', ''), nullif(p->>'paymentDate', ''), nullif(p->>'confirmedDate', ''))::date,
          p->>'description', p_payload)
  on conflict (id) do nothing;
  return asaas_processar(v_id);
end $$;

-- Vincula o cliente do Asaas a um cliente do Siscon e reprocessa os pagamentos pendentes dele
create or replace function asaas_vincular_cliente(p_customer_id text, p_cliente_id uuid) returns int
language plpgsql as $$
declare n int := 0; v text;
begin
  update clientes set asaas_customer_id = null where asaas_customer_id = p_customer_id and id <> p_cliente_id;
  update clientes set asaas_customer_id = p_customer_id where id = p_cliente_id;
  for v in select id from asaas_eventos where customer_id = p_customer_id and status in ('pendente', 'erro') order by recebido_em loop
    perform asaas_processar(v); n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function asaas_receber_evento(jsonb) from anon, authenticated, public;
grant execute on function asaas_receber_evento(jsonb) to service_role;
grant execute on function asaas_processar(text), asaas_vincular_cliente(text, uuid) to authenticated;
revoke execute on function asaas_processar(text), asaas_vincular_cliente(text, uuid) from anon, public;
