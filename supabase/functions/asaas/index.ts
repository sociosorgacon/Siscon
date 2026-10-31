// Siscon — integração com o Asaas (Edge Function do Supabase)
// Etapa 1: SOMENTE LEITURA — saldo da conta e conferência de assinaturas/boletos em aberto.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   ASAAS_API_KEY   chave da API do Asaas (obrigatória; nunca vai para o front nem para o Git)
//   ASAAS_BASE_URL  opcional; padrão produção. Sandbox: https://api-sandbox.asaas.com/v3
//
// Chamada pelo front (usuário logado): supabase.functions.invoke('asaas', { body: { acao: 'saldo' | 'conferencia' } })

const ASAAS = (Deno.env.get('ASAAS_BASE_URL') || 'https://api.asaas.com/v3').replace(/\/$/, '')
const CHAVE = Deno.env.get('ASAAS_API_KEY') || ''

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** Só usuários logados no Siscon (confere o token no Auth do próprio Supabase) */
async function usuarioLogado(req: Request) {
  const auth = req.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return false
  const apikey = req.headers.get('apikey') || Deno.env.get('SUPABASE_ANON_KEY') || ''
  const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, { headers: { Authorization: auth, apikey } })
  if (!r.ok) return false
  const u = await r.json().catch(() => null)
  return !!u?.id
}

async function asaasGet(caminho: string) {
  const r = await fetch(ASAAS + caminho, {
    headers: { access_token: CHAVE, 'User-Agent': 'Siscon-Orgacon', 'Content-Type': 'application/json' },
  })
  const txt = await r.text()
  if (!r.ok) throw new Error(`Asaas respondeu ${r.status}: ${txt.slice(0, 300)}`)
  return JSON.parse(txt)
}

/** Percorre todas as páginas de uma listagem do Asaas (100 por página) */
async function asaasTodos(caminho: string) {
  const sep = caminho.includes('?') ? '&' : '?'
  const itens: Record<string, unknown>[] = []
  for (let offset = 0; offset < 20000; offset += 100) {
    const p = await asaasGet(`${caminho}${sep}limit=100&offset=${offset}`)
    itens.push(...(p.data || []))
    if (!p.hasMore) break
  }
  return itens
}

type Obj = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    if (!(await usuarioLogado(req))) return resposta({ erro: 'Não autorizado' }, 401)
    if (!CHAVE) return resposta({ erro: 'ASAAS_API_KEY não configurada nos Secrets do Supabase' }, 500)
    const { acao } = await req.json().catch(() => ({}))

    if (acao === 'saldo') {
      const b = await asaasGet('/finance/balance')
      return resposta({ saldo: Number(b.balance ?? 0) })
    }

    if (acao === 'conferencia') {
      const [clientes, assinaturas, pendentes, vencidas] = await Promise.all([
        asaasTodos('/customers'),
        asaasTodos('/subscriptions?status=ACTIVE'),
        asaasTodos('/payments?status=PENDING'),
        asaasTodos('/payments?status=OVERDUE'),
      ])
      const porId = new Map((clientes as Obj[]).map(c => [c.id, c]))
      const cli = (id: string) => { const c = porId.get(id) || {}; return { nome: c.name || '', cpfCnpj: (c.cpfCnpj || '').replace(/\D/g, '') } }
      return resposta({
        assinaturas: (assinaturas as Obj[]).map(s => ({
          id: s.id, cliente_asaas: s.customer, ...cli(s.customer), valor: Number(s.value), proximo_vencimento: s.nextDueDate,
          descricao: s.description || '', forma: s.billingType, ciclo: s.cycle,
        })),
        cobrancas: ([...pendentes, ...vencidas] as Obj[]).map(p => ({
          id: p.id, assinatura: p.subscription || null, cliente_asaas: p.customer, ...cli(p.customer), valor: Number(p.value),
          vencimento: p.dueDate, status: p.status, descricao: p.description || '', link: p.invoiceUrl || null,
        })),
      })
    }

    return resposta({ erro: 'Ação inválida' }, 400)
  } catch (e) {
    return resposta({ erro: (e as Error).message }, 500)
  }
})
