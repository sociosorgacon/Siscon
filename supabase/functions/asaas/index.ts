// Siscon — integração com o Asaas (Edge Function do Supabase)
// Etapa 1: leitura — saldo da conta e conferência de assinaturas/boletos em aberto.
// Etapa 2: ajustes aprovados pelo usuário — valor/descrição de boleto PENDENTE e valor da assinatura.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   ASAAS_API_KEY   chave da API do Asaas (obrigatória; nunca vai para o front nem para o Git)
//   ASAAS_BASE_URL  opcional; padrão produção. Com a ponte de IP fixo: https://<ip-com-hifens>.sslip.io/v3
//   ASAAS_PONTE_TOKEN  token da ponte de IP fixo (ponte-asaas/instalar.sh); vazio = chama o Asaas direto
//
// Chamada pelo front (usuário logado): supabase.functions.invoke('asaas', { body: { acao: 'saldo' | 'conferencia' } })

const ASAAS = (Deno.env.get('ASAAS_BASE_URL') || 'https://api.asaas.com/v3').replace(/\/$/, '')
const CHAVE = Deno.env.get('ASAAS_API_KEY') || ''
const PONTE = Deno.env.get('ASAAS_PONTE_TOKEN') || ''

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region',
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

/** De onde a função está saindo (para diagnosticar bloqueio de IP/país no Asaas) */
async function origem() {
  if (PONTE) return `saída pela ponte de IP fixo (${new URL(ASAAS).hostname})`
  try {
    const i = await (await fetch('https://ipinfo.io/json')).json()
    return `saída: IP ${i.ip}, ${i.city || ''}/${i.country || '?'}, região Supabase ${Deno.env.get('SB_REGION') || '?'}`
  } catch { return `região Supabase ${Deno.env.get('SB_REGION') || '?'}` }
}

