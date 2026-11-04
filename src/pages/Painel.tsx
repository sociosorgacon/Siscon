import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, todos, type Honorario, type Recibo, type Despesa } from '../lib/supabase'
import { useApp, useDados, escritorioDe } from '../lib/app'
import { chamarAsaas } from '../lib/asaas'
import { moeda, data, ultimasCompetencias, compParaIso } from '../lib/format'
import { Avatar, Cartao, Carregando, Vazio, useAviso } from '../components/ui'
import { Icone, type NomeIcone } from '../components/icones'
import { baixarBackup } from '../lib/backup'
import { imprimirRecibo } from '../lib/recibo-pdf'
import DetalheIndicador, { type Indicador as QualIndicador } from './PainelDetalhe'

/** Mês seguinte à competência, como prefixo 'AAAA-MM' (regra do "Recebido no mês") */
export const mesSeguinte = (mmaaaa: string) => {
  const [m, a] = mmaaaa.split('/').map(Number)
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`
}

export default function Painel() {
  const { config } = useApp()
  const avisar = useAviso()
  const [det, setDet] = useState<QualIndicador | null>(null)
  // Valores do Painel ocultos por padrão (privacidade); a escolha fica salva neste navegador
  const [oculto, setOculto] = useState(() => { try { return localStorage.getItem('siscon_ocultar_valores') !== 'nao' } catch { return true } })
  const alternarOculto = () => setOculto(o => { try { localStorage.setItem('siscon_ocultar_valores', o ? 'nao' : 'sim') } catch { /* sem armazenamento */ } return !o })
  const v = (n: number) => oculto ? 'R$ ••••••' : moeda(n)
  const comps = useMemo(() => config.competencia_atual ? ultimasCompetencias(config.competencia_atual, 18).slice(1) : [], [config.competencia_atual])
  const [compSel, setCompSel] = useState('')
  const c = compSel || config.competencia_atual

  const { dados } = useDados(async () => {
    const [hon, rec, des] = await Promise.all([
      todos<Honorario>((a, b) => supabase.from('v_honorarios').select('*').range(a, b)),
      todos<Recibo>((a, b) => supabase.from('recibos').select('*').eq('cancelado', false).order('data_pagamento', { ascending: false }).order('created_at', { ascending: false }).range(a, b)),
      todos<Despesa>((a, b) => supabase.from('v_despesas').select('*').range(a, b)),
    ])
    return { hon, rec, des }
  })

  // Saldo da conta Asaas (Edge Function); falha não atrapalha o resto do Painel
  const asaas = useDados(() => chamarAsaas<{ saldo: number }>('saldo'))
  const pendAsaas = useDados(async () => (await supabase.from('asaas_eventos').select('id', { count: 'exact', head: true }).in('status', ['pendente', 'erro'])).count || 0)

  const r = useMemo(() => {
    if (!dados || !c) return null
    const iso = compParaIso(c)
    // Regras do manual: tudo por competência
    const aReceber = dados.hon.filter(h => h.competencia === iso).reduce((s, h) => s + h.saldo, 0)
      + dados.des.filter(d => d.competencia === iso).reduce((s, d) => s + d.saldo, 0)
    const pRec = mesSeguinte(c)
    const recebido = dados.rec.filter(x => x.data_pagamento.startsWith(pRec)).reduce((s, x) => s + x.valor, 0)
    const honAtraso = dados.hon.filter(h => h.competencia < iso && h.saldo > 0)
    const atraso = honAtraso.reduce((s, h) => s + h.saldo, 0) + dados.des.filter(d => d.competencia < iso).reduce((s, d) => s + d.saldo, 0)
    const porCliente = new Map<string, { nome: string; total: number }>()
    for (const h of honAtraso) {
      const x = porCliente.get(h.cliente_id) || { nome: h.cliente_nome, total: 0 }
      x.total += h.saldo; porCliente.set(h.cliente_id, x)
    }
    const ranking = [...porCliente.values()].sort((a, b) => b.total - a.total)
    const grafico = [c, ...comps.filter(x => compParaIso(x) < iso)].slice(0, 6).reverse().map(m => {
      const i = compParaIso(m)
      const h = dados.hon.filter(x => x.competencia === i)
      return { mes: m, recebido: h.reduce((s, x) => s + x.valor_pago_acumulado, 0), pendente: h.reduce((s, x) => s + x.saldo, 0) }
    })
    return { aReceber, recebido, atraso, ranking, grafico, pRec, ultimos: dados.rec.slice(0, 8) }
  }, [dados, c, comps])

  const [aR, mR] = r?.pRec.split('-') || []
  const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
  async function backup() {
    try { await baixarBackup(); avisar('Backup baixado. Guarde em local seguro: contém dados de clientes.') }
    catch (e) { avisar((e as Error).message, 'erro') }
  }
  return (
    <>
      {/* Faixa azul no topo (como no painel do Base44) */}
      <section className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-gradient-to-r from-[#16244a] via-[#1c3260] to-[#204879] px-6 py-5 text-white shadow-lg shadow-marca-900/20">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Painel de Controle</h1>
          <p className="mt-0.5 text-sm text-white/75 first-letter:uppercase">{hoje}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="inline-flex items-center gap-2 rounded-lg bg-white/10 py-1 pl-3 pr-1 text-xs text-white/80 ring-1 ring-white/20">
            <Icone nome="calendario" className="h-3.5 w-3.5" />Competência
            <select className="rounded-md bg-white px-2 py-1 text-sm font-semibold text-slate-900 outline-none" value={c} onChange={e => setCompSel(e.target.value)}>
              <option value={config.competencia_atual}>{config.competencia_atual} (atual)</option>
              {comps.filter(x => x !== config.competencia_atual).map(m => <option key={m} value={m}>{m}</option>)}
            </select></label>
          <button onClick={alternarOculto} title={oculto ? 'Mostrar os valores' : 'Ocultar os valores'}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium ring-1 ring-white/25 hover:bg-white/20">
            <Icone nome={oculto ? 'olho' : 'olhoFechado'} className="h-3.5 w-3.5" />{oculto ? 'Mostrar valores' : 'Ocultar valores'}</button>
          {asaas.dados && <Link to="/asaas" className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white/80 ring-1 ring-white/20 hover:bg-white/15">
            Saldo Asaas <b className="ml-1 text-sm font-semibold text-white">{moeda(asaas.dados.saldo)}</b></Link>}
          <button onClick={backup} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium ring-1 ring-white/25 hover:bg-white/20">
            <Icone nome="baixar" className="h-3.5 w-3.5" /> Backup</button>
          <span className="rounded-lg bg-white px-3 py-1.5"><img src="/logo.png" alt="Orgacon" className="h-9" /></span>
        </div>
      </section>


      {!r ? <Carregando /> : <>
        {!!pendAsaas.dados && <Link to="/asaas" className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 hover:bg-amber-100">
          <Icone nome="alerta" className="h-4 w-4 shrink-0" /><span><b>{pendAsaas.dados} pagamento(s) do Asaas</b> aguardando conferência para a baixa automática.</span><span className="ml-auto font-medium">Ver →</span></Link>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {/* Cartões clicáveis: abrem o relatório do indicador, totalizado por tipo */}
          <Kpi icone="calendario" cor="azul" rotulo="A receber no mês" valor={v(r.aReceber)} detalhe={`Saldo da competência ${c}`} abrir={() => setDet('receber')} />
          <Kpi icone="ok" cor="verde" rotulo="Recebido no mês" valor={v(r.recebido)} detalhe={`Baixas em ${mR}/${aR}`} abrir={() => setDet('recebido')} />
          <Kpi icone="alerta" cor="vermelho" rotulo="Total em atraso" valor={v(r.atraso)} detalhe={`Competências anteriores a ${c}`} abrir={() => setDet('atraso')} />
          <Kpi icone="clientes" cor="laranja" rotulo="Clientes inadimplentes" valor={r.ranking.length} detalhe="Com honorário de competência anterior" abrir={() => setDet('inadimplentes')} />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Cartao titulo={<span className="inline-flex items-center gap-2"><Icone nome="ok" className="h-4 w-4 text-emerald-600" />Últimos recebimentos</span>}
            acoes={<Link to="/recibos" className="text-sm text-marca-700 hover:underline">Todas as baixas</Link>}>
            {r.ultimos.length === 0 ? <Vazio texto="Nenhum recebimento." /> :
              <ul className="divide-y divide-slate-100">
                {r.ultimos.slice(0, 6).map(x => (
                  <li key={x.id} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-slate-50/70">
                    <Avatar nome={x.cliente_nome} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-slate-700">{x.cliente_nome}</span>
                      <span className="text-xs text-slate-400">{data(x.data_pagamento)} · {x.numero
                        ? <>#{String(x.numero).padStart(5, '0')} · <button className="text-marca-700 hover:underline" onClick={() => imprimirRecibo(x.id, escritorioDe(config))}>Ver recibo</button></>
                        : 'sem recibo'}</span>
                    </span>
                    <span className="num shrink-0 font-semibold text-emerald-600">{moeda(x.valor)}</span>
                  </li>))}
              </ul>}
          </Cartao>
          <Cartao titulo="Recebimento dos honorários (últimos 6 meses)"><Grafico linhas={r.grafico} sel={c} escolher={m => setCompSel(m === config.competencia_atual ? '' : m)} /></Cartao>
        </div>

        <div className="mt-6">
          <Cartao titulo="Inadimplência" acoes={<Link to="/relatorios" className="text-sm text-marca-700 hover:underline">Ver todas</Link>}>
            {r.ranking.length === 0 ? <Vazio texto="Nenhum cliente em atraso." /> :
              <ol className="grid divide-slate-100 sm:grid-cols-2 [&>li]:border-b [&>li]:border-slate-100">
                {r.ranking.slice(0, 10).map((x, i) => (
                  <li key={x.nome} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${i < 3 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                    <Avatar nome={x.nome} />
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium text-slate-700">{x.nome}</span>
                      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-red-400" style={{ width: `${(x.total / r.ranking[0].total) * 100}%` }} /></span></span>
                    <span className="num shrink-0 font-semibold text-red-600">{moeda(x.total)}</span>
                  </li>))}
              </ol>}
          </Cartao>
        </div>
      </>}
      {det && dados && r && <DetalheIndicador qual={det} c={c} iso={compParaIso(c)} pRec={r.pRec} hon={dados.hon} des={dados.des} fechar={() => setDet(null)} />}
    </>
  )
}

/** Barras lado a lado por mês: recebido (azul) e pendente (amarelo), como no Base44 */
/** Recebimento dos honorários por competência: barra empilhada (recebido embaixo, em aberto em cima) = total faturado.
 *  Mostra quanto de cada mês já entrou e quanto falta; a % recebida fica numa linha de tabela abaixo dos meses. */
function Grafico({ linhas, sel, escolher }: { linhas: { mes: string; recebido: number; pendente: number }[]; sel: string; escolher: (m: string) => void }) {
  const [foco, setFoco] = useState<string | null>(null)
  const totais = linhas.map(l => l.recebido + l.pendente)
  const maior = Math.max(1, ...totais)
  const passo = [5000, 10000, 20000, 25000, 50000, 100000].find(p => maior / p <= 4) || Math.ceil(maior / 4)
  const topo = Math.ceil(maior / passo) * passo
  const marcas = Array.from({ length: topo / passo + 1 }, (_, i) => i * passo).reverse()
  const k = (v: number) => (v >= 1000 ? `R$ ${Math.round(v / 1000)} mil` : `R$ ${v}`)
  const pct = (l: { recebido: number; pendente: number }) => { const t = l.recebido + l.pendente; return t ? Math.round((l.recebido / t) * 100) : 0 }
  const atual = linhas.find(l => l.mes === sel) || linhas[linhas.length - 1]
  const media = linhas.length ? Math.round(linhas.reduce((s, l) => s + pct(l), 0) / linhas.length) : 0
  const ALT = 120 // px da área de plotagem

  return (
    <div className="px-5 py-4">
      {/* Destaque em uma linha: % recebido da competência × média */}
      {atual && <p className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-slate-600">
        <span><b className="num text-lg text-slate-900">{pct(atual)}%</b> recebido em {atual.mes}</span>
        <span className={`text-xs font-medium ${pct(atual) >= media ? 'text-emerald-700' : 'text-red-700'}`}>{pct(atual) >= media ? '▲' : '▼'} média 6 meses: {media}%</span>
        <span className="text-xs text-slate-500">· em aberto <b className="num text-slate-800">{moeda(atual.pendente)}</b></span>
      </p>}

      <div className="mb-2 flex items-center gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-[#2563eb]" />Recebido</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-[#ef4444]" />Em aberto</span>
        <span className="ml-auto text-slate-400">clique na barra para ver o mês</span>
      </div>

      <div className="flex gap-3">
        <div className="relative w-14 shrink-0 text-right text-[11px] text-slate-400" style={{ height: ALT }}>
          {marcas.map((m, i) => <span key={m} className="absolute right-0 -translate-y-1/2" style={{ top: `${(i / (marcas.length - 1)) * 100}%` }}>{k(m)}</span>)}
        </div>
        <div className="relative flex-1" style={{ height: ALT }}>
          {marcas.map((m, i) => <div key={m} className={`absolute inset-x-0 border-t ${m === 0 ? 'border-slate-300' : 'border-slate-100'}`} style={{ top: `${(i / (marcas.length - 1)) * 100}%` }} />)}
          <div className="absolute inset-0 flex items-end justify-around">
            {linhas.map(l => {
              const hRec = (l.recebido / topo) * ALT, hPen = (l.pendente / topo) * ALT, ativo = l.mes === sel
              return (
                <button key={l.mes} onClick={() => escolher(l.mes)} onMouseEnter={() => setFoco(l.mes)} onMouseLeave={() => setFoco(null)}
                  onFocus={() => setFoco(l.mes)} onBlur={() => setFoco(null)}
                  aria-label={`${l.mes}: recebido ${moeda(l.recebido)}, em aberto ${moeda(l.pendente)}, ${pct(l)}% recebido`}
                  className={`group relative flex h-full flex-1 flex-col items-center justify-end rounded-md transition ${ativo ? 'bg-blue-50/70' : 'hover:bg-slate-50'}`}>
                  {/* rótulo direto só no topo da barra selecionada */}
                  {ativo && <span className="num mb-1 text-[11px] font-semibold text-slate-700">{moeda(l.recebido + l.pendente)}</span>}
                  <span className="flex w-6 flex-col justify-end" style={{ height: hRec + hPen + (l.pendente && l.recebido ? 2 : 0) }}>
                    {l.pendente > 0 && <span className="block w-full rounded-t-[4px] bg-[#ef4444]" style={{ height: Math.max(hPen, 2) }} />}
                    {l.pendente > 0 && l.recebido > 0 && <span className="block h-[2px] w-full bg-white" />}
                    {l.recebido > 0 && <span className={`block w-full bg-[#2563eb] ${l.pendente ? '' : 'rounded-t-[4px]'}`} style={{ height: Math.max(hRec, 2) }} />}
                  </span>
                  {foco === l.mes && (
                    <span className="pointer-events-none absolute bottom-full z-10 mb-2 w-52 rounded-lg bg-slate-900 px-3 py-2 text-left text-xs text-white shadow-lg">
                      <b className="mb-1 block text-sm">Competência {l.mes}</b>
                      <span className="flex justify-between"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-[#2563eb]" />Recebido</span><span className="num">{moeda(l.recebido)}</span></span>
                      <span className="flex justify-between"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-[#ef4444]" />Em aberto</span><span className="num">{moeda(l.pendente)}</span></span>
                      <span className="mt-1 flex justify-between border-t border-white/15 pt-1"><span>Faturado</span><span className="num">{moeda(l.recebido + l.pendente)}</span></span>
                      <span className="flex justify-between text-white/70"><span>% recebido</span><span className="num">{pct(l)}%</span></span>
                    </span>)}
                </button>)
            })}
          </div>
        </div>
      </div>
      {/* eixo dos meses + linha de tabela com a % recebida (identidade nunca só pela cor) */}
      <div className="mt-2 flex gap-3">
        <div className="w-14 shrink-0 text-right text-[11px] leading-5 text-slate-400"><span className="block">&nbsp;</span>recebido</div>
        <div className="flex flex-1 justify-around">
          {linhas.map(l => <div key={l.mes} className="flex-1 text-center leading-5">
            <span className={`block text-xs ${l.mes === sel ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{l.mes}</span>
            <span className={`num text-[11px] font-medium ${pct(l) >= 90 ? 'text-slate-600' : 'text-red-700'}`}>{pct(l)}%</span>
          </div>)}
        </div>
      </div>
    </div>
  )
}

/** Cartão de indicador do Painel: clicável, com ícone colorido e "Ver detalhes" ao passar o mouse */
const CORES_KPI = {
  azul: { barra: 'bg-blue-600', icone: 'bg-blue-50 text-blue-600', valor: 'text-slate-900' },
  verde: { barra: 'bg-emerald-500', icone: 'bg-emerald-50 text-emerald-600', valor: 'text-emerald-700' },
  vermelho: { barra: 'bg-red-500', icone: 'bg-red-50 text-red-600', valor: 'text-red-700' },
  laranja: { barra: 'bg-amber-500', icone: 'bg-amber-50 text-amber-600', valor: 'text-amber-700' },
}
function Kpi({ icone, cor, rotulo, valor, detalhe, abrir }: { icone: NomeIcone; cor: keyof typeof CORES_KPI; rotulo: string; valor: React.ReactNode; detalhe: string; abrir: () => void }) {
  const k = CORES_KPI[cor]
  return (
    <button onClick={abrir} className="group relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white p-5 text-left shadow-[0_1px_2px_rgba(16,24,40,.04)] transition hover:-translate-y-0.5 hover:shadow-md">
      <span className={`absolute inset-x-0 top-0 h-1 ${k.barra}`} />
      <span className="flex items-start justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{rotulo}</span>
        <span className={`rounded-lg p-2 ${k.icone}`}><Icone nome={icone} className="h-4 w-4" /></span>
      </span>
      <span className={`num mt-1 block text-[26px] font-semibold leading-tight tracking-tight ${k.valor}`}>{valor}</span>
      <span className="mt-auto flex items-center justify-between gap-2 pt-2 text-xs text-slate-500">
        <span>{detalhe}</span>
        <span className="font-medium text-blue-600 opacity-0 transition group-hover:opacity-100">Ver detalhes →</span>
      </span>
    </button>
  )
}
