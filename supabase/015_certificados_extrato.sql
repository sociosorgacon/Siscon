-- Siscon — certificados digitais: valor líquido e conferência pelo extrato do Sicoob (rodar depois do 014). Seguro rodar de novo.
-- valor_liquido = o que fica para o escritório (entra no "Recebido no mês" do Painel) = recebido − custo da SIC (padrão: A1 PF 60,00 · A1 PJ 95,00).
-- custo         = valor pago à SIC Certificação Digital (aparece no extrato: 55,00 PF · 65,00 PJ).
-- extrato_ref   = crédito do extrato que quitou a cobrança; sic_ref = pagamento à SIC do extrato (nenhum dos dois é usado duas vezes).
alter table certificados_cobrados add column if not exists valor_liquido numeric(12,2);
alter table certificados_cobrados add column if not exists extrato_ref   text;
alter table certificados_cobrados add column if not exists sic_ref       text;
alter table certificados_cobrados add column if not exists custo         numeric(12,2);
update certificados_cobrados set valor_liquido = case tipo when 'A1 PF' then 60 when 'A1 PJ' then 95 else valor end
where valor_liquido is null;
create unique index if not exists certificados_cobrados_extrato on certificados_cobrados (extrato_ref) where extrato_ref is not null;
create unique index if not exists certificados_cobrados_sic on certificados_cobrados (sic_ref) where sic_ref is not null;
create index if not exists certificados_cobrados_pagamento on certificados_cobrados (data_pagamento) where pago;

select tipo, count(*) as qtd, sum(valor) as bruto, sum(valor_liquido) as liquido from certificados_cobrados group by tipo order by tipo;
