import { Fragment, useMemo, useState } from 'react'
import { supabase, todos, type Honorario, type Recibo, type Despesa } from '../lib/supabase'
import { useDados } from '../lib/app'
import { moeda, data, comp, hojeIso } from '../lib/format'
import { baixarExcel } from '../lib/excel'
import { Botao, Cabecalho, Cartao, Carregando, Vazio, useAviso } from '../components/ui'

type Aba = 'inadimplencia' | 'recebimentos' | 'competencias'

export default function Relatorios() {
  const avisar = useAviso()
  const [aba, setAba] = useState<Aba>('inadimplencia')
  const hoje = hojeIso()
  const [de, setDe] = useState(hoje.slice(0, 8) + '01')
  const [ate, setAte] = useState(hoje)
  const [aberto, setAberto] = useState<string | null>(null)

  const { dados } = useDados(async () => {
    const [hon, rec, des] = await Promise.all([
      todos<Honorario>((a, b) => supabase.from('v_honorarios').select('*').order('competencia').range(a, b)),
      todos<Recibo>((a, b) => supabase.from('recibos').select('*').eq('cancelado', false).order('data_pagamento').range(a, b)),
      todos<Despesa>((a, b) => supabase.from('v_despesas').select('*').gt('saldo', 0).range(a, b)),
    ])
    return { hon, rec, des }
  })

  const inad = useMemo(() => {
    if (!dados) return []
    const m = new Map<string, { cliente: string; cnpj: string; itens: Honorario[]; original: number; juros: number; saldo: number; despesas: number }>()
    for (const h of dados.hon.filter(h => h.saldo > 0 && h.vencimento < hoje)) {
      const c = m.get(h.cliente_id) || { cliente: h.cliente_nome, cnpj: h.cliente_cnpj, itens: [], original: 0, juros: 0, saldo: 0, despesas: 0 }
      c.itens.push(h); c.original += h.valor_original; c.juros += h.juros_calc; c.saldo += h.saldo; m.set(h.cliente_id, c)
    }
    for (const d of dados.des) { const c = m.get(d.cliente_id); if (c) c.despesas += d.saldo }
    return [...m.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.saldo - a.saldo)
  }, [dados, hoje])

  const recs = useMemo(() => (dados?.rec || []).filter(r => r.data_pagamento >= de && r.data_pagamento <= ate), [dados, de, ate])
  const porForma = useMemo(() => {
    const m = new Map<string, number>()
    recs.forEach(r => m.set(r.metodo_pagamento || 'Não informado', (m.get(r.metodo_pagamento || 'Não informado') || 0) + r.valor))
    return [...m.entries()]
  }, [recs])

  const comps = useMemo(() => {
    const m = new Map<string, { comp: string; qtd: number; faturado: number; recebido: number; desconto: number; saldo: number }>()
    for (const h of dados?.hon || []) {
      const c = m.get(h.competencia) || { comp: h.competencia, qtd: 0, faturado: 0, recebido: 0, desconto: 0, saldo: 0 }
      c.qtd++; c.faturado += h.valor_atualizado_calc; c.recebido += h.valor_pago_acumulado; c.desconto += h.desconto; c.saldo += h.saldo
      m.set(h.competencia, c)
    }
    return [...m.values()].sort((a, b) => b.comp.localeCompare(a.comp))
  }, [dados])

  async function exportar() {
    try {
      await baixarExcel(`Siscon_Relatorios_${hoje}.xlsx`, [
        {
          nome: 'Inadimplência', titulo: `Inadimplência por cliente — posição em ${data(hoje)}`, total: ['original', 'juros', 'saldo', 'despesas'],
          colunas: [{ titulo: 'Cliente', chave: 'cliente', largura: 48 }, { titulo: 'CNPJ/CPF', chave: 'cnpj', largura: 18 }, { titulo: 'Qtd. meses', chave: 'qtd', largura: 11, tipo: 'numero' },
            { titulo: 'Competências', chave: 'comps', largura: 40 }, { titulo: 'Valor original', chave: 'original', tipo: 'moeda' }, { titulo: 'Juros', chave: 'juros', tipo: 'moeda' },
            { titulo: 'Saldo honorários', chave: 'saldo', tipo: 'moeda' }, { titulo: 'Despesas em aberto', chave: 'despesas', tipo: 'moeda' }],
          linhas: inad.map(c => ({ ...c, qtd: c.itens.length, comps: c.itens.map(i => comp(i.competencia)).join(', ') })),
        },
        {
          nome: 'Inadimplência detalhada', titulo: 'Honorários vencidos — detalhe', total: ['valor_original', 'juros_calc', 'saldo'],
          colunas: [{ titulo: 'Cliente', chave: 'cliente_nome', largura: 48 }, { titulo: 'Competência', chave: 'comp', largura: 12 }, { titulo: 'Vencimento', chave: 'vencimento', tipo: 'data', largura: 12 },
            { titulo: 'Valor original', chave: 'valor_original', tipo: 'moeda' }, { titulo: 'Meses de juros', chave: 'meses_atraso', tipo: 'numero', largura: 13 },
            { titulo: 'Juros', chave: 'juros_calc', tipo: 'moeda' }, { titulo: 'Pago', chave: 'valor_pago_acumulado', tipo: 'moeda' }, { titulo: 'Saldo', chave: 'saldo', tipo: 'moeda' }],
          linhas: inad.flatMap(c => c.itens.map(i => ({ ...i, comp: comp(i.competencia) }))),
        },
        {
          nome: 'Recebimentos', titulo: `Recebimentos de ${data(de)} a ${data(ate)}`, total: ['valor'],
          colunas: [{ titulo: 'Nº recibo', chave: 'numero', tipo: 'numero', largura: 10 }, { titulo: 'Data', chave: 'data_pagamento', tipo: 'data', largura: 12 },
            { titulo: 'Cliente', chave: 'cliente_nome', largura: 48 }, { titulo: 'Forma', chave: 'metodo_pagamento', largura: 14 }, { titulo: 'Valor', chave: 'valor', tipo: 'moeda' }],
          linhas: recs as unknown as Record<string, unknown>[],
        },
        {
          nome: 'Por competência', titulo: 'Posição por competência', total: ['faturado', 'recebido', 'desconto', 'saldo'],
          colunas: [{ titulo: 'Competência', chave: 'c', largura: 12 }, { titulo: 'Honorários', chave: 'qtd', tipo: 'numero', largura: 11 }, { titulo: 'Faturado (c/ juros)', chave: 'faturado', tipo: 'moeda', largura: 18 },
            { titulo: 'Recebido', chave: 'recebido', tipo: 'moeda' }, { titulo: 'Descontos', chave: 'desconto', tipo: 'moeda' }, { titulo: 'Saldo', chave: 'saldo', tipo: 'moeda' }],
          linhas: comps.map(c => ({ ...c, c: comp(c.comp) })),
        },
      ])
    } catch (e) { avisar('Erro ao gerar Excel: ' + (e as Error).message, 'erro') }
  }

  const abas: [Aba, string][] = [['inadimplencia', 'Inadimplência'], ['recebimentos', 'Recebimentos'], ['competencias', 'Por competência']]

  return (
    <>
      <Cabecalho titulo="Relatórios" acoes={<Botao onClick={exportar} disabled={!dados}>Exportar Excel</Botao>} />
      <div className="mb-3 flex gap-1 border-b border-slate-200">
        {abas.map(([k, n]) => <button key={k} onClick={() => setAba(k)}
          className={`-mb-px border-b-2 px-4 py-2 text-sm ${aba === k ? 'border-marca-700 font-medium text-marca-800' : 'border-transparent text-slate-500'}`}>{n}</button>)}
      </div>
      {!dados ? <Carregando /> : <>
        {aba === 'inadimplencia' && (
          <Cartao titulo={`${inad.length} clientes com honorários vencidos · ${moeda(inad.reduce((s, c) => s + c.saldo, 0))}`}>
            {inad.length === 0 ? <Vazio texto="Nenhum honorário vencido." /> :
              <div className="overflow-x-auto"><table className="tabela">
                <thead><tr><th>Cliente</th><th className="text-right">Meses</th><th className="text-right">Original</th><th className="text-right">Juros</th><th className="text-right">Saldo</th><th className="text-right">Despesas</th></tr></thead>
                <tbody>{inad.map(c => (
                  <Fragment key={c.id}>
                    <tr className="cursor-pointer" onClick={() => setAberto(aberto === c.id ? null : c.id)}>
                      <td className="max-w-md truncate"><span className="mr-1 text-slate-400">{aberto === c.id ? '▾' : '▸'}</span>{c.cliente}</td>
                      <td className="num text-right">{c.itens.length}</td><td className="num text-right">{moeda(c.original)}</td>
                      <td className="num text-right">{moeda(c.juros)}</td><td className="num text-right font-medium text-red-700">{moeda(c.saldo)}</td>
                      <td className="num text-right">{c.despesas ? moeda(c.despesas) : '—'}</td>
                    </tr>
                    {aberto === c.id && c.itens.map(i => (
                      <tr key={i.id} className="bg-slate-50 text-xs text-slate-600">
                        <td className="pl-8">Competência {comp(i.competencia)} · venceu {data(i.vencimento)}{i.status === 'Pago Parcial' ? ' · pago parcial' : ''}</td>
                        <td className="num text-right">{i.meses_atraso || ''}</td><td className="num text-right">{moeda(i.valor_original)}</td>
                        <td className="num text-right">{moeda(i.juros_calc)}</td><td className="num text-right">{moeda(i.saldo)}</td><td />
                      </tr>))}
                  </Fragment>))}</tbody>
              </table></div>}
          </Cartao>
        )}
        {aba === 'recebimentos' && (
          <Cartao titulo={`${recs.length} recibos · ${moeda(recs.reduce((s, r) => s + r.valor, 0))}`}
            acoes={<div className="flex gap-2"><input className="campo" type="date" value={de} onChange={e => setDe(e.target.value)} /><input className="campo" type="date" value={ate} onChange={e => setAte(e.target.value)} /></div>}>
            <div className="flex flex-wrap gap-4 border-b border-slate-100 px-4 py-3 text-sm">
              {porForma.map(([f, v]) => <span key={f}>{f}: <b className="num">{moeda(v)}</b></span>)}
            </div>
            {recs.length === 0 ? <Vazio /> : <div className="overflow-x-auto"><table className="tabela">
              <thead><tr><th>Nº</th><th>Data</th><th>Cliente</th><th>Forma</th><th className="text-right">Valor</th></tr></thead>
              <tbody>{recs.map(r => <tr key={r.id}><td className="num">{r.numero ?? 's/nº'}</td><td className="num">{data(r.data_pagamento)}</td>
                <td className="max-w-md truncate">{r.cliente_nome}</td><td>{r.metodo_pagamento || '—'}</td><td className="num text-right">{moeda(r.valor)}</td></tr>)}</tbody>
            </table></div>}
          </Cartao>
        )}
        {aba === 'competencias' && (
          <Cartao>
            <div className="overflow-x-auto"><table className="tabela">
              <thead><tr><th>Competência</th><th className="text-right">Honorários</th><th className="text-right">Faturado</th><th className="text-right">Recebido</th><th className="text-right">Descontos</th><th className="text-right">Saldo</th><th className="text-right">% recebido</th></tr></thead>
              <tbody>{comps.map(c => <tr key={c.comp}><td className="num">{comp(c.comp)}</td><td className="num text-right">{c.qtd}</td>
                <td className="num text-right">{moeda(c.faturado)}</td><td className="num text-right">{moeda(c.recebido)}</td><td className="num text-right">{c.desconto ? moeda(c.desconto) : '—'}</td>
                <td className="num text-right font-medium">{moeda(c.saldo)}</td><td className="num text-right">{c.faturado ? Math.round(c.recebido / c.faturado * 100) : 0}%</td></tr>)}</tbody>
            </table></div>
          </Cartao>
        )}
      </>}
    </>
  )
}
