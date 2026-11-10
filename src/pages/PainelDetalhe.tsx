import { useEffect, useMemo, useState } from 'react'
import { liquidoCert } from '../lib/certificado-pdf'
import { supabase, todos, type Honorario, type Despesa, type Recibo } from '../lib/supabase'
import { useApp, useDados, descricoesPadrao } from '../lib/app'
import { moeda, data, comp, normaliza } from '../lib/format'
import { baixarExcel } from '../lib/excel'
import { Carregando, Vazio, useAviso } from '../components/ui'
import { Icone } from '../components/icones'

export type Indicador = 'receber' | 'recebido' | 'atraso' | 'inadimplentes'
type Linha = { tipo: string; cliente: string; ref: string; competencia: string | null; data: string | null; valor: number }
type ItemRec = { tipo: string; descricao: string; valor: number; competencia: string | null; cliente_nome: string | null }

const sem = (s: string) => normaliza(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
/** Tira o "(2/3)" da parcela, o "10º" do começo e o ano do fim: "10º Alteração Contratual (2/3)" → "Alteração Contratual" */
const base = (s: string) => s.replace(/\s*\(\d+\/\d+\)\s*$/, '').replace(/^\s*\d+\s*[ºª°o]?\s+/, '').replace(/\s*\d{4}(\/\d{4})?\s*$/, '').trim()

/** Tipo da despesa = descrição padronizada (Configurações) que ela contém; senão a própria descrição limpa */
export function tipoDespesa(descricao: string, padroes: string[]) {
  const d = sem(base(descricao))
  const palavras = new Set(d.split(' '))
  for (const p of padroes) {
    const pb = base(p), ps = sem(pb)
    if (!ps) continue
    if (d.includes(ps) || ps.split(' ').filter(w => w.length > 2).every(w => palavras.has(w))) return pb
  }
  return base(descricao) || descricao
}

const TITULOS: Record<Indicador, string> = {
  receber: 'A receber no mês', recebido: 'Recebido no mês', atraso: 'Total em atraso', inadimplentes: 'Clientes inadimplentes',
}

export default function DetalheIndicador({ qual, c, iso, pRec, hon, des, fechar }:
  { qual: Indicador; c: string; iso: string; pRec: string; hon: Honorario[]; des: Despesa[]; fechar: () => void }) {
  const { config } = useApp()
  const avisar = useAviso()
  const padroes = useMemo(() => descricoesPadrao(config), [config])
  const [filtro, setFiltro] = useState<string | null>(null)
  const [cli, setCli] = useState('')
  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar() }; window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f) }, [fechar])
  const mesRec = pRec.split('-').reverse().join('/')

  // Recebimentos: busca as baixas do mês com os itens (só quando este indicador é aberto)
  const fim = (() => { const [a, m] = pRec.split('-').map(Number); return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01` })()
  const { dados: recs } = useDados(async () => qual !== 'recebido' ? [] :
    todos<Recibo & { recibo_itens: ItemRec[] }>((a, b) => supabase.from('recibos').select('*, recibo_itens(*)').eq('cancelado', false)
      .gte('data_pagamento', `${pRec}-01`).lt('data_pagamento', fim).order('data_pagamento').range(a, b)), [qual, pRec])
  // certificados digitais pagos no mês (cobrança avulsa): entram pelo valor líquido
  const { dados: certs } = useDados(async () => qual !== 'recebido' ? [] :
    todos<{ cliente_nome: string; tipo: string; valor: number; valor_liquido: number | null; data: string; data_pagamento: string }>((a, b) => supabase.from('certificados_cobrados')
      .select('cliente_nome, tipo, valor, valor_liquido, data, data_pagamento').eq('pago', true).gte('data_pagamento', `${pRec}-01`).lt('data_pagamento', fim).range(a, b)).catch(() => []), [qual, pRec])

  const linhas = useMemo<Linha[] | null>(() => {
    const deHon = (h: Honorario): Linha => ({ tipo: 'Honorários', cliente: h.cliente_nome, ref: `Honorários ${comp(h.competencia)}`, competencia: h.competencia, data: h.vencimento, valor: h.saldo })
    const deDes = (d: Despesa): Linha => ({ tipo: tipoDespesa(d.descricao, padroes), cliente: d.cliente_nome, ref: d.descricao, competencia: d.competencia, data: d.data, valor: d.saldo })
    if (qual === 'receber') return [...hon.filter(h => h.competencia === iso && h.saldo > 0.009).map(deHon), ...des.filter(d => d.competencia === iso && d.saldo > 0.009).map(deDes)]
    if (qual === 'atraso') return [...hon.filter(h => h.competencia < iso && h.saldo > 0.009).map(deHon), ...des.filter(d => d.competencia < iso && d.saldo > 0.009).map(deDes)]
    if (qual === 'inadimplentes') {
      const inad = new Set(hon.filter(h => h.competencia < iso && h.saldo > 0.009).map(h => h.cliente_id))
      return [...hon.filter(h => inad.has(h.cliente_id) && h.competencia < iso && h.saldo > 0.009).map(deHon),
        ...des.filter(d => inad.has(d.cliente_id) && d.competencia < iso && d.saldo > 0.009).map(deDes)]
    }
    if (!recs || !certs) return null
    // certificados digitais: uma linha só com o total líquido do mês (sem separar PF/PJ nem por cliente)
    const certLinha: Linha[] = certs.length ? [{ tipo: 'Certificados Digitais', cliente: `${certs.length} certificado(s)`, ref: 'Valor líquido (recebido − custo da SIC)',
      competencia: `${pRec}-01`, data: certs.map(x => x.data_pagamento).sort().pop()!, valor: Math.round(certs.reduce((t, x) => t + liquidoCert(x), 0) * 100) / 100 }] : []
    return [...certLinha, ...recs.flatMap(r => r.recibo_itens.map(i => ({
      tipo: i.tipo === 'Honorário Contábil' ? 'Honorários' : i.tipo === 'Juros/Multa Asaas' ? 'Juros/Multa (Asaas)' : i.tipo === 'Excedente Asaas' ? 'Excedente (Asaas)' : tipoDespesa(i.descricao, padroes),
      cliente: i.cliente_nome || r.cliente_nome, ref: i.descricao + (r.numero ? ` · recibo ${r.numero}` : r.metodo_pagamento ? ` · ${r.metodo_pagamento}` : ''),
      competencia: i.competencia, data: r.data_pagamento, valor: i.valor,
    })))]
  }, [qual, hon, des, iso, recs, certs, padroes])

  const resumo = useMemo(() => {
    const m = new Map<string, { tipo: string; qtd: number; total: number }>()
    for (const l of linhas || []) { const x = m.get(l.tipo) || { tipo: l.tipo, qtd: 0, total: 0 }; x.qtd++; x.total += l.valor; m.set(l.tipo, x) }
    return [...m.values()].sort((a, b) => (a.tipo === 'Honorários' ? -1 : b.tipo === 'Honorários' ? 1 : b.total - a.total))
  }, [linhas])
  const porCliente = useMemo(() => {
    const m = new Map<string, { cliente: string; hon: number; outros: number; total: number; itens: number }>()
    for (const l of linhas || []) {
      const x = m.get(l.cliente) || { cliente: l.cliente, hon: 0, outros: 0, total: 0, itens: 0 }
      if (l.tipo === 'Honorários') x.hon += l.valor; else x.outros += l.valor
      x.total += l.valor; x.itens++; m.set(l.cliente, x)
    }
    return [...m.values()].sort((a, b) => b.total - a.total)
  }, [linhas])

  const visiveis = (linhas || []).filter(l => (!filtro || l.tipo === filtro) && (!cli || normaliza(l.cliente).includes(normaliza(cli))))
    .sort((a, b) => a.tipo.localeCompare(b.tipo) || a.cliente.localeCompare(b.cliente, 'pt-BR') || (a.competencia || '').localeCompare(b.competencia || ''))
  const total = resumo.reduce((s, x) => s + x.total, 0)
  const subtitulo = qual === 'recebido' ? `Baixas feitas em ${mesRec} (competência ${c}), com e sem recibo`
    : qual === 'receber' ? `Saldo em aberto da competência ${c}` : qual === 'atraso' ? `Saldo em aberto das competências anteriores a ${c}`
    : `${porCliente.length} ${porCliente.length === 1 ? 'cliente' : 'clientes'} com honorário em aberto de competência anterior a ${c}`

  async function excel() {
    try {
      await baixarExcel(`Siscon_${TITULOS[qual].replace(/\s+/g, '_')}_${c.replace('/', '-')}.xlsx`, [
        { nome: 'Resumo por tipo', titulo: `${TITULOS[qual]} — ${subtitulo}`, total: ['qtd', 'total'],
          colunas: [{ titulo: 'Tipo', chave: 'tipo', largura: 34 }, { titulo: 'Itens', chave: 'qtd', tipo: 'numero', largura: 8 }, { titulo: 'Total', chave: 'total', tipo: 'moeda', largura: 16 }],
          linhas: resumo },
        ...(qual === 'inadimplentes' ? [{ nome: 'Por cliente', titulo: 'Inadimplentes por cliente', total: ['hon', 'outros', 'total'],
          colunas: [{ titulo: 'Cliente', chave: 'cliente', largura: 46 }, { titulo: 'Honorários', chave: 'hon', tipo: 'moeda' as const }, { titulo: 'Despesas', chave: 'outros', tipo: 'moeda' as const }, { titulo: 'Total', chave: 'total', tipo: 'moeda' as const }],
          linhas: porCliente }] : []),
        { nome: 'Detalhe', titulo: `${TITULOS[qual]} — detalhe`, total: ['valor'],
          colunas: [{ titulo: 'Tipo', chave: 'tipo', largura: 26 }, { titulo: 'Cliente', chave: 'cliente', largura: 44 }, { titulo: 'Referência', chave: 'ref', largura: 40 },
            { titulo: 'Competência', chave: 'comp', largura: 12 }, { titulo: qual === 'recebido' ? 'Pago em' : 'Vencimento/Data', chave: 'data', tipo: 'data', largura: 15 }, { titulo: 'Valor', chave: 'valor', tipo: 'moeda' }],
          linhas: visiveis.map(l => ({ ...l, comp: comp(l.competencia) })) },
      ])
    } catch (e) { avisar('Erro ao gerar Excel: ' + (e as Error).message, 'erro') }
  }

  // Grupos do detalhe (por tipo), na ordem do resumo
  const grupos = resumo.filter(x => !filtro || x.tipo === filtro).map(x => ({ ...x, itens: visiveis.filter(l => l.tipo === x.tipo) })).filter(g => g.itens.length)
  const cor = (tipo: string) => CORES[Math.max(0, resumo.findIndex(x => x.tipo === tipo)) % CORES.length]
  const totVis = visiveis.reduce((s, l) => s + l.valor, 0)
  const tom = TONS[qual]

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/55 p-3 pt-[5vh] backdrop-blur-sm sm:p-6" onMouseDown={fechar}>
      <div className="w-full max-w-6xl overflow-hidden rounded-2xl bg-slate-50 shadow-2xl ring-1 ring-black/5" onMouseDown={e => e.stopPropagation()}>
        {/* Cabeçalho azul, como o Painel */}
        <header className="relative bg-gradient-to-r from-[#16244a] via-[#1c3260] to-[#204879] px-6 py-5 text-white">
          <button onClick={fechar} aria-label="Fechar" className="absolute right-4 top-4 rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white"><Icone nome="fechar" className="h-5 w-5" /></button>
          <div className="flex flex-wrap items-end justify-between gap-4 pr-10">
            <div className="flex items-center gap-3">
              <span className={`rounded-xl p-2.5 ${tom.icone}`}><Icone nome={tom.nome} className="h-5 w-5" /></span>
              <div><h2 className="text-lg font-semibold">{TITULOS[qual]}</h2><p className="text-sm text-white/70">{subtitulo}</p></div>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-medium uppercase tracking-wider text-white/60">{qual === 'inadimplentes' ? `Total em atraso · ${porCliente.length} ${porCliente.length === 1 ? 'cliente' : 'clientes'}` : 'Total'}</p>
              <p className="num text-3xl font-bold tracking-tight">{moeda(total)}</p>
            </div>
          </div>
        </header>

        {!linhas ? <div className="p-10"><Carregando /></div> : linhas.length === 0 ? <div className="p-10"><Vazio texto="Nada a mostrar." /></div> : (
          <div className="grid gap-5 p-5 lg:grid-cols-[300px_minmax(0,1fr)]">
            {/* Totais por tipo, com barra de participação */}
            <aside className="h-fit rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Totais por tipo</p>
              <button onClick={() => setFiltro(null)} className={`mb-2 flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition ${!filtro ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                <span className="font-medium">Todos os tipos</span><span className="num font-semibold">{moeda(total)}</span></button>
              <ul className="space-y-1">
                {resumo.map(x => {
                  const pct = total ? (x.total / total) * 100 : 0, c = cor(x.tipo), ativo = filtro === x.tipo
                  return <li key={x.tipo}>
                    <button onClick={() => setFiltro(f => f === x.tipo ? null : x.tipo)}
                      className={`w-full rounded-lg px-3 py-2.5 text-left transition ${ativo ? `${c.fundo} ring-1 ${c.anel}` : 'hover:bg-slate-50'}`}>
                      <span className="flex items-center justify-between gap-2 text-sm">
                        <span className="flex min-w-0 items-center gap-2"><i className={`h-2.5 w-2.5 shrink-0 rounded-full ${c.barra}`} /><span className="truncate font-medium text-slate-800">{x.tipo}</span></span>
                        <span className="num shrink-0 font-semibold text-slate-900">{moeda(x.total)}</span>
                      </span>
                      <span className="mt-1.5 flex items-center gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><span className={`block h-full rounded-full ${c.barra}`} style={{ width: `${Math.max(pct, 2)}%` }} /></span>
                        <span className="num w-20 shrink-0 text-right text-[11px] text-slate-500">{x.qtd} {x.qtd === 1 ? 'item' : 'itens'} · {pct.toFixed(0)}%</span>
                      </span>
                    </button>
                  </li>
                })}
              </ul>
            </aside>

            <div className="min-w-0 space-y-4">
              {/* Barra de ferramentas */}
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200/70">
                <div className="relative min-w-[14rem] flex-1">
                  <Icone nome="busca" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input className="campo !h-9 !pl-9" placeholder="Filtrar por cliente" value={cli} onChange={e => setCli(e.target.value)} />
                </div>
                {(filtro || cli) && <button onClick={() => { setFiltro(null); setCli('') }} className="rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100">Limpar filtros</button>}
                <span className="px-2 text-sm text-slate-500">{visiveis.length} itens · <b className="num text-slate-900">{moeda(totVis)}</b></span>
                <button onClick={excel} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700">
                  <Icone nome="baixar" className="h-4 w-4" /> Excel</button>
              </div>

              {/* Inadimplentes: ranking de clientes */}
              {qual === 'inadimplentes' && !filtro && !cli && (
                <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200/70">
                  <p className="border-b border-slate-100 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Clientes, do maior para o menor débito</p>
                  <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                    {porCliente.map((x, i) => (
                      <li key={x.cliente}><button onClick={() => setCli(x.cliente)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${i < 3 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{x.cliente}</span>
                        <span className="hidden text-xs text-slate-500 sm:inline">Hon. {moeda(x.hon)}{x.outros ? ` · Desp. ${moeda(x.outros)}` : ''}</span>
                        <span className="num w-28 text-right font-semibold text-red-600">{moeda(x.total)}</span>
                      </button></li>))}
                  </ul>
                </div>)}

              {/* Detalhe agrupado por tipo, com subtotal */}
              <div className="max-h-[58vh] space-y-4 overflow-y-auto pr-1">
                {grupos.length === 0 ? <div className="rounded-xl bg-white shadow-sm"><Vazio texto="Nenhum item com esse filtro." /></div> : grupos.map(g => {
                  const c = cor(g.tipo)
                  return (
                    <section key={g.tipo} className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200/70">
                      <header className={`flex items-center justify-between gap-3 border-l-4 ${c.borda} px-4 py-2.5 ${c.fundo}`}>
                        <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">{g.tipo}<span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-medium text-slate-500">{g.itens.length}</span></span>
                        <span className="num text-sm font-bold text-slate-900">{moeda(g.itens.reduce((s, l) => s + l.valor, 0))}</span>
                      </header>
                      <table className="w-full text-sm">
                        <thead><tr className="text-[11px] uppercase tracking-wider text-slate-400">
                          <th className="px-4 py-2 text-left font-medium">Cliente</th><th className="px-3 py-2 text-left font-medium">Referência</th>
                          <th className="px-3 py-2 text-left font-medium">Comp.</th><th className="px-3 py-2 text-left font-medium">{qual === 'recebido' ? 'Pago em' : 'Venc./Data'}</th>
                          <th className="px-4 py-2 text-right font-medium">Valor</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">{g.itens.map((l, k) => <tr key={k} className="hover:bg-slate-50/80">
                          <td className="max-w-[15rem] truncate px-4 py-2 font-medium text-slate-800" title={l.cliente}>{l.cliente}</td>
                          <td className="max-w-[15rem] truncate px-3 py-2 text-slate-500" title={l.ref}>{l.ref}</td>
                          <td className="num px-3 py-2 text-slate-600">{comp(l.competencia)}</td>
                          <td className="num px-3 py-2 text-slate-600">{data(l.data)}</td>
                          <td className="num px-4 py-2 text-right font-semibold text-slate-900">{moeda(l.valor)}</td></tr>)}</tbody>
                      </table>
                    </section>)
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Cores por tipo (Honorários sempre o primeiro = azul) */
const CORES = [
  { barra: 'bg-blue-600', fundo: 'bg-blue-50', anel: 'ring-blue-300', borda: 'border-blue-600' },
  { barra: 'bg-amber-500', fundo: 'bg-amber-50', anel: 'ring-amber-300', borda: 'border-amber-500' },
  { barra: 'bg-emerald-500', fundo: 'bg-emerald-50', anel: 'ring-emerald-300', borda: 'border-emerald-500' },
  { barra: 'bg-violet-500', fundo: 'bg-violet-50', anel: 'ring-violet-300', borda: 'border-violet-500' },
  { barra: 'bg-rose-500', fundo: 'bg-rose-50', anel: 'ring-rose-300', borda: 'border-rose-500' },
  { barra: 'bg-cyan-500', fundo: 'bg-cyan-50', anel: 'ring-cyan-300', borda: 'border-cyan-500' },
  { barra: 'bg-orange-500', fundo: 'bg-orange-50', anel: 'ring-orange-300', borda: 'border-orange-500' },
  { barra: 'bg-teal-500', fundo: 'bg-teal-50', anel: 'ring-teal-300', borda: 'border-teal-500' },
]
const TONS: Record<Indicador, { nome: 'calendario' | 'ok' | 'alerta' | 'clientes'; icone: string }> = {
  receber: { nome: 'calendario', icone: 'bg-white/15 text-white' },
  recebido: { nome: 'ok', icone: 'bg-emerald-400/25 text-emerald-200' },
  atraso: { nome: 'alerta', icone: 'bg-red-400/25 text-red-200' },
  inadimplentes: { nome: 'clientes', icone: 'bg-amber-400/25 text-amber-200' },
}
