-- Siscon — esquema do banco (Supabase / PostgreSQL)
-- Rodar uma vez no SQL Editor do Supabase.

create extension if not exists pgcrypto;

-- Configurações (salário mínimo, juros, competência atual)
create table configuracoes (
  chave      text primary key,
  valor      text not null,
  descricao  text,
  updated_at timestamptz not null default now()
);

-- Clientes
create table clientes (
  id                    uuid primary key default gen_random_uuid(),
  legacy_id             text unique,            -- id do Base44
  cnpj                  text not null,
  razao_social          text not null,
  nome_fantasia         text,
  email                 text,
  telefone              text,
  logradouro            text,
  municipio             text,
  uf                    char(2),
  situacao              text,                   -- situação cadastral (ATIVA, BAIXADA, PARALISADA...)
  status                text not null default 'Ativo' check (status in ('Ativo','Inativo')),
  percentual_honorario  numeric(8,2) not null default 0,  -- % do salário mínimo
  dia_vencimento        smallint not null default 7 check (dia_vencimento between 1 and 31),
  multa_por_atraso      boolean not null default false,
  asaas_customer_id     text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on clientes (cnpj);

-- Honorários mensais
create table honorarios (
  id                    uuid primary key default gen_random_uuid(),
  legacy_id             text unique,
  cliente_id            uuid not null references clientes(id),
  competencia           date not null,          -- sempre dia 1 do mês (ex.: 2026-09-01 = 09/2026)
  vencimento            date not null,
  valor_original        numeric(12,2) not null,
  juros                 numeric(12,2) not null default 0,
  valor_atualizado      numeric(12,2) not null,
  status                text not null check (status in ('Pendente','Atrasado','Pago Parcial','Pago')),
  calcular_juros        boolean not null default true,
  valor_pago            numeric(12,2),
  valor_pago_acumulado  numeric(12,2) not null default 0,
  data_pagamento        date,
  metodo_pagamento      text,
  observacao            text,
  asaas_payment_id      text unique,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (cliente_id, competencia)
);
create index on honorarios (status);
create index on honorarios (competencia);

-- Despesas extras (IRPF, alterações, serviços avulsos)
create table despesas (
  id                uuid primary key default gen_random_uuid(),
  legacy_id         text unique,
  cliente_id        uuid not null references clientes(id),
  descricao         text not null,
  valor             numeric(12,2) not null,
  data              date not null,
  competencia       date not null,
  status            text not null check (status in ('Pendente','Pago Parcial','Pago')),
  valor_pago        numeric(12,2) not null default 0,
  data_pagamento    date,
  metodo_pagamento  text,
  observacoes       text,
  asaas_payment_id  text unique,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Recibos (numeração sequencial garantida pelo banco)
create sequence recibo_numero_seq;
create table recibos (
  id              uuid primary key default gen_random_uuid(),
  legacy_id       text unique,
  numero          integer unique default nextval('recibo_numero_seq'),  -- null = recibo antigo gerado sem número pela conciliação do Base44
  cliente_id      uuid references clientes(id),
  cliente_nome    text not null,               -- cópia histórica: o recibo emitido não muda
  cliente_cnpj    text,
  valor           numeric(12,2) not null,
  data_pagamento  date not null,
  created_at      timestamptz not null default now()
);

create table recibo_itens (
  id            uuid primary key default gen_random_uuid(),
  recibo_id     uuid not null references recibos(id) on delete cascade,
  tipo          text not null,                 -- 'Honorário Contábil' | 'Despesa Extra'
  descricao     text not null,
  valor         numeric(12,2) not null,
  competencia   date,
  honorario_id  uuid references honorarios(id),
  despesa_id    uuid references despesas(id)
);

-- updated_at automático
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger t_clientes   before update on clientes   for each row execute function set_updated_at();
create trigger t_honorarios before update on honorarios for each row execute function set_updated_at();
create trigger t_despesas   before update on despesas   for each row execute function set_updated_at();

-- Segurança: só usuários logados (cadastro público desativado no Supabase)
alter table configuracoes enable row level security;
alter table clientes enable row level security;
alter table honorarios enable row level security;
alter table despesas enable row level security;
alter table recibos enable row level security;
alter table recibo_itens enable row level security;

create policy "logados" on configuracoes for all to authenticated using (true) with check (true);
create policy "logados" on clientes for all to authenticated using (true) with check (true);
create policy "logados" on honorarios for all to authenticated using (true) with check (true);
create policy "logados" on despesas for all to authenticated using (true) with check (true);
create policy "logados" on recibos for all to authenticated using (true) with check (true);
create policy "logados" on recibo_itens for all to authenticated using (true) with check (true);
grant usage on sequence recibo_numero_seq to authenticated;
