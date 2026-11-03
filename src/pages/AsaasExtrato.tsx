import { useMemo, useState } from 'react'
import { supabase, ok, todos, type Cliente, type Honorario, type Despesa } from '../lib/supabase'
import { moeda, data, comp, normaliza } from '../lib/format'
import { Botao, Cabecalho, Cartao, Carregando, Vazio, useAviso } from '../components/ui'

/** Recebimento de cobrança lido do extrato OFX do Asaas */
type Receb = { fatura: string; data: string; valor: number; nome: string; tarifas: number }
type Aberto = { tipo: 'honorario' | 'despesa'; id: string; cid: string; comp: string; data: string; saldo: number; juros: number; desc: string }
type ItemBaixa = { tipo: 'honorario' | 'despesa'; id: string; valor: number; desconto: number; rotulo: string }
type Situacao = 'pronto' | 'conferir' | 'sem_debito' | 'ja_baixado' | 'sem_cliente'
type Linha = Receb & { cliente: string; itens: ItemBaixa[]; juros: number; situacao: Situacao; obs: string }

const ROTULO: Record<Situacao, [string, string]> = {
  pronto: ['Pronto para baixar', 'bg-emerald-50 text-emerald-700 ring-emerald-200'],
  conferir: ['Conferir', 'bg-amber-50 text-amber-700 ring-amber-200'],
  sem_debito: ['Sem débito em aberto', 'bg-slate-100 text-slate-500 ring-slate-200'],
  ja_baixado: ['Fatura já baixada', 'bg-slate-100 text-slate-500 ring-slate-200'],
  sem_cliente: ['Escolher cliente', 'bg-red-50 text-red-700 ring-red-200'],
}

/** Lê o OFX do Asaas: créditos "Cobranca recebida - fatura nr. N NOME" e as tarifas de cada fatura */
export function lerOfxAsaas(txt: string): Receb[] {
  const ent = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
  const tag = (bloco: string, t: string) => ent((bloco.match(new RegExp(`<${t}>([^<\\r\\n]*)`)) || [])[1] || '')
  const lista: Receb[] = []
  const tarifas = new Map<string, number>()
  for (const [, b] of txt.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/g)) {
    const memo = tag(b, 'MEMO'), valor = Number(tag(b, 'TRNAMT')), dt = tag(b, 'DTPOSTED')
    const m = memo.match(/fatura nr\.?\s*(\d+)\s*(.*)$/i)
    if (!m) continue
    if (/^Cobranca recebida/i.test(memo) && valor > 0)
      lista.push({ fatura: m[1], nome: m[2].trim(), valor, data: `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`, tarifas: 0 })
    else if (valor < 0) tarifas.set(m[1], (tarifas.get(m[1]) || 0) - valor)
  }
  return lista.map(r => ({ ...r, tarifas: Math.round((tarifas.get(r.fatura) || 0) * 100) / 100 }))
    .sort((a, b) => a.data.localeCompare(b.data))
}

/** Nome comparável: sem acento, pontuação, sufixos societários e números de documento */
const chave = (s: string) => normaliza(s.replace(/&amp;/g, '&'))
  .replace(/\d[\d./-]{5,}/g, ' ').replace(/[^a-z0-9& ]/g, ' ')
  .replace(/\b(ltda|me|epp|eireli|sa|s a)\b/g, ' ').replace(/\s+/g, ' ').trim()

