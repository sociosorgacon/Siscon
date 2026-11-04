import { useMemo, useState } from 'react'
import { supabase, todos, type Honorario, type Despesa, type Recibo } from '../lib/supabase'
import { useApp, useDados, descricoesPadrao } from '../lib/app'
import { moeda, data, comp, normaliza } from '../lib/format'
import { baixarExcel } from '../lib/excel'
import { Botao, Carregando, Modal, Vazio, useAviso } from '../components/ui'

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
  const mesRec = pRec.split('-').reverse().join('/')

  // Recebimentos: busca as baixas do mês com os itens (só quando este indicador é aberto)
  const fim = (() => { const [a, m] = pRec.split('-').map(Number); return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01` })()
  const { dados: recs } = useDados(async () => qual !== 'recebido' ? [] :
    todos<Recibo & { recibo_itens: ItemRec[] }>((a, b) => supabase.from('recibos').select('*, recibo_itens(*)').eq('cancelado', false)
      .gte('data_pagamento', `${pRec}-01`).lt('data_pagamento', fim).order('data_pagamento').range(a, b)), [qual, pRec])

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
    if (!recs) return null
    return recs.flatMap(r => r.recibo_itens.map(i => ({
      tipo: i.tipo === 'Honorário Contábil' ? 'Honorários' : i.tipo === 'Juros/Multa Asaas' ? 'Juros/Multa (Asaas)' : i.tipo === 'Excedente Asaas' ? 'Excedente (Asaas)' : tipoDespesa(i.descricao, padroes),
      cliente: i.cliente_nome || r.cliente_nome, ref: i.descricao + (r.numero ? ` · recibo ${r.numero}` : r.metodo_pagamento ? ` · ${r.metodo_pagamento}` : ''),
      competencia: i.competencia, data: r.data_pagamento, valor: i.valor,
    })))
  }, [qual, hon, des, iso, recs, padroes])

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
    : `${porCliente.length} clientes com honorário em aberto de competência anterior a ${c}`

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

  return (
    <Modal titulo={`${TITULOS[qual]} · ${moeda(total)}`} aberto fechar={fechar} largura="max-w-5xl">
      <p className="-mt-2 mb-4 text-sm text-slate-500">{subtitulo}</p>
      {!linhas ? <Carregando /> : linhas.length === 0 ? <Vazio texto="Nada a mostrar." /> : <>
        {/* Totalizado por tipo: clique para filtrar o detalhe */}
        <div className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {resumo.map(x => (
            <button key={x.tipo} onClick={() => setFiltro(f => f === x.tipo ? null : x.tipo)}
              className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left transition ${filtro === x.tipo ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'}`}>
              <span className="min-w-0"><span className="block truncate text-sm font-medium text-slate-800">{x.tipo}</span><span className="text-xs text-slate-500">{x.qtd} {x.qtd === 1 ? 'item' : 'itens'}</span></span>
              <span className="num ml-3 shrink-0 font-semibold text-slate-900">{moeda(x.total)}</span>
            </button>))}
        </div>

        {qual === 'inadimplentes' && !filtro && (
          <div className="mb-5 overflow-x-auto rounded-lg border border-slate-200"><table className="tabela">
            <thead><tr><th>#</th><th>Cliente</th><th className="text-right">Honorários</th><th className="text-right">Despesas</th><th className="text-right">Total em atraso</th></tr></thead>
            <tbody>{porCliente.map((x, i) => <tr key={x.cliente} className="cursor-pointer" onClick={() => setCli(x.cliente)}>
              <td className="text-xs text-slate-400">{i + 1}º</td><td className="max-w-sm truncate font-medium">{x.cliente}</td>
              <td className="num text-right">{moeda(x.hon)}</td><td className="num text-right">{x.outros ? moeda(x.outros) : '—'}</td>
              <td className="num text-right font-semibold text-red-700">{moeda(x.total)}</td></tr>)}</tbody>
          </table></div>)}

        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input className="campo !h-9 max-w-xs" placeholder="Filtrar cliente" value={cli} onChange={e => setCli(e.target.value)} />
          {(filtro || cli) && <Botao variante="link" onClick={() => { setFiltro(null); setCli('') }}>Limpar filtros</Botao>}
          <span className="ml-auto text-sm text-slate-500">{visiveis.length} itens · <b className="num text-slate-800">{moeda(visiveis.reduce((s, l) => s + l.valor, 0))}</b></span>
          <Botao variante="secundario" onClick={excel}>Excel</Botao>
        </div>
        <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-200"><table className="tabela">
          <thead><tr><th>Tipo</th><th>Cliente</th><th>Referência</th><th>Comp.</th><th>{qual === 'recebido' ? 'Pago em' : 'Venc./Data'}</th><th className="text-right">Valor</th></tr></thead>
          <tbody>{visiveis.map((l, k) => <tr key={k}>
            <td className="text-xs text-slate-500">{l.tipo}</td><td className="max-w-[16rem] truncate" title={l.cliente}>{l.cliente}</td>
            <td className="max-w-[16rem] truncate text-slate-600" title={l.ref}>{l.ref}</td>
            <td className="num">{comp(l.competencia)}</td><td className="num">{data(l.data)}</td>
            <td className="num text-right font-medium">{moeda(l.valor)}</td></tr>)}</tbody>
        </table></div>
      </>}
    </Modal>
  )
}
