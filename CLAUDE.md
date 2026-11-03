# Siscon — Sistema de Honorários da Orgacon

Sistema interno da **Orgacon Consultoria Contábil** (Iúna/ES) para honorários contábeis, despesas extras, baixas/recibos e cobrança.
Migrado do Base44 (siscon.base44.app) em 30–31/10/2026. Usuários: o dono e os 2 sócios.

**Sempre responder em português do Brasil. Respostas claras e objetivas. Discordar e sugerir melhorias quando fizer sentido.**

## Stack e publicação
- **Front:** React 19 + Vite + TypeScript + Tailwind 4 (`src/`). Sem backend próprio: tudo via Supabase.
- **Banco/login:** Supabase (projeto `glffjwcikoyggdfuzgyw`, região São Paulo). RLS: só usuários logados. Cadastro público desativado; usuários criados em Authentication → Users.
- **Hospedagem:** Vercel, conectada ao GitHub `sociosorgacon/Siscon`. **Todo push na `main` publica sozinho** (~1 min).
- **Endereço:** https://siscon-tau.vercel.app/ (domínio próprio disponível: `orgaconcontabilidade.com.br`, sem site; sugerido `siscon.orgaconcontabilidade.com.br` via CNAME na Vercel — ao trocar, atualizar Site URL/Redirect URLs no Supabase Auth).
- URL e chave *publishable* do Supabase ficam em `src/lib/supabase.ts` (são públicas por natureza). **Nunca** colocar a secret/service_role key no código.

## Banco de dados (pasta `supabase/`)
Ordem de criação: `schema.sql` → importação → `002_regras.sql` → `003_ajustes.sql` → `004_recibo_unico.sql` (aplicado em 31/10/2026) → `005_asaas_baixa.sql`.
- Mudanças de banco **não** são aplicadas pelo push: gerar um script SQL **idempotente** e o usuário roda no Supabase → SQL Editor.
- Regras de negócio ficam no banco (views e funções), não no front:
  - `v_honorarios` / `v_despesas`: juros, saldo, situação, `em_atraso`.
  - `gerar_honorarios(competencia)`, `avancar_competencia()`, `gerar_despesas_fixas(competencia)`.
  - `registrar_recebimento(cliente, data, metodo, itens, nome, cnpj, obs, com_recibo)` e `estornar_recibo(id, motivo)`.
- Testar SQL num Postgres local antes de entregar (o Supabase avisa "destructive operations" quando há `drop`: é esperado).
- `dados/` (backup do Base44) e qualquer SQL com dados de clientes **não vão para o Git** (`.gitignore`).

## Regras de negócio (definidas pelo usuário — seguir à risca)
- **Honorário** = salário mínimo (config) × % do cliente. Vencimento = dia do cliente no **mês seguinte** à competência.
- **Juros:** fixos em **1,55% a.m.**, simples, sobre o valor original, por mês de competência em atraso. Só para clientes com **multa por atraso** (padrão = sim). Entram quando a competência avança. Juros importados do Base44 foram preservados via coluna `juros_desde`.
- **Atrasado** = competência **anterior** à competência atual e não quitado. Competência atual ou futura é sempre Pendente.
- **Baixas:** com recibo (numerado, sequência continua do Base44: próximo foi o 158) ou **sem recibo** (ex.: boleto pago — não gera recibo nem número). Baixa parcial, desconto e **baixa integral** (quita com a diferença registrada como desconto). Valor recebido distribuído do item mais antigo.
- **Recibo único (vários clientes):** em Receber, "+ Adicionar outro cliente". Um número só; "Recebemos de" lista as empresas com itens marcados e os CNPJ/CPF na mesma ordem ("respectivamente"); `recibo_itens.cliente_id/cliente_nome` guardam a empresa de cada item; no PDF os itens saem agrupados por cliente.
- **Cancelar baixa** não apaga: marca cancelado e devolve os itens para "em aberto".
- **Descrições padronizadas** de despesas extras: editadas em Configurações, gravadas em `configuracoes` (chave `descricoes_despesas`, uma por linha); sugeridas no campo Descrição das despesas extras e fixas.
- **Despesas extras:** parceladas (competência avança mês a mês, sufixo "(1/3)") e para vários clientes; despesas fixas geradas ao avançar a competência, sem duplicar.
- **Painel (por competência):** A receber = saldo da competência atual (honorários + despesas); Recebido = baixas no **mês seguinte** à competência; Em atraso = competências anteriores; Inadimplentes = clientes com honorário de competência anterior em aberto.
- **Extrato de débitos com Pix:** PDF por cliente com QR Code Pix **no valor exato** do débito (BR Code estático, chave = CNPJ do escritório, ver `src/lib/pix.ts`). WhatsApp de cobrança leva o Pix copia e cola.
- Escritório: Orgacon Contabilidade, CNPJ 02.345.207/0001-23, Rua José Roberto de Moraes, 23, Centro, Iúna/ES.
- Excel exportado: abas organizadas, altura de linha padrão (sem quebra automática).

## Identidade visual
Cores da logo: azul **#204879** (`marca-700`) e cinza **#73767B** (`cinza`). Logo em `public/logo.png`. Visual moderno/corporativo: menu lateral branco com ícones (`src/components/icones.tsx`), componentes base em `src/components/ui.tsx`, PDFs com cabeçalho padrão em `src/lib/pdf-base.ts`.

## Pendências / próximos passos
**Manter esta lista atualizada automaticamente (sem perguntar ao usuário):** ao concluir ou iniciar uma pendência, marcar aqui e mover para "Concluídas".

