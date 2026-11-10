-- Siscon — restaurar um backup (rodar depois do 015). Seguro rodar de novo.
-- Chamada pela tela Configurações → "Restaurar backup", que ANTES baixa um backup do estado atual (para poder desfazer).
--
-- Tudo numa transação só: se qualquer tabela falhar, nada muda.
-- p_tabelas = tabelas a substituir (as que vieram no backup sem erro); as demais ficam como estão.
-- Colunas que não existem no backup (backup antigo) ficam com o valor padrão da tabela.
-- A numeração de recibos NUNCA volta para trás: o próximo número continua do maior já usado (atual ou do backup).

create or replace function restaurar_backup(p_backup jsonb, p_tabelas text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  -- ordem para apagar (filhas antes das mães) e para gravar (mães antes das filhas)
  ordem_apagar text[] := array['recibo_itens', 'asaas_eventos', 'recibos', 'certificados_cobrados', 'despesas_fixas', 'despesas',
                               'honorarios', 'clientes', 'asaas_cobrancas', 'salarios_minimos', 'configuracoes'];
  ordem_gravar text[] := array['configuracoes', 'salarios_minimos', 'clientes', 'honorarios', 'despesas', 'despesas_fixas',
                               'recibos', 'recibo_itens', 'asaas_eventos', 'asaas_cobrancas', 'certificados_cobrados'];
  obrigatorias text[] := array['configuracoes', 'clientes', 'honorarios', 'despesas', 'recibos', 'recibo_itens'];
  t text; colunas text; n int; ultimo bigint; chamado boolean; maior bigint; resultado jsonb := '{}';
begin
  if auth.uid() is null then raise exception 'Restauração permitida só para usuário logado.'; end if;
  if p_tabelas is null or cardinality(p_tabelas) = 0 then raise exception 'Nenhuma tabela para restaurar.'; end if;
  foreach t in array p_tabelas loop
    if not (t = any(ordem_gravar)) then raise exception 'Tabela desconhecida no backup: %', t; end if;
    if jsonb_typeof(p_backup -> t) is distinct from 'array' then raise exception 'O backup não tem a tabela %.', t; end if;
  end loop;
  foreach t in array obrigatorias loop
    if not (t = any(p_tabelas)) then raise exception 'Backup incompleto: falta a tabela % (restauração recusada).', t; end if;
  end loop;
  if jsonb_array_length(p_backup -> 'clientes') = 0 then raise exception 'Backup sem clientes: restauração recusada.'; end if;

  select last_value, is_called into ultimo, chamado from recibo_numero_seq;

  foreach t in array ordem_apagar loop
    if t = any(p_tabelas) then execute format('delete from %I', t); end if;
  end loop;

  foreach t in array ordem_gravar loop
    continue when not (t = any(p_tabelas));
    -- só as colunas da tabela que aparecem no backup (as outras ficam com o padrão)
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into colunas
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = t and c.is_generated = 'NEVER'
      and c.column_name in (select distinct k from jsonb_array_elements(p_backup -> t) e, jsonb_object_keys(e) k);
    n := 0;
    if colunas is not null and jsonb_array_length(p_backup -> t) > 0 then
      execute format('insert into %I (%s) select %s from jsonb_populate_recordset(null::%I, $1)', t, colunas, colunas, t)
        using p_backup -> t;
      get diagnostics n = row_count;
    end if;
    resultado := resultado || jsonb_build_object(t, n);
  end loop;

  -- próximo recibo = maior número já usado + 1 (nunca reaproveita número de recibo já entregue)
  maior := greatest(case when chamado then ultimo else 0 end, coalesce((select max(numero) from recibos), 0));
  if maior > 0 then perform setval('recibo_numero_seq', maior, true); else perform setval('recibo_numero_seq', 1, false); end if;
  return resultado;
end $$;

revoke execute on function restaurar_backup(jsonb, text[]) from public, anon;
grant execute on function restaurar_backup(jsonb, text[]) to authenticated;

select 'restaurar_backup instalada' as ok;
