// Siscon — recebe os avisos (webhooks) do Asaas e registra a baixa automática.
// Não chama a API do Asaas (por isso não depende de IP autorizado): só grava e processa no banco.
//
// No Supabase: desligar "Verify JWT" desta função (o Asaas não envia login do Supabase).
// Secret obrigatório: ASAAS_WEBHOOK_TOKEN = o mesmo "Token de autenticação" cadastrado no webhook do Asaas.
// Regras da baixa: função asaas_receber_evento (supabase/005_asaas_baixa.sql).

const TOKEN = Deno.env.get('ASAAS_WEBHOOK_TOKEN') || ''
const URL_SB = Deno.env.get('SUPABASE_URL') || ''

/** Chave de serviço do próprio Supabase (preenchida automaticamente nas Edge Functions) */
function chaveServico(): string {
  const legado = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legado) return legado
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); return k.default || Object.values(k)[0] as string || '' }
  catch { return '' }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Siscon webhook Asaas', { status: 200 })
  if (!TOKEN || req.headers.get('asaas-access-token') !== TOKEN) return new Response('Não autorizado', { status: 401 })

  let payload: unknown
  try { payload = await req.json() } catch { return new Response('JSON inválido', { status: 400 }) }

  const chave = chaveServico()
  const headers: Record<string, string> = { apikey: chave, 'Content-Type': 'application/json' }
  if (!chave.startsWith('sb_secret_')) headers.Authorization = `Bearer ${chave}`

  const r = await fetch(`${URL_SB}/rest/v1/rpc/asaas_receber_evento`, {
    method: 'POST', headers, body: JSON.stringify({ p_payload: payload }),
  })
  const txt = await r.text()
  if (!r.ok) {
    // Falha ao gravar: responde erro para o Asaas reenviar depois
    console.error('asaas_receber_evento falhou', r.status, txt)
    return new Response('Erro ao registrar', { status: 500 })
  }
  // Gravado (processado, pendente ou com erro de regra — visível na tela do Siscon): confirma ao Asaas
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
