-- Siscon — boletos do Asaas importados da planilha "Cobranças" (rodar depois do 008). Seguro rodar de novo.
-- A planilha não traz o id "pay_..." nem o "cus_...": a linha importada fica com payment_id = 'fatura:<nº>'
-- e, quando chega o 1º aviso do webhook desse boleto (mesmo nº de fatura), ela passa a usar o id real.
-- Nesse momento o cliente é vinculado sozinho pelo CPF/CNPJ (se houver um único cliente com esse documento).

alter table asaas_cobrancas add column if not exists cliente_nome text;   -- nome no Asaas (planilha)
alter table asaas_cobrancas add column if not exists cpf_cnpj     text;   -- só dígitos (planilha)
create index if not exists asaas_cobrancas_fatura on asaas_cobrancas (fatura);

create or replace function asaas_registrar_cobranca(p jsonb, p_evento text) returns void
language plpgsql as $$
declare v_status text; v_doc text; v_cli uuid;
begin
  if p is null or coalesce(p->>'id', '') = '' then return; end if;
  v_status := case when p_evento = 'PAYMENT_DELETED' or p->>'deleted' = 'true' then 'DELETED'
                   else coalesce(nullif(p->>'status', ''), case p_evento when 'PAYMENT_RECEIVED' then 'RECEIVED' when 'PAYMENT_CONFIRMED' then 'CONFIRMED'
                        when 'PAYMENT_REFUNDED' then 'REFUNDED' when 'PAYMENT_OVERDUE' then 'OVERDUE' else 'PENDING' end) end;

  -- boleto importado da planilha: assume o id real do Asaas
  if coalesce(p->>'invoiceNumber', '') <> '' and not exists (select 1 from asaas_cobrancas where payment_id = p->>'id') then
    update asaas_cobrancas set payment_id = p->>'id'
    where payment_id = 'fatura:' || (p->>'invoiceNumber');
  end if;

  insert into asaas_cobrancas as a (payment_id, customer_id, valor, vencimento, status, data_pagamento, descricao, fatura, forma, ultimo_evento, atualizado_em)
  values (p->>'id', p->>'customer', nullif(p->>'value', '')::numeric, nullif(p->>'dueDate', '')::date, v_status,
          coalesce(nullif(p->>'clientPaymentDate', ''), nullif(p->>'paymentDate', ''), nullif(p->>'confirmedDate', ''))::date,
          p->>'description', p->>'invoiceNumber', p->>'billingType', p_evento, now())
  on conflict (payment_id) do update set
    customer_id = coalesce(excluded.customer_id, a.customer_id), valor = excluded.valor, vencimento = excluded.vencimento,
    descricao = excluded.descricao, fatura = coalesce(excluded.fatura, a.fatura), forma = excluded.forma,
    data_pagamento = coalesce(excluded.data_pagamento, a.data_pagamento),
    -- aviso atrasado não "despaga" um boleto pago (só estorno/desfazer muda de pago para aberto)
    status = case when a.status in ('RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH') and excluded.status in ('PENDING', 'OVERDUE')
                   and p_evento not in ('PAYMENT_REFUNDED', 'PAYMENT_RECEIVED_IN_CASH_UNDONE', 'PAYMENT_CHARGEBACK_DONE', 'PAYMENT_RESTORED')
                  then a.status else excluded.status end,
    ultimo_evento = excluded.ultimo_evento, atualizado_em = now();

  -- vínculo automático do cliente pelo CPF/CNPJ que veio da planilha
  select cpf_cnpj into v_doc from asaas_cobrancas where payment_id = p->>'id';
  if coalesce(p->>'customer', '') <> '' and coalesce(v_doc, '') <> ''
     and not exists (select 1 from clientes where asaas_customer_id = p->>'customer') then
    select min(id::text)::uuid into v_cli from clientes
    where regexp_replace(coalesce(cnpj, ''), '\D', '', 'g') = v_doc and asaas_customer_id is null
    having count(*) = 1;
    if v_cli is not null then update clientes set asaas_customer_id = p->>'customer' where id = v_cli; end if;
  end if;
end $$;

revoke execute on function asaas_registrar_cobranca(jsonb, text) from anon, authenticated, public;
grant execute on function asaas_registrar_cobranca(jsonb, text) to service_role;
