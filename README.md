# Siscon — Sistema de Honorários Orgacon

Migração do Siscon (Base44) para código próprio: React + Supabase + Vercel, com integração ao Asaas.

## Estrutura
- `supabase/schema.sql` — tabelas, segurança (RLS) e numeração de recibos
- `scripts/gerar_importacao.py` — converte o backup JSON do Base44 em `supabase/importacao.sql`

## Dados
O backup (`dados/`) e o SQL de importação contêm dados de clientes e **não são versionados** (ver `.gitignore`).
