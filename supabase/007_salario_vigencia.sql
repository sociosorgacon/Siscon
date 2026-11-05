-- Siscon — salário mínimo por vigência (rodar depois do 006). Seguro rodar de novo.
-- Cada competência usa o salário vigente nela: ex. salário novo com vigência 01/01/2027
-- vale para a competência 01/2027 em diante; a 12/2026 (gerada em janeiro) usa o anterior.

create table if not exists salarios_minimos (
  vigencia   date primary key,          -- sempre dia 1 do mês
  valor      numeric(12,2) not null check (valor > 0),
  criado_em  timestamptz not null default now(),
  criado_por text default (auth.jwt() ->> 'email')
);
alter table salarios_minimos enable row level security;
drop policy if exists "logados" on salarios_minimos;
create policy "logados" on salarios_minimos for all to authenticated using (true) with check (true);

-- Converte a vigência gravada em Configurações (AAAA-MM-DD ou DD/MM/AAAA) para o dia 1 do mês
create or replace function vigencia_para_data(p text) returns date
language sql immutable as $$
  select date_trunc('month', case when p ~ '^\d{4}-\d{2}-\d{2}' then left(p, 10)::date
                                  when p ~ '^\d{2}/\d{2}/\d{4}' then to_date(left(p, 10), 'DD/MM/YYYY') end)::date
$$;

-- Primeiro registro: o salário que já está em Configurações
insert into salarios_minimos (vigencia, valor)
select coalesce(vigencia_para_data(cfg('vigencia_salario')), date '2000-01-01'), cfg('salario_minimo')::numeric
where nullif(cfg('salario_minimo'), '')::numeric > 0
  and not exists (select 1 from salarios_minimos);

-- Salário vigente numa competência (antes do 1º registro, usa o mais antigo)
create or replace function salario_vigente(p_competencia date) returns numeric
language sql stable as $$
  select coalesce(
    (select valor from salarios_minimos where vigencia <= date_trunc('month', p_competencia) order by vigencia desc limit 1),
    (select valor from salarios_minimos order by vigencia limit 1),
    nullif(cfg('salario_minimo'), '')::numeric)
$$;

-- Gerar honorários: agora com o salário vigente na competência
create or replace function gerar_honorarios(p_competencia date) returns int
language plpgsql as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
  v_sm numeric := salario_vigente(v_comp);
  v_prox date := (date_trunc('month', p_competencia) + interval '1 month')::date;
  v_ultimo int := extract(day from (v_prox + interval '1 month - 1 day'))::int;
  n int;
begin
  insert into honorarios (cliente_id, competencia, juros_desde, vencimento, valor_original, juros, valor_atualizado, status, calcular_juros)
  select c.id, v_comp, v_comp,
         make_date(extract(year from v_prox)::int, extract(month from v_prox)::int, least(c.dia_vencimento, v_ultimo)),
         round(v_sm * c.percentual_honorario / 100, 2), 0, round(v_sm * c.percentual_honorario / 100, 2),
         'Pendente', true
  from clientes c
  where c.status = 'Ativo' and c.percentual_honorario > 0
  on conflict (cliente_id, competencia) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function salario_vigente(date), vigencia_para_data(text) to authenticated;
revoke execute on function salario_vigente(date), vigencia_para_data(text) from anon, public;

select to_char(vigencia, 'MM/YYYY') as vigencia, valor from salarios_minimos order by vigencia;
