import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, todos, type Honorario, type Recibo, type Despesa } from '../lib/supabase'
import { useApp, useDados } from '../lib/app'
import { moeda, data, ultimasCompetencias } from '../lib/format'
import { Cabecalho, Cartao, Carregando, Indicador, Vazio } from '../components/ui'

/** 'MM/AAAA' -> prefixo 'AAAA-MM' para comparar com datas ISO */
const prefixo = (mmaaaa: string) => { const [m, a] = mmaaaa.split('/'); return `${a}-${m}` }

export default function Painel() {
  const { config } = useApp()
  const meses = useMemo(() => config.competencia_atual ? ultimasCompetencias(config.competencia_atual, 18) : [], [config.competencia_atual])
  const [mesSel, setMesSel] = useState('')
  const mes = mesSel || meses[0] || ''

  const { dados } = useDados(async () => {
    const [hon, rec, des] = await Promise.all([
      todos<Honorario>((a, b) => supabase.from('v_honorarios').select('*').range(a, b)),
      todos<Recibo>((a, b) => supabase.from('recibos').select('*').eq('cancelado', false).order('data_pagamento', { ascending: false }).range(a, b)),
      todos<Despesa>((a, b) => supabase.from('v_despesas').select('*').gt('saldo', 0).range(a, b)),
    ])
    return { hon, rec, des }
  })

  const r = useMemo(() => {
    if (!dados || !mes) return null
    const p = prefixo(mes)
    const doMes = dados.hon.filter(h => h.vencimento.startsWith(p))
    const aReceber = doMes.reduce((s, h) => s + h.valor_original + h.juros_calc - h.desconto, 0)
    const recebido = dados.rec.filter(x => x.data_pagamento.startsWith(p)).reduce((s, x) => s + x.valor, 0)
    const hoje = new Date().toISOString().slice(0, 10)
    const vencidos = dados.hon.filter(h => h.saldo > 0 && h.vencimento < hoje)
    const despAbertas = dados.des.reduce((s, d) => s + d.saldo, 0)
    const porCliente = new Map<string, { nome: string; total: number; qtd: number }>()
    for (const h of vencidos) {
      const c = porCliente.get(h.cliente_id) || { nome: h.cliente_nome, total: 0, qtd: 0 }
      c.total += h.saldo; c.qtd++; porCliente.set(h.cliente_id, c)
    }
    const ranking = [...porCliente.values()].sort((a, b) => b.total - a.total)
    const grafico = meses.slice(0, 6).reverse().map(m => {
      const pm = prefixo(m)
      return {
        mes: m,
        recebido: dados.rec.filter(x => x.data_pagamento.startsWith(pm)).reduce((s, x) => s + x.valor, 0),
        pendente: dados.hon.filter(h => h.vencimento.startsWith(pm)).reduce((s, h) => s + h.saldo, 0),
      }
    })
    return {
      aReceber, recebido, despAbertas, ranking, grafico,
      atraso: vencidos.reduce((s, h) => s + h.saldo, 0),
      pagosNoMes: doMes.filter(h => h.status === 'Pago').length, totalNoMes: doMes.length,
      ultimos: dados.rec.slice(0, 8),
    }
  }, [dados, mes, meses])

  return (
    <>
      <Cabecalho titulo="Painel" subtitulo="Visão geral dos honorários"
        acoes={<select className="campo w-40" value={mes} onChange={e => setMesSel(e.target.value)}>
          {meses.map(m => <option key={m} value={m}>Mês {m}</option>)}
        </select>} />
      {!r ? <Carregando /> : <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Indicador rotulo="A receber no mês" valor={moeda(r.aReceber)} detalhe={`Vencimentos em ${mes} · ${r.pagosNoMes}/${r.totalNoMes} pagos`} />
          <Indicador rotulo="Recebido no mês" valor={moeda(r.recebido)} tom="ok" detalhe="Recibos emitidos no mês" />
          <Indicador rotulo="Total em atraso" valor={moeda(r.atraso)} tom="perigo" detalhe="Honorários vencidos e não quitados" />
          <Indicador rotulo="Clientes inadimplentes" valor={r.ranking.length} tom="alerta" detalhe={`Despesas extras em aberto: ${moeda(r.despAbertas)}`} />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Cartao titulo="Recebido x pendente (por mês de vencimento)" className="lg:col-span-2">
            <Grafico linhas={r.grafico} />
          </Cartao>
          <Cartao titulo="Maiores inadimplências" acoes={<Link to="/relatorios" className="text-sm text-marca-700 hover:underline">Ver todas</Link>}>
            {r.ranking.length === 0 ? <Vazio texto="Nenhum cliente em atraso." /> :
              <ol className="divide-y divide-slate-100">
                {r.ranking.slice(0, 6).map((c, i) => (
                  <li key={c.nome} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className="min-w-0 truncate"><b className="mr-2 text-slate-400">{i + 1}º</b>{c.nome}</span>
                    <span className="num shrink-0 font-medium text-red-700">{moeda(c.total)}</span>
                  </li>
                ))}
              </ol>}
          </Cartao>
        </div>

        <Cartao titulo="Últimos recebimentos" className="mt-4" acoes={<Link to="/recibos" className="text-sm text-marca-700 hover:underline">Todos os recibos</Link>}>
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead><tr><th>Recibo</th><th>Cliente</th><th>Data</th><th className="text-right">Valor</th></tr></thead>
              <tbody>{r.ultimos.map(x => (
                <tr key={x.id}><td className="num">{x.numero ? `#${String(x.numero).padStart(5, '0')}` : 's/nº'}</td>
                  <td className="max-w-md truncate">{x.cliente_nome}</td><td>{data(x.data_pagamento)}</td>
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
              <div className="rounded-t bg-red-300" style={{ height: `${(l.pendente / max) * 100}%` }} />
              <div className={`bg-marca-600 ${l.pendente ? '' : 'rounded-t'}`} style={{ height: `${(l.recebido / max) * 100}%` }} />
            </div>
            <span className="text-xs text-slate-500">{l.mes}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-slate-500">
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-marca-600" />Recebido</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-red-300" />Pendente</span>
      </div>
    </div>
  )
}
