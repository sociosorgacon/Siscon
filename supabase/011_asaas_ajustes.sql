-- Siscon — Etapa 2 do Asaas: ajuste do boleto em aberto com as despesas extras (rodar depois do 010). Seguro rodar de novo.
-- despesas.asaas_boleto_id = boleto do Asaas em que a despesa foi incluída (gravado quando você confirma o ajuste).
-- Só entram nos ajustes despesas com competência a partir de "asaas_ajuste_desde" (as anteriores já foram cobradas à mão).
alter table despesas add column if not exists asaas_boleto_id text;   -- (asaas_payment_id já existe, veio do Base44 e é único)
create index if not exists despesas_asaas_boleto on despesas (asaas_boleto_id);

insert into configuracoes (chave, valor, descricao)
select 'asaas_ajuste_desde', cfg('competencia_atual'), 'Competência a partir da qual as despesas extras entram nos ajustes de boletos do Asaas'
where not exists (select 1 from configuracoes where chave = 'asaas_ajuste_desde');

select chave, valor from configuracoes where chave in ('asaas_ajuste_desde', 'competencia_atual');
