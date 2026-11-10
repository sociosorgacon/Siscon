// Siscon — backup automático (Edge Function do Supabase), chamado todo dia pelo Google Apps Script (scripts/backup-drive.gs),
// que salva o arquivo na pasta de backup do Google Drive da Orgacon.
//
// SOMENTE LEITURA: devolve um JSON com todas as tabelas. Não grava nem apaga nada.
// No Supabase: desligar "Verify JWT" desta função (quem chama é o Apps Script, sem login do Siscon).
// Secret obrigatório: BACKUP_TOKEN = o mesmo token gravado nas Propriedades do script do Apps Script.
// Sem o token certo no cabeçalho X-Backup-Token, responde 401.

const TOKEN = Deno.env.get('BACKUP_TOKEN') || ''
const URL_SB = Deno.env.get('SUPABASE_URL') || ''

// Manter igual a TABELAS_BACKUP em src/lib/backup.ts (tabela → coluna para ordenar a paginação)
const TABELAS: Record<string, string> = {
  configuracoes: 'chave', salarios_minimos: 'vigencia', clientes: 'id', honorarios: 'id', despesas: 'id', despesas_fixas: 'id',
  recibos: 'id', recibo_itens: 'id', asaas_eventos: 'id', asaas_cobrancas: 'payment_id', certificados_cobrados: 'id',
}

/** Chave de serviço do próprio Supabase (preenchida automaticamente nas Edge Functions; nunca sai daqui) */
function chaveServico(): string {
  const legado = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legado) return legado
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); return k.default || Object.values(k)[0] as string || '' }
  catch { return '' }
}

/** Comparação que não "vaza" o tamanho do acerto pelo tempo de resposta */
function iguais(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

async function tabelaToda(tabela: string, ordem: string, headers: Record<string, string>) {
  const linhas: unknown[] = []
  for (let de = 0; de < 500000; de += 1000) {
    const r = await fetch(`${URL_SB}/rest/v1/${tabela}?select=*&order=${ordem}.asc`, { headers: { ...headers, Range: `${de}-${de + 999}` } })
    if (!r.ok) throw new Error(`${tabela}: ${r.status} ${(await r.text()).slice(0, 200)}`)
    const lote = await r.json() as unknown[]
    linhas.push(...lote)
    if (lote.length < 1000) break
  }
  return linhas
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Siscon backup', { status: 200 })
  if (!TOKEN || !iguais(req.headers.get('x-backup-token') || '', TOKEN)) return new Response('Não autorizado', { status: 401 })

  const chave = chaveServico()
  const headers: Record<string, string> = { apikey: chave }
  if (!chave.startsWith('sb_secret_')) headers.Authorization = `Bearer ${chave}`

  const dados: Record<string, unknown> = { exportado_em: new Date().toISOString(), origem: 'automatico' }
  const erros: string[] = [], contagem: Record<string, number> = {}
  for (const [t, ordem] of Object.entries(TABELAS)) {
    try { const l = await tabelaToda(t, ordem, headers); dados[t] = l; contagem[t] = l.length }
    catch (e) { dados[t] = []; erros.push((e as Error).message) }
  }
  dados.contagem = contagem
  if (erros.length) dados.tabelas_com_erro = erros
  return new Response(JSON.stringify(dados), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
