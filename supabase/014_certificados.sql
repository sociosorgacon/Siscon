-- Siscon — cobranças avulsas de Certificado Digital (rodar depois do 013). Seguro rodar de novo.
-- Controle à parte: NÃO entra em despesas, relatórios nem Painel.
create table if not exists certificados_cobrados (
  id             uuid primary key default gen_random_uuid(),
  data           date not null default current_date,      -- data da cobrança
  cliente_id     uuid references clientes(id) on delete set null,  -- vazio = nome digitado (não é cliente do Siscon)
  cliente_nome   text not null,
  cnpj           text,
  tipo           text not null,                            -- A1 PJ, A1 PF
  valor          numeric(12,2) not null,
  pago           boolean not null default false,
  data_pagamento date,
  observacoes    text,
  created_at     timestamptz not null default now()
);
create index if not exists certificados_cobrados_data on certificados_cobrados (data desc);
alter table certificados_cobrados enable row level security;
drop policy if exists "logados" on certificados_cobrados;
create policy "logados" on certificados_cobrados for all to authenticated using (true) with check (true);

select count(*) as certificados_cobrados from certificados_cobrados;
