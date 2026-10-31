import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, todos, type Honorario, type Recibo, type Despesa } from '../lib/supabase'
import { useApp, useDados } from '../lib/app'
import { chamarAsaas } from '../lib/asaas'
import { moeda, data, ultimasCompetencias, compParaIso } from '../lib/format'
import { Cabecalho, Cartao, Carregando, Indicador, Vazio } from '../components/ui'

/** Mês seguinte à competência, como prefixo 'AAAA-MM' (regra do "Recebido no mês") */
export const mesSeguinte = (mmaaaa: string) => {
  const [m, a] = mmaaaa.split('/').map(Number)
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`
}

export default function Painel() {
  const { config } = useApp()
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
  return (
    <>
      <Cabecalho titulo="Painel" subtitulo="Indicadores pela competência"
        acoes={<select className="campo w-60" value={c} onChange={e => setCompSel(e.target.value)}>
          <option value={config.competencia_atual}>Competência {config.competencia_atual} (atual)</option>
          {comps.filter(x => x !== config.competencia_atual).map(m => <option key={m} value={m}>Competência {m}</option>)}
        </select>} />
      {!r ? <Carregando /> : <>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Indicador icone="calendario" rotulo="A receber no mês" valor={moeda(r.aReceber)} detalhe={`Saldo da competência ${c} (honorários + despesas)`} />
          <Indicador icone="ok" rotulo="Recebido no mês" valor={moeda(r.recebido)} tom="ok" detalhe={`Baixas em ${mR}/${aR}, com e sem recibo`} />
          <Indicador icone="alerta" rotulo="Total em atraso" valor={moeda(r.atraso)} tom="perigo" detalhe={`Competências anteriores a ${c}`} />
          <Indicador icone="clientes" rotulo="Clientes inadimplentes" valor={r.ranking.length} tom="alerta" detalhe="Com honorário em aberto de competência anterior" />
          <Indicador icone="receber" rotulo="Saldo Asaas" tom="ok"
            valor={asaas.dados ? moeda(asaas.dados.saldo) : asaas.erro ? '—' : '…'}
            detalhe={asaas.erro ? <span title={asaas.erro}>Indisponível · <Link to="/asaas" className="text-marca-700 hover:underline">ver</Link></span> : <Link to="/asaas" className="text-marca-700 hover:underline">Conferência Asaas</Link>} />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <Cartao titulo="Recebido x pendente por competência" className="lg:col-span-2"><Grafico linhas={r.grafico} /></Cartao>
          <Cartao titulo="Inadimplência" acoes={<Link to="/relatorios" className="text-sm text-marca-700 hover:underline">Ver todas</Link>}>
            {r.ranking.length === 0 ? <Vazio texto="Nenhum cliente em atraso." /> :
              <ol className="divide-y divide-slate-100">
                {r.ranking.slice(0, 5).map((x, i) => (
                  <li key={x.nome} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span className="flex min-w-0 items-center gap-3"><b className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] ${i === 0 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</b><span className="truncate">{x.nome}</span></span>
                    <span className="num shrink-0 font-medium text-red-700">{moeda(x.total)}</span>
                  </li>))}
              </ol>}
          </Cartao>
        </div>

        <Cartao titulo="Últimos recebimentos" className="mt-6" acoes={<Link to="/recibos" className="text-sm text-marca-700 hover:underline">Todas as baixas</Link>}>
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead><tr><th>Recibo</th><th>Cliente</th><th>Data</th><th className="text-right">Valor</th></tr></thead>
              <tbody>{r.ultimos.map(x => (
                <tr key={x.id}>
                  <td className="num">{x.numero ? `#${String(x.numero).padStart(5, '0')}` : <span className="text-xs text-slate-400">(sem recibo)</span>}</td>
                  <td className="max-w-md truncate">{x.cliente_nome}</td><td className="num">{data(x.data_pagamento)}</td>
                  <td className="num text-right">{moeda(x.valor)}</td></tr>))}</tbody>
            </table>
          </div>
        </Cartao>
      </>}
    </>
  )
}

function Grafico({ linhas }: { linhas: { mes: string; recebido: number; pendente: number }[] }) {
  const max = Math.max(1, ...linhas.map(l => l.recebido + l.pendente))
  return (
    <div className="p-4">
      <div className="flex h-56 items-end gap-3">
        {linhas.map(l => (
          <div key={l.mes} className="flex flex-1 flex-col items-center gap-1" title={`${l.mes}\nRecebido: ${moeda(l.recebido)}\nPendente: ${moeda(l.pendente)}`}>
            <div className="flex w-full max-w-14 flex-col justify-end" style={{ height: '13rem' }}>
              <div className="rounded-t bg-red-400" style={{ height: `${(l.pendente / max) * 100}%` }} />
              <div className={`bg-marca-600 ${l.pendente ? '' : 'rounded-t'}`} style={{ height: `${(l.recebido / max) * 100}%` }} />
            </div>
            <span className="text-xs text-slate-500">{l.mes}</span>
          </div>))}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-slate-500">
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-marca-600" />Recebido</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-red-400" />Em aberto</span>
      </div>
    </div>
  )
}