1. **Integração Asaas** (em andamento): hoje os boletos saem mensalmente e de forma automática no Asaas. Objetivos: (a) ao lançar despesa extra ou mudar valor, atualizar valor e descrição do boleto em aberto; (b) baixa automática por webhook quando o boleto for pago (baixa sem recibo); (c) saldo da conta Asaas no Painel. A chave da API vai em secret do Supabase (Edge Function), nunca no front.
   - Respostas do usuário: boletos = **assinaturas** mensais no Asaas (valor = honorário do Siscon, mesmo vencimento); só **alguns** clientes têm boleto (pedir a relação); juros/multa do Asaas = **juros recebido**; tarifas do Asaas (boleto pago, notificações) são despesa do escritório → baixa **integral** mesmo com valor líquido menor; despesa lançada após o boleto do mês já pago/vencido vai para o **boleto do mês seguinte**; boletos só são alterados **antes do envio** (envios em geral antes do dia 7), sem reenvio.
   - **Etapa 1 (feita, somente leitura):** Edge Function `supabase/functions/asaas` (ações `saldo` e `conferencia`; confere usuário logado; secrets `ASAAS_API_KEY` e opcional `ASAAS_BASE_URL`), tela **Conferência Asaas** (`src/pages/Asaas.tsx`, com Excel) e card **Saldo Asaas** no Painel. Vínculo de cliente: `clientes.asaas_customer_id` ou CNPJ. Competência do boleto = mês anterior ao vencimento.
   - **Bloqueio de IP:** o Asaas recusa (403 `not_allowed_ip`) chamadas da API vindas do Supabase mesmo com a lista de IPs vazia; a saída do Supabase (AWS sa-east-1) muda de IP a cada chamada (54.232.236.47, 54.20.174.170, 52.67.13.235, 52.67.121.34, 18.230.124.234...). Front chama a função com `?forceFunctionRegion=sa-east-1` na URL (a opção `region` manda cabeçalho `x-region` que quebra o CORS). Saldo/conferência/etapa 2 dependem de **IP fixo**: o atendimento do Asaas confirmou que o bloqueio é na **borda** e só libera **por IP** (informar IP de origem, horário e endpoint), sem liberação por conta/chave. Solução preparada e **adiada pelo usuário**: ponte AWS Lightsail São Paulo (~US$ 5/mês) com `ponte-asaas/instalar.sh` (Caddy + HTTPS sslip.io, exige `X-Ponte-Token`) e secrets `ASAAS_BASE_URL`/`ASAAS_PONTE_TOKEN` na função `asaas` (código já suporta; precisa colar a função de novo no Supabase).
   - **Etapa 3 (publicada e instalada em 31/10/2026 — aguardando os primeiros pagamentos reais de novembro, vencimentos dias 7–10; no 1º mês cada cliente precisa de "Vincular cliente"):** webhook → Edge Function `supabase/functions/asaas-webhook` (Verify JWT **desligado**, secret `ASAAS_WEBHOOK_TOKEN` = token do webhook no Asaas) → `asaas_receber_evento` (`005_asaas_baixa.sql`). Baixa **sem recibo**, data = `clientPaymentDate` (data em que o cliente pagou), valor bruto; honorário da competência quitado de forma **integral** (desconto até juros do Siscon + R$ 1,00; acima disso fica "Conferir"); depois despesas da competência e, se sobrar, itens mais antigos; juros/multa do Asaas viram item "Juros/Multa Asaas"; idempotente por `recibos.asaas_payment_id`; estorno no Asaas cancela a baixa. Cliente sem `asaas_customer_id` fica pendente até "Vincular cliente" na aba **Baixas automáticas** (`/asaas`). Painel avisa pendências. Eventos: PAYMENT_RECEIVED, PAYMENT_CONFIRMED, PAYMENT_REFUNDED, PAYMENT_RECEIVED_IN_CASH_UNDONE.
   - **Etapa 2 (pendente, depende do IP fixo):** ajustar valor/descrição do boleto em aberto ao mudar despesas/honorários (inclui evento PAYMENT_CREATED).
2. **Exclusão em lote** (definir com o usuário o que excluir em lote).
3. **Virada final:** reimportar dados atualizados do Base44 no dia em que deixar de usá-lo. **Hoje o usuário usa Base44 e Siscon em paralelo** (decisão dele, 03/11/2026): a numeração de recibos se repete entre os dois (ex.: nº 158 existe nos dois) — usuário pediu para ignorar por enquanto; resolver na virada.
4. **Domínio próprio** (`siscon.orgaconcontabilidade.com.br`): adiado pelo usuário para quando o sistema estiver pronto.

**Concluídas (31/10/2026):** despesas fixas (cadastradas pela tela: Sistema NFStock da Aroma Coffee e da El-Shaday); descrições padronizadas; recibo único para vários clientes; lista de clientes cortada na tela Receber.

## Como trabalhar neste repositório
- Antes de commitar: `npm run build` (inclui checagem de tipos).
- Prévia sem login: `testes_locais/` (ignorado no Git) tem um Supabase falso com dados exportados; útil para conferir telas com Playwright.
- Commits pequenos e descritivos em português.
- Trabalhar no ramo de trabalho; **publicar (push na `main`) só com o "pode publicar" do usuário**. Scripts SQL: colar o conteúdo no chat para o usuário rodar.
- `Cartao` (`ui.tsx`) tem `overflow-hidden`: listas suspensas `absolute` dentro dele ficam cortadas. Usar lista no fluxo normal (como em Receber).