function acharCliente(nome: string, clientes: Cliente[]): string {
  const exato = clientes.filter(c => c.asaas_nome && c.asaas_nome.trim() === nome.trim())
  if (exato.length === 1) return exato[0].id
  const k = chave(nome)
  const iguais = clientes.filter(c => chave(c.razao_social) === k || (c.nome_fantasia && chave(c.nome_fantasia) === k))
  if (iguais.length === 1) return iguais[0].id
  if (iguais.length > 1) return ''
  const contem = clientes.filter(c => { const r = chave(c.razao_social); return r.length > 5 && k.length > 5 && (r.includes(k) || k.includes(r)) })
  return contem.length === 1 ? contem[0].id : ''
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** Monta a proposta de baixa de cada recebimento: do item mais antigo, baixa integral (diferença até os juros do Siscon vira desconto) */
function propor(recebs: Receb[], escolha: Record<string, string>, abertos: Aberto[], baixadas: Set<string>): Linha[] {
  const saldo = new Map(abertos.map(a => [a.id, a.saldo]))
  return recebs.map(r => {
    const cliente = escolha[r.fatura] || ''
    const base = { ...r, cliente, itens: [] as ItemBaixa[], juros: 0, obs: '' }
    if (baixadas.has(r.fatura)) return { ...base, situacao: 'ja_baixado' as Situacao, obs: 'Esta fatura já tem baixa no Siscon.' }
    if (!cliente) return { ...base, situacao: 'sem_cliente' as Situacao, obs: 'Nome do Asaas não encontrado no cadastro. Escolha o cliente.' }
    const doCliente = abertos.filter(x => x.cid === cliente && (saldo.get(x.id) || 0) > 0.009)
    if (!doCliente.length) return { ...base, situacao: 'sem_debito' as Situacao, obs: 'Cliente sem débito em aberto: provavelmente já baixado (Base44 ou manual).' }

    // 1) Regra geral: do item mais antigo para o mais novo
    let resto = r.valor, parcial = false
    let itens: ItemBaixa[] = []
    for (const a of doCliente) {
      const s = saldo.get(a.id) || 0
      if (resto <= 0.009) break
      const rot = `${a.desc} ${comp(a.comp)}`
      if (resto >= s - 0.009) { itens.push({ tipo: a.tipo, id: a.id, valor: r2(s), desconto: 0, rotulo: rot }); resto = r2(resto - s); continue }
      const falta = r2(s - resto)
      if (a.tipo === 'honorario' && falta <= a.juros + 1) {
        itens.push({ tipo: a.tipo, id: a.id, valor: resto, desconto: falta, rotulo: `${rot} (desconto ${moeda(falta)})` })
      } else { itens.push({ tipo: a.tipo, id: a.id, valor: resto, desconto: 0, rotulo: `${rot} (parcial)` }); parcial = true }
      resto = 0
    }
    let juros = resto > 0.009 ? r2(resto) : 0
    let altoDemais = juros > Math.max(5, r.valor * 0.1)
    let obs = parcial ? 'Valor menor que o débito: baixa parcial.' : altoDemais ? `Sobram ${moeda(juros)} além dos débitos em aberto.` : ''

    // 2) Antes de aceitar baixa parcial (ou sobra alta): o valor pago é o de um honorário, sem as despesas extras?
    //    Se for, baixa só esse honorário (integral) e as despesas continuam em aberto.
    if (parcial || altoDemais) {
      const hon = doCliente.find(a => {
        if (a.tipo !== 'honorario') return false
        const s = saldo.get(a.id) || 0
        return r.valor >= s - a.juros - 1 && r.valor <= s + Math.max(5, s * 0.1)
      })
      if (hon) {
        const s = saldo.get(hon.id) || 0
        const pago = r2(Math.min(r.valor, s)), desconto = r2(s - pago)
        itens = [{ tipo: 'honorario', id: hon.id, valor: pago, desconto,
          rotulo: `Honorário ${comp(hon.comp)}${desconto > 0.009 ? ` (desconto ${moeda(desconto)})` : ''}` }]
        juros = r.valor > s ? r2(r.valor - s) : 0
        parcial = false; altoDemais = false
        const ficam = doCliente.filter(a => a.id !== hon.id)
        obs = `Valor corresponde ao honorário de ${comp(hon.comp)} sem as despesas extras.` +
          (ficam.length ? ` Continuam em aberto: ${ficam.map(a => `${a.desc} ${comp(a.comp)}`).join(', ')}.` : '')
      }
    }

    for (const i of itens) saldo.set(i.id, r2((saldo.get(i.id) || 0) - i.valor - i.desconto))
    return { ...base, itens, juros, obs, situacao: (parcial || altoDemais ? 'conferir' : 'pronto') as Situacao }
  })
}

export default function AsaasExtrato() {
  const avisar = useAviso()
  const [recebs, setRecebs] = useState<Receb[] | null>(null)
  const [escolha, setEscolha] = useState<Record<string, string>>({})
  const [marcados, setMarcados] = useState<Record<string, boolean>>({})
  const [resultado, setResultado] = useState<Record<string, string>>({})
  const [base, setBase] = useState<{ clientes: Cliente[]; abertos: Aberto[]; baixadas: Set<string> } | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [baixando, setBaixando] = useState(false)

  async function carregarBase() {
    const [clientes, hon, des, rec] = await Promise.all([
      todos<Cliente>((a, b) => supabase.from('clientes').select('*').order('razao_social').range(a, b)),
      todos<Honorario>((a, b) => supabase.from('v_honorarios').select('*').gt('saldo', 0).range(a, b)),
      todos<Despesa>((a, b) => supabase.from('v_despesas').select('*').gt('saldo', 0).range(a, b)),
      todos<{ asaas_fatura: string }>((a, b) => supabase.from('recibos').select('asaas_fatura').eq('cancelado', false).not('asaas_fatura', 'is', null).range(a, b)),
    ])
    const abertos: Aberto[] = [
      ...hon.map(h => ({ tipo: 'honorario' as const, id: h.id, cid: h.cliente_id, comp: h.competencia, data: h.vencimento, saldo: h.saldo, juros: h.juros_calc || 0, desc: 'Honorário' })),
      ...des.map(d => ({ tipo: 'despesa' as const, id: d.id, cid: d.cliente_id, comp: d.competencia, data: d.data, saldo: d.saldo, juros: 0, desc: d.descricao })),
    ].sort((a, b) => a.comp.localeCompare(b.comp) || (a.tipo === b.tipo ? a.data.localeCompare(b.data) : a.tipo === 'honorario' ? -1 : 1))
    return { clientes, abertos, baixadas: new Set(rec.map(r => r.asaas_fatura)) }
  }

  async function abrir(arq: File | undefined) {
    if (!arq) return
    setCarregando(true); setResultado({})
    try {
      const lidos = lerOfxAsaas(await arq.text())
      if (!lidos.length) throw new Error('Nenhuma "Cobrança recebida" encontrada no arquivo. Confira se é o extrato OFX do Asaas.')
      const b = await carregarBase()
      const esc = Object.fromEntries(lidos.map(r => [r.fatura, acharCliente(r.nome, b.clientes)]))
      setBase(b); setRecebs(lidos); setEscolha(esc); setMarcados({})
    } catch (e) {
      const msg = (e as Error).message
      avisar(/asaas_fatura|asaas_nome/.test(msg) ? 'Falta rodar o script SQL 006 no Supabase.' : msg, 'erro')
    } finally { setCarregando(false) }
  }

  const linhas = useMemo(() => recebs && base ? propor(recebs, escolha, base.abertos, base.baixadas) : [], [recebs, base, escolha])
  const marcado = (l: Linha) => marcados[l.fatura] ?? l.situacao === 'pronto'
  const sel = linhas.filter(l => marcado(l) && l.itens.length && !resultado[l.fatura])

  /** Grava o nome do Asaas no cadastro de cada cliente escolhido (próximas importações reconhecem sozinhas) */
  async function salvarVinculos() {
    const pares = linhas.filter(l => l.cliente).map(l => [l.cliente, l.nome] as const)
    if (!pares.length) return
    try {
      for (const [id, nome] of new Map(pares)) ok(await supabase.from('clientes').update({ asaas_nome: nome }).eq('id', id))
      avisar(`Vínculo gravado para ${new Map(pares).size} cliente(s).`)
    } catch (e) { avisar((e as Error).message, 'erro') }
  }

  async function baixar() {
    if (!sel.length) return
    if (!confirm(`Dar baixa SEM recibo em ${sel.length} recebimento(s) do Asaas, total ${moeda(sel.reduce((s, l) => s + l.valor, 0))}?`)) return
    setBaixando(true)
    const res: Record<string, string> = {}
    for (const l of sel) {
      try {
        ok(await supabase.rpc('asaas_baixar_extrato', {
          p_fatura: l.fatura, p_cliente_id: l.cliente, p_data: l.data, p_juros: l.juros, p_nome_asaas: l.nome,
          p_itens: l.itens.map(i => ({ tipo: i.tipo, id: i.id, valor: i.valor, desconto: i.desconto })),
        }))
        res[l.fatura] = 'ok'
      } catch (e) { res[l.fatura] = (e as Error).message }
      setResultado(x => ({ ...x, ...res }))
    }
    setBaixando(false)
    const n = Object.values(res).filter(v => v === 'ok').length
    avisar(`${n} baixa(s) registrada(s)${n < sel.length ? `; ${sel.length - n} com erro (veja a tabela)` : ''}.`, n < sel.length ? 'erro' : undefined)
  }

  const cont = (s: Situacao) => linhas.filter(l => l.situacao === s).length
  return (
    <>
      <Cabecalho titulo="Importar extrato do Asaas (OFX)" subtitulo="Dá baixa sem recibo nos boletos já recebidos e grava o vínculo do cliente pelo nome do Asaas"
        acoes={<label className="inline-flex cursor-pointer items-center rounded-lg bg-marca-700 px-4 py-2 text-sm font-medium text-white hover:bg-marca-800">
          {recebs ? 'Trocar arquivo' : 'Escolher arquivo .ofx'}<input type="file" accept=".ofx,.OFX" className="hidden" onChange={e => abrir(e.target.files?.[0])} /></label>} />
      {carregando ? <Carregando /> : !recebs ? <Cartao><Vazio texto='No Asaas: Extrato → período desejado → Exportar → OFX. Depois escolha o arquivo aqui. Nada é baixado sem a sua confirmação.' /></Cartao> : <>
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          {(['pronto', 'conferir', 'sem_cliente', 'sem_debito', 'ja_baixado'] as Situacao[]).map(s =>
            <span key={s} className={`rounded-full px-2.5 py-1 font-medium ring-1 ring-inset ${ROTULO[s][1]}`}>{ROTULO[s][0]}: {cont(s)}</span>)}
          <span className="ml-auto text-sm text-slate-500">{linhas.length} recebimentos · {moeda(linhas.reduce((s, l) => s + l.valor, 0))}</span>
        </div>
        <Cartao acoes={<><Botao variante="secundario" onClick={salvarVinculos} disabled={baixando}>Gravar vínculos de nome</Botao><Botao disabled={!sel.length || baixando} onClick={baixar}>{baixando ? 'Baixando…' : `Dar baixa nos marcados (${sel.length})`}</Botao></>}
          titulo="Prévia: confira cliente e itens antes de baixar">
          <div className="overflow-x-auto"><table className="tabela">
            <thead><tr><th /><th>Pago em</th><th>Nome no Asaas · fatura</th><th>Cliente no Siscon</th><th className="text-right">Valor</th><th>O que será baixado</th><th>Situação</th></tr></thead>
            <tbody>{linhas.map(l => {
              const feito = resultado[l.fatura]
              return (
                <tr key={l.fatura} className="align-top">
                  <td><input type="checkbox" disabled={!l.itens.length || !!feito} checked={marcado(l) && !!l.itens.length}
                    onChange={e => setMarcados(m => ({ ...m, [l.fatura]: e.target.checked }))} /></td>
                  <td className="num">{data(l.data)}</td>
                  <td className="!whitespace-normal min-w-[12rem] max-w-[16rem]">{l.nome}<span className="block text-xs text-slate-400">fatura {l.fatura}{l.tarifas ? ` · tarifas ${moeda(l.tarifas)}` : ''}</span></td>
                  <td className="min-w-[14rem]">
                    <select className="campo !h-8 max-w-[18rem] text-xs" disabled={!!feito} value={l.cliente}
                      onChange={e => setEscolha(x => ({ ...x, [l.fatura]: e.target.value }))}>
                      <option value="">— escolher —</option>
                      {base?.clientes.map(c => <option key={c.id} value={c.id}>{c.razao_social}</option>)}
                    </select>
                  </td>
                  <td className="num text-right">{moeda(l.valor)}</td>
                  <td className="!whitespace-normal min-w-[14rem] text-xs">
                    {l.itens.map(i => <span key={i.id} className="block">{i.rotulo}: {moeda(i.valor)}</span>)}
                    {l.juros > 0 && <span className="block text-emerald-700">Juros/Multa Asaas: {moeda(l.juros)}</span>}
                  </td>
                  <td className="!whitespace-normal min-w-[11rem]">
                    {feito === 'ok' ? <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-medium text-white">Baixado</span>
                      : <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${ROTULO[l.situacao][1]}`}>{ROTULO[l.situacao][0]}</span>}
                    {(feito && feito !== 'ok' ? feito : l.obs) && <span className={`mt-1 block text-xs ${feito && feito !== 'ok' ? 'text-red-700' : 'text-slate-500'}`}>{feito && feito !== 'ok' ? feito : l.obs}</span>}
                  </td>
                </tr>)
            })}</tbody>
          </table></div>
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            Regra: o valor quita os débitos em aberto do cliente do mais antigo para o mais novo. Honorário com diferença até os juros do Siscon é quitado de forma integral (diferença como desconto); o que passar dos débitos vira "Juros/Multa Asaas". Tarifas do Asaas não entram na baixa. "Conferir" vem desmarcado: marque só se estiver de acordo.
          </p>
        </Cartao>
      </>}
    </>
  )
}
