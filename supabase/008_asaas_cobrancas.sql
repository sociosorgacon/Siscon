-- Siscon — situação dos boletos do Asaas no Painel (rodar depois do 007). Seguro rodar de novo.
-- Cada aviso do webhook atualiza a "foto" do boleto (a vencer, pago, vencido, excluído).
-- Para ter a lista completa, ativar no webhook do Asaas também: PAYMENT_CREATED, PAYMENT_UPDATED,
-- PAYMENT_OVERDUE, PAYMENT_DELETED e PAYMENT_RESTORED (esses só alimentam o Painel; não geram baixa).

create table if not exists asaas_cobrancas (
  payment_id     text primary key,
  customer_id    text,
  valor          numeric(12,2),
  vencimento     date,
  status         text,          -- status do Asaas: PENDING, OVERDUE, RECEIVED, CONFIRMED, RECEIVED_IN_CASH, REFUNDED, DELETED...
  data_pagamento date,
  descricao      text,
  fatura         text,
  forma          text,          -- BOLETO, PIX, CREDIT_CARD...
  ultimo_evento  text,
  atualizado_em  timestamptz not null default now()
);
create index if not exists asaas_cobrancas_venc on asaas_cobrancas (vencimento);
alter table asaas_cobrancas enable row level security;
drop policy if exists "logados" on asaas_cobrancas;
create policy "logados" on asaas_cobrancas for select to authenticated using (true);

-- Grava/atualiza o boleto a partir do "payment" de um aviso do Asaas
create or replace function asaas_registrar_cobranca(p jsonb, p_evento text) returns void
language plpgsql as $$
declare v_status text;
begin
  if p is null or coalesce(p->>'id', '') = '' then return; end if;
  v_status := case when p_evento = 'PAYMENT_DELETED' or p->>'deleted' = 'true' then 'DELETED'
                   else coalesce(nullif(p->>'status', ''), case p_evento when 'PAYMENT_RECEIVED' then 'RECEIVED' when 'PAYMENT_CONFIRMED' then 'CONFIRMED'
                        when 'PAYMENT_REFUNDED' then 'REFUNDED' when 'PAYMENT_OVERDUE' then 'OVERDUE' else 'PENDING' end) end;
  insert into asaas_cobrancas as a (payment_id, customer_id, valor, vencimento, status, data_pagamento, descricao, fatura, forma, ultimo_evento, atualizado_em)
  values (p->>'id', p->>'customer', nullif(p->>'value', '')::numeric, nullif(p->>'dueDate', '')::date, v_status,
          coalesce(nullif(p->>'clientPaymentDate', ''), nullif(p->>'paymentDate', ''), nullif(p->>'confirmedDate', ''))::date,
          p->>'description', p->>'invoiceNumber', p->>'billingType', p_evento, now())
  on conflict (payment_id) do update set
    customer_id = excluded.customer_id, valor = excluded.valor, vencimento = excluded.vencimento,
    descricao = excluded.descricao, fatura = excluded.fatura, forma = excluded.forma,
    data_pagamento = coalesce(excluded.data_pagamento, a.data_pagamento),
    -- aviso atrasado não "despaga" um boleto pago (só estorno/desfazer muda de pago para aberto)
    status = case when a.status in ('RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH') and excluded.status in ('PENDING', 'OVERDUE')
                   and p_evento not in ('PAYMENT_REFUNDED', 'PAYMENT_RECEIVED_IN_CASH_UNDONE', 'PAYMENT_CHARGEBACK_DONE', 'PAYMENT_RESTORED')
                  then a.status else excluded.status end,
    ultimo_evento = excluded.ultimo_evento, atualizado_em = now();
end $$;

-- Recebe o aviso: atualiza o boleto e, só nos eventos de pagamento/estorno, registra para a baixa automática
create or replace function asaas_receber_evento(p_payload jsonb) returns asaas_eventos
language plpgsql as $$
declare v_id text; p jsonb := p_payload->'payment'; v_ev text := p_payload->>'event';
begin
  perform asaas_registrar_cobranca(p, v_ev);
  if v_ev not in ('PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_REFUNDED', 'PAYMENT_RECEIVED_IN_CASH_UNDONE', 'PAYMENT_CHARGEBACK_DONE') then
    return null;  -- aviso só informativo (criado, alterado, vencido...): não entra na fila de baixas
  end if;
  v_id := coalesce(nullif(p_payload->>'id', ''), v_ev || ':' || coalesce(p->>'id', md5(p_payload::text)));
  insert into asaas_eventos (id, evento, payment_id, customer_id, valor, vencimento, data_pagamento, descricao, payload)
  values (v_id, v_ev, p->>'id', p->>'customer', nullif(p->>'value', '')::numeric,
          nullif(p->>'dueDate', '')::date,
          coalesce(nullif(p->>'clientPaymentDate', ''), nullif(p->>'paymentDate', ''), nullif(p->>'confirmedDate', ''))::date,
          p->>'description', p_payload)
  on conflict (id) do nothing;
  return asaas_processar(v_id);
end $$;

revoke execute on function asaas_receber_evento(jsonb), asaas_registrar_cobranca(jsonb, text) from anon, authenticated, public;
grant execute on function asaas_receber_evento(jsonb), asaas_registrar_cobranca(jsonb, text) to service_role;

-- Aproveita os avisos que já chegaram
do $$
declare e record;
begin
  for e in select payload from asaas_eventos order by recebido_em loop
    perform asaas_registrar_cobranca(e.payload->'payment', e.payload->>'event');
  end loop;
end $$;

select status, count(*) as boletos, sum(valor) as total from asaas_cobrancas group by status order by status;
