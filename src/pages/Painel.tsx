import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, todos, type Honorario, type Recibo, type Despesa } from '../lib/supabase'
import { useApp, useDados, escritorioDe } from '../lib/app'
import { chamarAsaas } from '../lib/asaas'
import { moeda, data, ultimasCompetencias, compParaIso } from '../lib/format'
import { Cartao, Carregando, Indicador, Vazio, useAviso } from '../components/ui'
import { Icone } from '../components/icones'
import { baixarBackup } from '../lib/backup'
import { imprimirRecibo } from '../lib/recibo-pdf'

/** Mês seguinte à competência, como prefixo 'AAAA-MM' (regra do "Recebido no mês") */
export const mesSeguinte = (mmaaaa: string) => {
  const [m, a] = mmaaaa.split('/').map(Number)
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`
}

export default function Painel() {
  const { config } = useApp()
  const avisar = useAviso()
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
        <div className="flex flex-wrap items-center gap-3">
          {asaas.dados && <Link to="/asaas" className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white/80 ring-1 ring-white/20 hover:bg-white/15">
            Saldo Asaas <b className="ml-1 text-sm font-semibold text-white">{moeda(asaas.dados.saldo)}</b></Link>}
          <button onClick={backup} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium ring-1 ring-white/25 hover:bg-white/20">
            <Icone nome="baixar" className="h-3.5 w-3.5" /> Backup</button>
          <span className="rounded-lg bg-white px-3 py-1.5"><img src="/logo.png" alt="Orgacon" className="h-9" /></span>
        </div>
      </section>

      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-marca-100 bg-white px-5 py-3 shadow-sm">
        <Icone nome="calendario" className="h-4 w-4 text-marca-700" />
        <span className="text-sm font-medium text-slate-700">Competência:</span>
        <select className="campo !h-9 w-56" value={c} onChange={e => setCompSel(e.target.value)}>
          <option value={config.competencia_atual}>{config.competencia_atual} (atual)</option>
          {comps.filter(x => x !== config.competencia_atual).map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {!r ? <Carregando /> : <>
        {!!pendAsaas.dados && <Link to="/asaas" className="mb-4 block rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 hover:bg-amber-100">
          {pendAsaas.dados} pagamento(s) do Asaas aguardando conferência para a baixa automática. Clique para ver.</Link>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Indicador icone="calendario" rotulo="A receber no mês" valor={moeda(r.aReceber)} detalhe={`Saldo da competência ${c} (honorários + despesas)`} />
          <Indicador icone="ok" rotulo="Recebido no mês" valor={moeda(r.recebido)} tom="ok" detalhe={`Baixas em ${mR}/${aR}, com e sem recibo`} />
          <Indicador icone="alerta" rotulo="Total em atraso" valor={moeda(r.atraso)} tom="perigo" detalhe={`Competências anteriores a ${c}`} />
          <Indicador icone="clientes" rotulo="Clientes inadimplentes" valor={r.ranking.length} tom="alerta" detalhe="Com honorário em aberto de competência anterior" />
        </div>

        <Cartao titulo="Recebimentos x Pendências (últimos 6 meses)" className="mt-6"><Grafico linhas={r.grafico} /></Cartao>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Cartao titulo="Inadimplência" acoes={<Link to="/relatorios" className="text-sm text-marca-700 hover:underline">Ver todas</Link>}>
            {r.ranking.length === 0 ? <Vazio texto="Nenhum cliente em atraso." /> :
              <ol className="divide-y divide-slate-100">
                {r.ranking.slice(0, 6).map((x, i) => (
                  <li key={x.nome} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span className="flex min-w-0 items-center gap-3"><span className="w-6 shrink-0 text-xs text-slate-400">{i + 1}º</span><span className="truncate font-medium text-slate-700">{x.nome}</span></span>
                    <span className="num shrink-0 font-semibold text-red-600">{moeda(x.total)}</span>
                  </li>))}
              </ol>}
          </Cartao>
          <Cartao titulo={<span className="inline-flex items-center gap-2"><Icone nome="ok" className="h-4 w-4 text-emerald-600" />Últimos recebimentos</span>}
            acoes={<Link to="/recibos" className="text-sm text-marca-700 hover:underline">Todas as baixas</Link>}>
            {r.ultimos.length === 0 ? <Vazio texto="Nenhum recebimento." /> :
              <ul className="divide-y divide-slate-100">
                {r.ultimos.slice(0, 6).map(x => (
                  <li key={x.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-700">{x.cliente_nome}</span>
                      <span className="text-xs text-slate-400">{data(x.data_pagamento)} · {x.numero
                        ? <>#{String(x.numero).padStart(5, '0')} · <button className="text-marca-700 hover:underline" onClick={() => imprimirRecibo(x.id, escritorioDe(config))}>Ver recibo</button></>
                        : 'sem recibo'}</span>
                    </span>
                    <span className="num shrink-0 font-semibold text-emerald-600">{moeda(x.valor)}</span>
                  </li>))}
              </ul>}
          </Cartao>
        </div>
      </>}
    </>
  )
}

/** Barras lado a lado por mês: recebido (azul) e pendente (amarelo), como no Base44 */
function Grafico({ linhas }: { linhas: { mes: string; recebido: number; pendente: number }[] }) {
  const maior = Math.max(1, ...linhas.flatMap(l => [l.recebido, l.pendente]))
  const passo = [1000, 2000, 5000, 10000, 20000, 25000, 50000, 100000].find(p => maior / p <= 5) || Math.ceil(maior / 5)
  const topo = Math.ceil(maior / passo) * passo
  const marcas = Array.from({ length: topo / passo + 1 }, (_, i) => i * passo).reverse()
  const k = (v: number) => `R$${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`
  return (
    <div className="p-5">
      <div className="flex gap-2">
        <div className="flex h-60 flex-col justify-between pb-6 text-right text-[11px] text-slate-400">{marcas.map(m => <span key={m} className="leading-none">{k(m)}</span>)}</div>
        <div className="relative flex-1">
          <div className="absolute inset-x-0 top-0 bottom-6 flex flex-col justify-between">{marcas.map(m => <div key={m} className="border-t border-dashed border-slate-200" />)}</div>
          <div className="relative flex h-60 items-end gap-4 pb-6">
            {linhas.map(l => (
              <div key={l.mes} className="relative flex h-full flex-1 flex-col justify-end" title={`${l.mes}\nRecebido: ${moeda(l.recebido)}\nPendente: ${moeda(l.pendente)}`}>
                <div className="flex h-full items-end justify-center gap-1.5">
                  <div className="w-full max-w-16 rounded-t bg-blue-600" style={{ height: `${(l.recebido / topo) * 100}%` }} />
                  <div className="w-full max-w-16 rounded-t bg-red-400" style={{ height: `${(l.pendente / topo) * 100}%` }} />
                </div>
                <span className="absolute inset-x-0 -bottom-6 text-center text-xs text-slate-500">{l.mes}</span>
              </div>))}
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-4 text-xs text-slate-500">
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-blue-600" />Recebido</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-red-400" />Pendente</span>
      </div>
    </div>
  )
}
