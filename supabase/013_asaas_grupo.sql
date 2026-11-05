-- Siscon — grupo do cliente no Asaas (Impressos, Acessórias, WhatsApp), só para mostrar no Siscon. Seguro rodar de novo.
-- O "dono" do grupo é o Asaas: o Siscon só lê (botão "Atualizar grupos do Asaas" em Clientes).
alter table clientes add column if not exists asaas_grupo text;
select count(*) as clientes from clientes;
