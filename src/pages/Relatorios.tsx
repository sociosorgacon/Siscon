import { Fragment, useMemo, useState } from 'react'
import { supabase, todos, type Honorario, type Recibo, type Despesa } from '../lib/supabase'
import { useApp, useDados, escritorioDe, pixDe } from '../lib/app'
import { gerarExtratoPdf } from '../lib/extrato-pdf'
import { pixCopiaECola } from '../lib/pix'
import { moeda, data, comp, compParaIso, ultimasCompetencias } from '../lib/format'
import { baixarExcel } from '../lib/excel'
import { mesSeguinte } from './Painel'
import { Abas, Botao, Cabecalho, Cartao, Carregando, Vazio, useAviso } from '../components/ui'

type Aba = 'aberto' | 'inadimplencia' | 'recebido' | 'competencias'
type Item = { tipo: 'Honorário' | 'Despesa'; cliente_id: string; cliente: string; cnpj: string; telefone: string | null; descricao: string; competencia: string; original: number; juros: number; pago: number; saldo: number }
type Grupo = { id: string; cliente: string; cnpj: string; telefone: string | null; itens: Item[]; total: number }

const agrupar = (itens: Item[]): Grupo[] => {
  const m = new Map<string, Grupo>()
  for (const i of itens) {
    const g = m.get(i.cliente_id) || { id: i.cliente_id, cliente: i.cliente, cnpj: i.cnpj, telefone: i.telefone, itens: [], total: 0 }
    g.itens.push(i); g.total += i.saldo; m.set(i.cliente_id, g)
  }
  for (const g of m.values()) g.itens.sort((a, b) => a.competencia.localeCompare(b.competencia))
  return [...m.values()].sort((a, b) => b.total - a.total)
}

function linkWhats(g: Grupo, nomeEscritorio: string, pix: { chave: string; nome: string; cidade: string }) {
  const fone = (g.telefone || '').replace(/\D/g, '')
  if (fone.length < 10) return null
  const linhas = g.itens.map(i => `• ${i.tipo === 'Honorário' ? 'Honorários' : i.descricao} ${comp(i.competencia)}: ${moeda(i.saldo)}`).join('\n')
  const total = Math.round(g.total * 100) / 100
  const pixTxt = pix.chave ? `\n\nPara pagar via Pix, copie o código abaixo no app do seu banco (valor já preenchido):\n${pixCopiaECola({ ...pix, valor: total })}` : ''
  const msg = `Olá! Aqui é da ${nomeEscritorio}. Consta em aberto:\n${linhas}\n*Total: ${moeda(total)}*${pixTxt}\n\nQualquer dúvida, estamos à disposição.`
  return `https://wa.me/55${fone.replace(/^55/, '')}?text=${encodeURIComponent(msg)}`
}

