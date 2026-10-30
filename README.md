# Siscon — Sistema de Honorários Orgacon

React + Supabase + Vercel. Migrado do Base44 em 10/2026.

## Banco (Supabase → SQL Editor), nesta ordem
1. `supabase/schema.sql` — tabelas e segurança (RLS)
2. importação dos dados (gerada por `scripts/gerar_importacao.py`, não versionada)
3. `supabase/002_regras.sql` — cálculo de juros, geração de honorários, recebimento e estorno
4. `supabase/003_ajustes.sql` — regras do manual: atraso por competência, multa/juros 1,55% fixo, baixa sem recibo, despesas fixas

## Regras de negócio
- Honorário = salário mínimo × % do cliente; vencimento no mês seguinte à competência, no dia do cliente.
- Juros simples de 1,55% a.m. (fixo) sobre o valor original, por mês de competência em atraso, só para clientes com multa por atraso.
- Atrasado = competência anterior à competência atual (competência atual ou futura é sempre Pendente).
- Baixa com recibo (numerado) ou sem recibo (ex.: boleto); baixa integral quita com a diferença como desconto.
- "Avançar competência" abre o novo mês e gera os honorários dos clientes ativos.
- Recebimento gera recibo numerado e dá baixa (parcial ou total, com desconto opcional).
- Cancelar recibo não apaga nada: marca como cancelado e devolve os itens para "em aberto".

## Rodar localmente
```
npm install
npm run dev
```

## Dados
Backup e SQL de importação contêm dados de clientes e **não são versionados**.