async function asaasGet(caminho: string, metodo = 'GET', corpo?: unknown) {
  const r = await fetch(ASAAS + caminho, {
    method: metodo, ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    headers: { access_token: CHAVE, 'User-Agent': 'Siscon-Orgacon', 'Content-Type': 'application/json', ...(PONTE ? { 'X-Ponte-Token': PONTE, 'X-Asaas-Key': CHAVE } : {}) },
  })
  const txt = await r.text()
  if (r.status === 403) throw new Error(`Asaas respondeu 403: ${txt.slice(0, 300)} — ${await origem()}`)
  if (!r.ok) throw new Error(`Asaas respondeu ${r.status}: ${txt.slice(0, 300)} — ${await origem()}`)
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
    const corpoReq = await req.json().catch(() => ({}))
    const { acao } = corpoReq

    if (acao === 'saldo') {
      // saldo disponível + "confirmado": pagamentos já confirmados que ainda não caíram na conta (status CONFIRMED)
      const [b, conf] = await Promise.all([asaasGet('/finance/balance'), asaasTodos('/payments?status=CONFIRMED')])
      const confirmado = (conf as Obj[]).reduce((t, p) => t + Number(p.netValue ?? p.value ?? 0), 0)
      return resposta({ saldo: Number(b.balance ?? 0), confirmado: Math.round(confirmado * 100) / 100, qtdConfirmado: conf.length })
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

    // Ajustes de boletos (mais rápido): só assinaturas ativas e boletos PENDENTES que ainda não venceram
    if (acao === 'ajustes') {
      const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
      const [assinaturas, pendentes] = await Promise.all([
        asaasTodos('/subscriptions?status=ACTIVE'),
        asaasTodos(`/payments?status=PENDING&dueDate%5Bge%5D=${hoje}`),
      ])
      return resposta({
        assinaturas: (assinaturas as Obj[]).map(s => ({
          id: s.id, cliente_asaas: s.customer, nome: '', cpfCnpj: '', valor: Number(s.value), proximo_vencimento: s.nextDueDate,
          descricao: s.description || '', forma: s.billingType, ciclo: s.cycle,
        })),
        cobrancas: (pendentes as Obj[]).map(p => ({
          id: p.id, assinatura: p.subscription || null, cliente_asaas: p.customer, nome: '', cpfCnpj: '', valor: Number(p.value),
          vencimento: p.dueDate, status: p.status, descricao: p.description || '', link: p.invoiceUrl || null,
        })),
      })
    }

    // Link do PDF de UM boleto (id "pay_..." ou, para boleto importado da planilha, nº da fatura + vencimento)
    if (acao === 'boleto') {
      const { id, fatura, vencimento } = corpoReq as { id?: string; fatura?: string; vencimento?: string }
      let p: Obj | undefined
      if (id && !id.startsWith('fatura:')) p = await asaasGet(`/payments/${encodeURIComponent(id)}`)
      else if (fatura && vencimento) {
        const lista = await asaasTodos(`/payments?dueDate%5Bge%5D=${vencimento}&dueDate%5Ble%5D=${vencimento}`) as Obj[]
        p = lista.find(x => String(x.invoiceNumber) === String(fatura))
      }
      if (!p) return resposta({ erro: 'Boleto não encontrado no Asaas' }, 404)
      return resposta({ id: p.id, boleto: p.bankSlipUrl || null, fatura: p.invoiceUrl || null })
    }

    // Lote do mês por GRUPO de clientes do Asaas (ex.: Impressos, Acessórias): boletos pendentes com vencimento no mês
    if (acao === 'lote') {
      const { grupo, mes } = corpoReq as { grupo: string; mes: string }   // mes = 'AAAA-MM'
      if (!grupo || !/^\d{4}-\d{2}$/.test(mes || '')) return resposta({ erro: 'Informe o grupo e o mês' }, 400)
      const [a, m] = mes.split('-').map(Number)
      const ultimo = new Date(a, m, 0).getDate()
      const [clientes, boletos] = await Promise.all([
        asaasTodos(`/customers?groupName=${encodeURIComponent(grupo)}`),
        asaasTodos(`/payments?status=PENDING&dueDate%5Bge%5D=${mes}-01&dueDate%5Ble%5D=${mes}-${String(ultimo).padStart(2, '0')}`),
      ])
      const doGrupo = new Map((clientes as Obj[]).map(c => [c.id, c]))
      return resposta({
        clientesNoGrupo: doGrupo.size,
        boletos: (boletos as Obj[]).filter(p => doGrupo.has(p.customer) && p.bankSlipUrl).map(p => {
          const c = doGrupo.get(p.customer)!
          return { id: p.id, cliente_asaas: p.customer, nome: c.name || '', cpfCnpj: (c.cpfCnpj || '').replace(/\D/g, ''), valor: Number(p.value), vencimento: p.dueDate, boleto: p.bankSlipUrl }
        }),
      })
    }

    // Baixa o PDF de um boleto (só endereços do Asaas) e devolve em base64 — o navegador não pode baixar direto (CORS)
    if (acao === 'pdf') {
      const { url } = corpoReq as { url: string }
      let u: URL
      try { u = new URL(url) } catch { return resposta({ erro: 'Endereço inválido' }, 400) }
      if (u.protocol !== 'https:' || !(u.hostname === 'asaas.com' || u.hostname.endsWith('.asaas.com'))) return resposta({ erro: 'Só boletos do Asaas' }, 400)
      const r = await fetch(u.toString(), { headers: { 'User-Agent': 'Siscon-Orgacon' } })
      if (!r.ok) return resposta({ erro: `Asaas respondeu ${r.status} ao baixar o boleto` }, 502)
      const bytes = new Uint8Array(await r.arrayBuffer())
      let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return resposta({ base64: btoa(bin), tipo: r.headers.get('content-type') || '' })
    }

    // Grupos de clientes do Asaas (Impressos, Acessórias, WhatsApp...): quem está em cada um, para mostrar no Siscon
    if (acao === 'grupos') {
      const { nomes } = corpoReq as { nomes: string[] }
      const listas = await Promise.all((nomes || []).map(g => asaasTodos(`/customers?groupName=${encodeURIComponent(g)}`)))
      return resposta({
        clientes: listas.flatMap((l, i) => (l as Obj[]).map(c => ({ cliente_asaas: c.id, cpfCnpj: (c.cpfCnpj || '').replace(/\D/g, ''), grupo: nomes[i] }))),
      })
    }

    // Altera boletos PENDENTES (confere a situação no Asaas antes de alterar) — lista aprovada no Siscon
    if (acao === 'aplicar_boletos') {
      const { ajustes } = corpoReq as { ajustes: { id: string; valor: number; descricao: string }[] }
      const resultado = []
      for (const a of ajustes || []) {
        try {
          const p = await asaasGet(`/payments/${encodeURIComponent(a.id)}`)
          if (p.deleted || p.status !== 'PENDING') { resultado.push({ id: a.id, ok: false, msg: `boleto não está mais pendente (${p.deleted ? 'removido' : p.status})` }); continue }
          await asaasGet(`/payments/${encodeURIComponent(a.id)}`, 'POST', { billingType: p.billingType, dueDate: p.dueDate, value: a.valor, description: a.descricao })
          resultado.push({ id: a.id, ok: true, msg: 'alterado' })
        } catch (e) { resultado.push({ id: a.id, ok: false, msg: (e as Error).message }) }
      }
      return resposta({ resultado })
    }

    // Valor da assinatura (vale para os próximos boletos; os já criados são ajustados pela lista de boletos)
    if (acao === 'aplicar_assinaturas') {
      const { ajustes } = corpoReq as { ajustes: { id: string; valor: number }[] }
      const resultado = []
      for (const a of ajustes || []) {
        try {
          await asaasGet(`/subscriptions/${encodeURIComponent(a.id)}`, 'POST', { value: a.valor, updatePendingPayments: false })
          resultado.push({ id: a.id, ok: true, msg: 'alterada' })
        } catch (e) { resultado.push({ id: a.id, ok: false, msg: (e as Error).message }) }
      }
      return resposta({ resultado })
    }

    return resposta({ erro: 'Ação inválida' }, 400)
  } catch (e) {
    return resposta({ erro: (e as Error).message }, 500)
  }
})