export default function Relatorios() {
  const avisar = useAviso()
  const { config } = useApp()
  const [aba, setAba] = useState<Aba>('aberto')
  const comps = useMemo(() => config.competencia_atual ? ultimasCompetencias(config.competencia_atual, 24).slice(1) : [], [config.competencia_atual])
  const [compSel, setCompSel] = useState('')
  const c = compSel || config.competencia_atual
  const iso = c ? compParaIso(c) : ''
  const [aberto, setAberto] = useState<string | null>(null)

  const { dados } = useDados(async () => {
    const [hon, rec, des] = await Promise.all([
      todos<Honorario>((a, b) => supabase.from('v_honorarios').select('*').range(a, b)),
      todos<Recibo>((a, b) => supabase.from('recibos').select('*').eq('cancelado', false).order('data_pagamento').range(a, b)),
      todos<Despesa>((a, b) => supabase.from('v_despesas').select('*').range(a, b)),
    ])
    return { hon, rec, des }
  })

  const itensAbertos = useMemo<Item[]>(() => !dados ? [] : [
    ...dados.hon.filter(h => h.saldo > 0).map(h => ({ tipo: 'Honorário' as const, cliente_id: h.cliente_id, cliente: h.cliente_nome, cnpj: h.cliente_cnpj, telefone: h.cliente_telefone, descricao: 'Honorários', competencia: h.competencia, original: h.valor_original, juros: h.juros_calc, pago: h.valor_pago_acumulado, saldo: h.saldo })),
    ...dados.des.filter(d => d.saldo > 0).map(d => ({ tipo: 'Despesa' as const, cliente_id: d.cliente_id, cliente: d.cliente_nome, cnpj: d.cliente_cnpj, telefone: d.cliente_telefone, descricao: d.descricao, competencia: d.competencia, original: d.valor, juros: 0, pago: d.valor_pago, saldo: d.saldo })),
  ], [dados])

  const ateComp = useMemo(() => agrupar(itensAbertos.filter(i => i.competencia <= iso)), [itensAbertos, iso])
  const inad = useMemo(() => agrupar(itensAbertos.filter(i => i.competencia < iso)).filter(g => g.itens.some(i => i.tipo === 'Honorário')), [itensAbertos, iso])
  const pRec = c ? mesSeguinte(c) : ''
  const recs = useMemo(() => (dados?.rec || []).filter(r => r.data_pagamento.startsWith(pRec)), [dados, pRec])
  const porComp = useMemo(() => {
    const m = new Map<string, { comp: string; qtd: number; faturado: number; recebido: number; desconto: number; saldo: number }>()
    for (const h of dados?.hon || []) {
      const x = m.get(h.competencia) || { comp: h.competencia, qtd: 0, faturado: 0, recebido: 0, desconto: 0, saldo: 0 }
      x.qtd++; x.faturado += h.valor_atualizado_calc; x.recebido += h.valor_pago_acumulado; x.desconto += h.desconto; x.saldo += h.saldo
      m.set(h.competencia, x)
    }
    return [...m.values()].sort((a, b) => b.comp.localeCompare(a.comp))
  }, [dados])

  async function extrato(g: Grupo) {
    try {
      await gerarExtratoPdf({ cliente: g.cliente, cnpj: g.cnpj, itens: g.itens.map(i => ({ ...i, descricao: i.tipo === 'Honorário' ? 'Honorários contábeis' : i.descricao })) },
        escritorioDe(config), pixDe(config))
    } catch (e) { avisar('Erro ao gerar o extrato: ' + (e as Error).message, 'erro') }
  }

  async function exportar() {
    const colItens = [{ titulo: 'Cliente', chave: 'cliente', largura: 46 }, { titulo: 'Tipo', chave: 'tipo', largura: 11 }, { titulo: 'Descrição', chave: 'descricao', largura: 28 },
      { titulo: 'Competência', chave: 'comp', largura: 12 }, { titulo: 'Original', chave: 'original', tipo: 'moeda' as const }, { titulo: 'Juros', chave: 'juros', tipo: 'moeda' as const },
      { titulo: 'Pago', chave: 'pago', tipo: 'moeda' as const }, { titulo: 'Saldo', chave: 'saldo', tipo: 'moeda' as const }]
    const plano = (gs: Grupo[]) => gs.flatMap(g => g.itens.map(i => ({ ...i, comp: comp(i.competencia) })))
    try {
      await baixarExcel(`Siscon_Relatorios_${c.replace('/', '-')}.xlsx`, [
        { nome: 'Débitos em aberto', titulo: `Débitos em aberto até a competência ${c}`, colunas: colItens, linhas: plano(ateComp), total: ['original', 'juros', 'pago', 'saldo'] },
        { nome: 'Inadimplência', titulo: `Inadimplência — competências anteriores a ${c}`, total: ['total'],
          colunas: [{ titulo: 'Cliente', chave: 'cliente', largura: 46 }, { titulo: 'Telefone', chave: 'telefone', largura: 16 }, { titulo: 'Itens', chave: 'qtd', tipo: 'numero', largura: 8 }, { titulo: 'Total em aberto', chave: 'total', tipo: 'moeda', largura: 16 }],
          linhas: inad.map(g => ({ ...g, qtd: g.itens.length })) },
        { nome: 'Inadimplência detalhada', titulo: `Inadimplência detalhada — anteriores a ${c}`, colunas: colItens, linhas: plano(inad), total: ['original', 'juros', 'pago', 'saldo'] },
        { nome: 'Recebido no mês', titulo: `Recebido em ${pRec.split('-').reverse().join('/')} (competência ${c})`, total: ['valor'],
          colunas: [{ titulo: 'Nº recibo', chave: 'numero', tipo: 'numero', largura: 10 }, { titulo: 'Data', chave: 'data_pagamento', tipo: 'data', largura: 12 },
            { titulo: 'Cliente', chave: 'cliente_nome', largura: 46 }, { titulo: 'Forma', chave: 'metodo_pagamento', largura: 14 }, { titulo: 'Valor', chave: 'valor', tipo: 'moeda' }],
          linhas: recs as unknown as Record<string, unknown>[] },
        { nome: 'Por competência', titulo: 'Posição por competência', total: ['faturado', 'recebido', 'desconto', 'saldo'],
          colunas: [{ titulo: 'Competência', chave: 'c', largura: 12 }, { titulo: 'Honorários', chave: 'qtd', tipo: 'numero', largura: 11 }, { titulo: 'Faturado (c/ juros)', chave: 'faturado', tipo: 'moeda', largura: 18 },
            { titulo: 'Recebido', chave: 'recebido', tipo: 'moeda' }, { titulo: 'Descontos', chave: 'desconto', tipo: 'moeda' }, { titulo: 'Saldo', chave: 'saldo', tipo: 'moeda' }],
          linhas: porComp.map(x => ({ ...x, c: comp(x.comp) })) },
      ])
    } catch (e) { avisar('Erro ao gerar Excel: ' + (e as Error).message, 'erro') }
  }

  const abas: [Aba, string][] = [['aberto', 'Débitos em aberto'], ['inadimplencia', 'Inadimplência'], ['recebido', 'Recebido no mês'], ['competencias', 'Por competência']]
  const grupos = aba === 'aberto' ? ateComp : inad

  return (
    <>
      <Cabecalho titulo="Relatórios" acoes={<>
        <select className="campo w-60" value={c} onChange={e => setCompSel(e.target.value)}>
          <option value={config.competencia_atual}>Competência {config.competencia_atual} (atual)</option>
          {comps.filter(x => x !== config.competencia_atual).map(m => <option key={m} value={m}>Competência {m}</option>)}
        </select>
        <Botao variante="secundario" onClick={() => window.print()}>Imprimir / PDF</Botao>
        <Botao onClick={exportar} disabled={!dados}>Exportar Excel</Botao>
      </>} />
      <Abas abas={abas} atual={aba} mudar={setAba} />
      {!dados ? <Carregando /> : <>
        {(aba === 'aberto' || aba === 'inadimplencia') && (
          <Cartao titulo={aba === 'aberto'
            ? `Débitos em aberto até ${c} · ${grupos.length} clientes · ${moeda(grupos.reduce((s, g) => s + g.total, 0))}`
            : `Inadimplência (anteriores a ${c}) · ${grupos.length} clientes · ${moeda(grupos.reduce((s, g) => s + g.total, 0))}`}>
            {grupos.length === 0 ? <Vazio texto="Nada em aberto." /> :
              <div className="overflow-x-auto"><table className="tabela">
                <thead><tr><th>Cliente</th><th className="text-right">Itens</th><th className="text-right">Total em aberto</th><th className="print:hidden" /></tr></thead>
                <tbody>{grupos.map(g => {
                  const w = linkWhats(g, config.escritorio_nome, pixDe(config))
                  return (
                    <Fragment key={g.id}>
                      <tr className="cursor-pointer" onClick={() => setAberto(aberto === g.id ? null : g.id)}>
                        <td className="max-w-md truncate"><span className="mr-1 text-slate-400">{aberto === g.id ? '▾' : '▸'}</span>{g.cliente}</td>
                        <td className="num text-right">{g.itens.length}</td>
                        <td className="num text-right font-medium text-red-700">{moeda(g.total)}</td>
                        <td className="space-x-3 whitespace-nowrap text-right print:hidden" onClick={e => e.stopPropagation()}>
                          <Botao variante="link" onClick={() => extrato(g)}>Extrato c/ Pix</Botao>
                          {w ? <a href={w} target="_blank" rel="noreferrer" className="text-sm text-emerald-700 hover:underline">WhatsApp</a> : <span className="text-xs text-slate-300">sem telefone</span>}
                        </td>
                      </tr>
                      {aberto === g.id && g.itens.map((i, k) => (
                        <tr key={k} className="bg-slate-50 text-xs text-slate-600">
                          <td className="pl-8">{i.tipo === 'Honorário' ? 'Honorários' : i.descricao} · {comp(i.competencia)}
                            {i.juros ? ` · juros ${moeda(i.juros)}` : ''}{i.pago ? ` · já pago ${moeda(i.pago)}` : ''}</td>
                          <td /><td className="num text-right">{moeda(i.saldo)}</td><td className="print:hidden" />
                        </tr>))}
                    </Fragment>)
                })}</tbody>
              </table></div>}
          </Cartao>
        )}
        {aba === 'recebido' && (
          <Cartao titulo={`Recebido em ${pRec.split('-').reverse().join('/')} · ${recs.length} baixas · ${moeda(recs.reduce((s, r) => s + r.valor, 0))}`}>
            {recs.length === 0 ? <Vazio /> : <div className="overflow-x-auto"><table className="tabela">
              <thead><tr><th>Recibo</th><th>Data</th><th>Cliente</th><th>Forma</th><th className="text-right">Valor</th></tr></thead>
              <tbody>{recs.map(r => <tr key={r.id}><td className="num">{r.numero ?? <span className="text-xs text-slate-400">sem recibo</span>}</td><td className="num">{data(r.data_pagamento)}</td>
                <td className="max-w-md truncate">{r.cliente_nome}{!r.cliente_id && <span className="ml-1 text-xs text-slate-400">(avulso)</span>}</td><td>{r.metodo_pagamento || '—'}</td><td className="num text-right">{moeda(r.valor)}</td></tr>)}</tbody>
            </table></div>}
          </Cartao>
        )}
        {aba === 'competencias' && (
          <Cartao>
            <div className="overflow-x-auto"><table className="tabela">
              <thead><tr><th>Competência</th><th className="text-right">Honorários</th><th className="text-right">Faturado</th><th className="text-right">Recebido</th><th className="text-right">Descontos</th><th className="text-right">Saldo</th><th className="text-right">% recebido</th></tr></thead>
              <tbody>{porComp.map(x => <tr key={x.comp}><td className="num">{comp(x.comp)}</td><td className="num text-right">{x.qtd}</td>
                <td className="num text-right">{moeda(x.faturado)}</td><td className="num text-right">{moeda(x.recebido)}</td><td className="num text-right">{x.desconto ? moeda(x.desconto) : '—'}</td>
                <td className="num text-right font-medium">{moeda(x.saldo)}</td><td className="num text-right">{x.faturado ? Math.round(x.recebido / x.faturado * 100) : 0}%</td></tr>)}</tbody>
            </table></div>
          </Cartao>
        )}
      </>}
    </>
  )
}
