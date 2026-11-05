import { useEffect, useMemo, useState } from 'react'
import { supabase, todos, type Honorario, type Recibo, type Despesa } from '../lib/supabase'
import { useApp, useDados, escritorioDe, pixDe } from '../lib/app'
import { gerarExtratoPdf } from '../lib/extrato-pdf'
import { abrirBoleto } from '../lib/asaas'
import { gerarRelatorioDebitosPdf } from '../lib/relatorio-pdf'
import { pixCopiaECola, qrPix } from '../lib/pix'
import { moeda, data, comp, compParaIso, ultimasCompetencias, doc, normaliza } from '../lib/format'
import { baixarExcel } from '../lib/excel'
import { mesSeguinte } from './Painel'
import { Icone } from '../components/icones'
import { Cabecalho, Carregando, Selo, Vazio, useAviso } from '../components/ui'

type Aba = 'mensal' | 'inadimplencia' | 'financeiro'
type ItemRecibo = { tipo: string; descricao: string; valor: number; desconto: number; competencia: string | null; cliente_id: string | null; cliente_nome: string | null; honorario_id: string | null; despesa_id: string | null }
type ReciboComItens = Recibo & { recibo_itens: ItemRecibo[] }

/** Débitos em aberto de um cliente (honorários + despesas), no formato do relatório */
type Grupo = { id: string; cliente: string; cnpj: string; telefone: string | null; hon: Honorario[]; des: Despesa[]; totHon: number; totDes: number; total: number }

const r2 = (n: number) => Math.round(n * 100) / 100

function agrupar(hon: Honorario[], des: Despesa[]): Grupo[] {
  const m = new Map<string, Grupo>()
  const g = (id: string, nome: string, cnpj: string, tel: string | null) => {
    let x = m.get(id)
    if (!x) { x = { id, cliente: nome, cnpj, telefone: tel, hon: [], des: [], totHon: 0, totDes: 0, total: 0 }; m.set(id, x) }
    return x
  }
  for (const h of hon) { const x = g(h.cliente_id, h.cliente_nome, h.cliente_cnpj, h.cliente_telefone); x.hon.push(h); x.totHon += h.saldo }
  for (const d of des) { const x = g(d.cliente_id, d.cliente_nome, d.cliente_cnpj, d.cliente_telefone); x.des.push(d); x.totDes += d.saldo }
  for (const x of m.values()) {
    x.hon.sort((a, b) => a.competencia.localeCompare(b.competencia)); x.des.sort((a, b) => a.data.localeCompare(b.data))
    x.totHon = r2(x.totHon); x.totDes = r2(x.totDes); x.total = r2(x.totHon + x.totDes)
  }
  return [...m.values()].sort((a, b) => a.cliente.localeCompare(b.cliente, 'pt-BR'))
}

function linkWhats(g: Grupo, nomeEscritorio: string, pix: { chave: string; nome: string; cidade: string }) {
  const fone = (g.telefone || '').replace(/\D/g, '')
  if (fone.length < 10) return null
  const linhas = [
    ...g.hon.map(h => `• Honorários ${comp(h.competencia)}: ${moeda(h.saldo)}`),
    ...g.des.map(d => `• ${d.descricao}: ${moeda(d.saldo)}`),
  ].join('\n')
  const pixTxt = pix.chave ? `\n\nPara pagar via Pix, copie o código abaixo no app do seu banco (valor já preenchido):\n${pixCopiaECola({ ...pix, valor: g.total })}` : ''
  const msg = `Olá! Aqui é da ${nomeEscritorio}. Consta em aberto:\n${linhas}\n*Total: ${moeda(g.total)}*${pixTxt}\n\nQualquer dúvida, estamos à disposição.`
  return `https://wa.me/55${fone.replace(/^55/, '')}?text=${encodeURIComponent(msg)}`
}

const SituacaoSelo = ({ s }: { s: string }) => <Selo texto={s === 'Pago Parcial' ? 'Pago Parcial' : s} />

export default function Relatorios() {
  const avisar = useAviso()
  const { config } = useApp()
  const [aba, setAba] = useState<Aba>('mensal')
  const comps = useMemo(() => config.competencia_atual ? ultimasCompetencias(config.competencia_atual, 24).slice(1) : [], [config.competencia_atual])
  const [compSel, setCompSel] = useState('')
  const c = compSel || config.competencia_atual
  const iso = c ? compParaIso(c) : ''
  const [sel, setSel] = useState<Set<string> | null>(null) // null = todos os clientes
  const [buscaCli, setBuscaCli] = useState('')
  const [qr, setQr] = useState('')

  const { dados } = useDados(async () => {
    const [hon, des] = await Promise.all([
      todos<Honorario>((a, b) => supabase.from('v_honorarios').select('*').range(a, b)),
      todos<Despesa>((a, b) => supabase.from('v_despesas').select('*').range(a, b)),
    ])
    return { hon, des }
  })
  const pRec = c ? mesSeguinte(c) : ''
  const { dados: recs } = useDados(async () => !pRec ? [] : todos<ReciboComItens>((a, b) => supabase.from('recibos')
    .select('*, recibo_itens(*)').eq('cancelado', false).gte('data_pagamento', `${pRec}-01`).lt('data_pagamento', `${mesSeguinte(pRec.split('-').reverse().join('/'))}-01`).order('data_pagamento').range(a, b)), [pRec])

  const pix = pixDe(config)
  useEffect(() => { if (pix.chave) qrPix(pix, 220).then(q => setQr(q.imagem)).catch(() => setQr('')) }, [pix.chave, pix.nome, pix.cidade]) // eslint-disable-line react-hooks/exhaustive-deps

  const abertos = useMemo(() => !dados ? null : {
    hon: dados.hon.filter(h => h.saldo > 0.009), des: dados.des.filter(d => d.saldo > 0.009),
  }, [dados])
  // Mensal: tudo em aberto até a competência; Inadimplência: só competências anteriores (cliente com honorário atrasado)
  // Boleto do Asaas em aberto de cada cliente (para o botão "Boleto Asaas" no cartão)
  const boletosAsaas = useDados(async () => {
    const [cob, cli] = await Promise.all([
      todos<{ payment_id: string; customer_id: string | null; cpf_cnpj: string | null; vencimento: string; status: string; fatura: string | null }>((a, b) =>
        supabase.from('asaas_cobrancas').select('payment_id, customer_id, cpf_cnpj, vencimento, status, fatura').in('status', ['PENDING', 'OVERDUE']).range(a, b)),
      todos<{ id: string; cnpj: string | null; asaas_customer_id: string | null; boleto_cliente_id: string | null }>((a, b) =>
        supabase.from('clientes').select('id, cnpj, asaas_customer_id, boleto_cliente_id').range(a, b)),
    ])
    const porId = new Map(cli.map(c => [c.id, c]))
    // (devolve um objeto: useDados guarda o resultado num estado do React, que trataria uma função como atualizador)
    return { achar: (clienteId: string) => {
      const c = porId.get(porId.get(clienteId)?.boleto_cliente_id || clienteId); if (!c) return null
      const doc = (c.cnpj || '').replace(/\D/g, '')
      const meus = cob.filter(b => (c.asaas_customer_id && b.customer_id === c.asaas_customer_id) || (doc && b.cpf_cnpj === doc))
      // o pendente mais próximo; se não houver, o vencido mais recente
      return meus.filter(b => b.status === 'PENDING').sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0]
        || meus.sort((a, b) => b.vencimento.localeCompare(a.vencimento))[0] || null
    } }
  })
  const gruposMensal = useMemo(() => !abertos ? [] : agrupar(abertos.hon.filter(h => h.competencia <= iso), abertos.des.filter(d => d.competencia <= iso)), [abertos, iso])
  const gruposInad = useMemo(() => !abertos ? [] : agrupar(abertos.hon.filter(h => h.competencia < iso), abertos.des.filter(d => d.competencia < iso)).filter(g => g.hon.length), [abertos, iso])
  const base = aba === 'inadimplencia' ? gruposInad : gruposMensal
  const visiveis = sel ? base.filter(g => sel.has(g.id)) : base
  const listaCli = base.filter(g => !buscaCli || normaliza(`${g.cliente} ${g.cnpj}`).includes(normaliza(buscaCli)))

  function alternar(id: string) {
    setSel(s => {
      const n = new Set(s ?? [])
      if (n.has(id)) n.delete(id); else n.add(id)
      return n.size ? n : null
    })
  }

  async function extrato(g: Grupo) {
    try {
      const itens = [
        ...g.hon.map(h => ({ tipo: 'Honorário' as const, descricao: 'Honorários contábeis', competencia: h.competencia, original: h.valor_original, juros: h.juros_calc, pago: h.valor_pago_acumulado, saldo: h.saldo })),
        ...g.des.map(d => ({ tipo: 'Despesa' as const, descricao: d.descricao, competencia: d.competencia, original: d.valor, juros: 0, pago: d.valor_pago, saldo: d.saldo })),
      ]
      await gerarExtratoPdf({ cliente: g.cliente, cnpj: g.cnpj, itens }, escritorioDe(config), pix)
    } catch (e) { avisar('Erro ao gerar a relação de honorários: ' + (e as Error).message, 'erro') }
  }

  // Financeiro: baixas feitas no mês seguinte à competência, agrupadas por cliente (como o relatório do Base44)
  const fin = useMemo(() => {
    if (!recs || !dados) return null
    const honPorId = new Map(dados.hon.map(h => [h.id, h]))
    const m = new Map<string, { cliente: string; cnpj: string; hon: { comp: string; valor: number; pago: number; venc: string; status: string }[]; des: { desc: string; valor: number; data: string }[]; outros: number; datas: Set<string>; total: number }>()
    for (const r of recs) for (const i of r.recibo_itens) {
      const id = i.cliente_id || r.cliente_id || r.cliente_nome
      const h = i.honorario_id ? honPorId.get(i.honorario_id) : undefined
      const x = m.get(id) || { cliente: i.cliente_nome || r.cliente_nome, cnpj: h?.cliente_cnpj || r.cliente_cnpj || '', hon: [], des: [], outros: 0, datas: new Set<string>(), total: 0 }
      if (i.tipo === 'Honorário Contábil') x.hon.push({ comp: i.competencia || '', valor: h?.valor_original ?? i.valor, pago: i.valor, venc: h?.vencimento || '', status: h?.status || '' })
      else if (i.tipo === 'Despesa Extra') x.des.push({ desc: i.descricao, valor: i.valor, data: r.data_pagamento })
      else x.outros += i.valor
      x.datas.add(r.data_pagamento); x.total += i.valor; m.set(id, x)
    }
    const lista = [...m.values()].map(x => ({ ...x, total: r2(x.total) })).sort((a, b) => a.cliente.localeCompare(b.cliente, 'pt-BR'))
    const totHon = r2(lista.reduce((s, x) => s + x.hon.reduce((t, h) => t + h.pago, 0), 0))
    const totDes = r2(lista.reduce((s, x) => s + x.des.reduce((t, d) => t + d.valor, 0), 0))
    const totOut = r2(lista.reduce((s, x) => s + x.outros, 0))
    return { lista, totHon, totDes, totOut, total: r2(totHon + totDes + totOut) }
  }, [recs, dados])

  const porComp = useMemo(() => {
    const m = new Map<string, { comp: string; qtd: number; faturado: number; recebido: number; desconto: number; saldo: number }>()
    for (const h of dados?.hon || []) {
      const x = m.get(h.competencia) || { comp: h.competencia, qtd: 0, faturado: 0, recebido: 0, desconto: 0, saldo: 0 }
      x.qtd++; x.faturado += h.valor_atualizado_calc; x.recebido += h.valor_pago_acumulado; x.desconto += h.desconto; x.saldo += h.saldo
      m.set(h.competencia, x)
    }
    return [...m.values()].sort((a, b) => b.comp.localeCompare(a.comp)).slice(0, 12)
  }, [dados])

  /** PDF compacto: débitos em aberto até a COMPETÊNCIA ATUAL (sem parcelas futuras), clientes selecionados ou todos;
   *  uma linha por empresa com totalizador (honorários, despesas e total) */
  async function pdfCompleto() {
    if (!abertos) return
    const atual = compParaIso(config.competencia_atual)
    const grupos = agrupar(abertos.hon.filter(h => h.competencia <= atual), abertos.des.filter(d => d.competencia <= atual))
      .filter(g => !sel || sel.has(g.id))
    try {
      await gerarRelatorioDebitosPdf({ titulo: 'DÉBITOS EM ABERTO', subtitulo: `Até a competência ${config.competencia_atual}`, grupos }, escritorioDe(config))
    } catch (e) { avisar('Erro ao gerar o PDF: ' + (e as Error).message, 'erro') }
  }

  async function exportar() {
    const linhasAberto = (gs: Grupo[]) => gs.flatMap(g => [
      ...g.hon.map(h => ({ cliente: g.cliente, cnpj: doc(g.cnpj), tipo: 'Honorário', descricao: 'Honorários', comp: comp(h.competencia), venc: h.vencimento, original: h.valor_original + h.juros_calc, pago: h.valor_pago_acumulado, saldo: h.saldo, status: h.situacao })),
      ...g.des.map(d => ({ cliente: g.cliente, cnpj: doc(g.cnpj), tipo: 'Despesa', descricao: d.descricao, comp: comp(d.competencia), venc: d.data, original: d.valor, pago: d.valor_pago, saldo: d.saldo, status: d.status })),
    ])
    const col = [{ titulo: 'Cliente', chave: 'cliente', largura: 44 }, { titulo: 'CNPJ/CPF', chave: 'cnpj', largura: 20 }, { titulo: 'Tipo', chave: 'tipo', largura: 11 },
      { titulo: 'Descrição', chave: 'descricao', largura: 28 }, { titulo: 'Competência', chave: 'comp', largura: 12 }, { titulo: 'Vencimento/Data', chave: 'venc', tipo: 'data' as const, largura: 15 },
      { titulo: 'Valor', chave: 'original', tipo: 'moeda' as const }, { titulo: 'Pago', chave: 'pago', tipo: 'moeda' as const },
      { titulo: 'Saldo devedor', chave: 'saldo', tipo: 'moeda' as const, largura: 15 }, { titulo: 'Status', chave: 'status', largura: 13 }]
    try {
      await baixarExcel(`Siscon_Relatorio_${c.replace('/', '-')}.xlsx`, [
        { nome: 'Resumo por cliente', titulo: `Débitos em aberto até ${c} — por cliente`, total: ['totHon', 'totDes', 'total'],
          colunas: [{ titulo: 'Cliente', chave: 'cliente', largura: 44 }, { titulo: 'CNPJ/CPF', chave: 'doc', largura: 20 }, { titulo: 'Telefone', chave: 'telefone', largura: 16 },
            { titulo: 'Honorários', chave: 'totHon', tipo: 'moeda' }, { titulo: 'Despesas', chave: 'totDes', tipo: 'moeda' }, { titulo: 'Total a receber', chave: 'total', tipo: 'moeda', largura: 16 }],
          linhas: gruposMensal.map(g => ({ ...g, doc: doc(g.cnpj) })) },
        { nome: 'Débitos em aberto', titulo: `Débitos em aberto até a competência ${c}`, colunas: col, linhas: linhasAberto(gruposMensal), total: ['original', 'pago', 'saldo'] },
        { nome: 'Inadimplência', titulo: `Inadimplência — competências anteriores a ${c}`, colunas: col, linhas: linhasAberto(gruposInad), total: ['original', 'pago', 'saldo'] },
        { nome: 'Baixas do mês', titulo: `Baixas realizadas em ${pRec.split('-').reverse().join('/')} (competência ${c})`, total: ['pago'],
          colunas: [{ titulo: 'Cliente', chave: 'cliente', largura: 44 }, { titulo: 'Tipo', chave: 'tipo', largura: 11 }, { titulo: 'Referência', chave: 'ref', largura: 30 },
            { titulo: 'Valor', chave: 'valor', tipo: 'moeda' }, { titulo: 'Valor pago', chave: 'pago', tipo: 'moeda' }, { titulo: 'Vencimento', chave: 'venc', tipo: 'data', largura: 12 }],
          linhas: (fin?.lista || []).flatMap(x => [
            ...x.hon.map(h => ({ cliente: x.cliente, tipo: 'Honorário', ref: comp(h.comp), valor: h.valor, pago: h.pago, venc: h.venc })),
            ...x.des.map(d => ({ cliente: x.cliente, tipo: 'Despesa', ref: d.desc, valor: d.valor, pago: d.valor, venc: d.data })),
            ...(x.outros ? [{ cliente: x.cliente, tipo: 'Outros', ref: 'Juros/serviços avulsos', valor: x.outros, pago: x.outros, venc: '' }] : []),
          ]) },
        { nome: 'Por competência', titulo: 'Posição por competência (honorários)', total: ['faturado', 'recebido', 'desconto', 'saldo'],
          colunas: [{ titulo: 'Competência', chave: 'c', largura: 12 }, { titulo: 'Honorários', chave: 'qtd', tipo: 'numero', largura: 11 }, { titulo: 'Faturado (c/ juros)', chave: 'faturado', tipo: 'moeda', largura: 18 },
            { titulo: 'Recebido', chave: 'recebido', tipo: 'moeda' }, { titulo: 'Descontos', chave: 'desconto', tipo: 'moeda' }, { titulo: 'Saldo', chave: 'saldo', tipo: 'moeda' }],
          linhas: porComp.map(x => ({ ...x, c: comp(x.comp) })) },
      ])
    } catch (e) { avisar('Erro ao gerar Excel: ' + (e as Error).message, 'erro') }
  }

  const totHon = r2(visiveis.reduce((s, g) => s + g.totHon, 0)), totDes = r2(visiveis.reduce((s, g) => s + g.totDes, 0))
  const agora = new Date()

  return (
    <>
      <div className="print:hidden">
        <Cabecalho icone="relatorios" titulo="Relatórios" subtitulo="Débitos em aberto, inadimplência e recebimentos, com Pix, WhatsApp, Excel e impressão"
          acoes={<>
            <button onClick={pdfCompleto} disabled={!dados} title={`Débitos em aberto até a competência atual (${config.competencia_atual}), uma linha por empresa`}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50">
              <Icone nome="baixar" className="h-4 w-4" /> Relatório completo (PDF)</button>
            <button onClick={exportar} disabled={!dados} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-50">Excel</button>
            <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-[#204879] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#1b3d68]">
              <Icone nome="recibos" className="h-4 w-4" /> Imprimir / PDF</button>
          </>} />
        <div className="mb-5 inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
          {([['mensal', 'Relatório Mensal', 'calendario'], ['inadimplencia', 'Inadimplência', 'alerta'], ['financeiro', 'Financeiro Geral', 'relatorios']] as const).map(([k, t, ic]) => (
            <button key={k} onClick={() => { setAba(k); setSel(null) }}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${aba === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
              <Icone nome={ic} className={`h-4 w-4 ${aba === k ? 'text-blue-600' : ''}`} />{t}</button>))}
        </div>
      </div>

      {!dados ? <Carregando /> : (
        <div className={aba === 'financeiro' ? '' : 'grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]'}>
          {aba !== 'financeiro' && (
            <aside className="h-fit rounded-xl border border-slate-200 bg-white shadow-sm print:hidden lg:sticky lg:top-20">
              <p className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700"><Icone nome="clientes" className="h-4 w-4 text-slate-400" />Clientes <span className="ml-auto text-xs text-slate-400">{base.length}</span></p>
              <div className="p-2">
                <input className="campo !h-8 mb-2 text-xs" placeholder="Buscar cliente" value={buscaCli} onChange={e => setBuscaCli(e.target.value)} />
                <button onClick={() => setSel(null)} className={`mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${!sel ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}>
                  <input type="checkbox" readOnly checked={!sel} /> Todos os clientes</button>
                <ul className="max-h-[60vh] overflow-y-auto">
                  {listaCli.map(g => <li key={g.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50" title={g.cliente}>
                      <input type="checkbox" checked={!!sel?.has(g.id)} onChange={() => alternar(g.id)} />
                      <span className="truncate">{g.cliente}</span></label></li>)}
                </ul>
              </div>
            </aside>
          )}

          <div className="min-w-0 space-y-3">
            {/* Bloco Pix: só na impressão */}
            {aba !== 'financeiro' && (
              <div className="mx-auto hidden w-fit items-center gap-5 rounded-xl bg-white px-6 py-3 shadow-sm ring-1 ring-slate-100 print:flex">
                <img src="/logo.png" alt="Orgacon" className="h-10" />
                <span className="h-16 w-px bg-slate-300" />
                <div className="text-center">
                  <p className="text-sm font-bold text-[#204879]">PIX</p>
                  {qr ? <img src={qr} alt="QR Code Pix" className="mx-auto h-20 w-20" /> : <div className="h-20 w-20" />}
                  <p className="text-[11px] font-semibold text-[#204879]">Chave {doc(pix.chave)}</p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2 shadow-sm print:border-0 print:shadow-none">
              <Icone nome="calendario" className="h-4 w-4 text-slate-500" />
              <span className="text-sm font-medium text-slate-700">{aba === 'financeiro' ? 'Competência:' : aba === 'inadimplencia' ? 'Atrasados antes da competência:' : 'Débitos até a competência:'}</span>
              <select className="campo !h-9 w-44" value={c} onChange={e => setCompSel(e.target.value)}>
                <option value={config.competencia_atual}>{config.competencia_atual} (atual)</option>
                {comps.filter(x => x !== config.competencia_atual).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              {aba === 'financeiro' && <span className="text-xs text-slate-500">Baixas realizadas em {pRec.split('-').reverse().join('/')} (mês seguinte à competência)</span>}
            </div>

            {aba === 'financeiro' ? <Financeiro fin={fin} porComp={porComp} c={c} pRec={pRec} /> : <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-2 text-center">
                  <p className="text-sm font-medium uppercase tracking-wide text-blue-800">Total honorários em aberto</p>
                  <p className="num text-xl font-bold text-blue-700">{moeda(totHon)}</p></div>
                <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-2 text-center">
                  <p className="text-sm font-medium uppercase tracking-wide text-orange-800">Total despesas em aberto</p>
                  <p className="num text-xl font-bold text-orange-700">{moeda(totDes)}</p></div>
              </div>

              {visiveis.length === 0 ? <div className="rounded-xl bg-white shadow-sm"><Vazio texto="Nada em aberto." /></div> :
                visiveis.map(g => { const bol = boletosAsaas.dados?.achar(g.id); return <CartaoCliente key={g.id} g={g} whats={linkWhats(g, config.escritorio_nome, pix)} extrato={() => extrato(g)}
                  boleto={bol ? () => abrirBoleto({ id: bol.payment_id, fatura: bol.fatura, vencimento: bol.vencimento }).catch(e => avisar((e as Error).message, 'erro')) : undefined} /> })}

              <div className="flex items-center justify-between rounded-xl bg-[#1b2a4a] px-5 py-2.5 text-white">
                <span className="font-semibold uppercase tracking-wide">Total geral em aberto{sel ? ` (${visiveis.length} selecionados)` : ''}</span>
                <span className="num text-xl font-bold">{moeda(totHon + totDes)}</span>
              </div>
            </>}
            <p className="text-center text-xs text-slate-500">Relatório gerado em {agora.toLocaleDateString('pt-BR')} às {agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {config.escritorio_nome}</p>
          </div>
        </div>
      )}
    </>
  )
}

function CartaoCliente({ g, whats, extrato, boleto }: { g: Grupo; whats: string | null; extrato: () => void; boleto?: () => void }) {
  return (
    <section className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-100 break-inside-avoid">
      <header className="flex flex-wrap items-center justify-between gap-2 bg-[#1b2a4a] px-4 py-2 text-white">
        <h3 className="text-sm font-semibold">{g.cliente}</h3><span className="num text-sm text-blue-200">{g.cnpj ? doc(g.cnpj) : ''}</span>
      </header>
      <div className="px-3 pb-3 pt-2">
        {g.hon.length > 0 && <>
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600"><Icone nome="honorarios" className="h-3.5 w-3.5" />Honorários</p>
          <div className="overflow-x-auto"><table className="tabela compacta">
            <thead><tr><th>Competência</th><th className="text-right">Valor</th><th className="text-right">Valor pago</th><th className="text-right">Saldo devedor</th><th className="text-center">Vencimento</th><th className="text-center">Status</th></tr></thead>
            <tbody>{g.hon.map(h => <tr key={h.id}>
              <td className="num">{comp(h.competencia)}</td>
              <td className="num text-right" title={h.juros_calc > 0 ? `Inclui ${moeda(h.juros_calc)} de juros` : undefined}>{moeda(h.valor_original + h.juros_calc)}</td>
              <td className="num text-right text-emerald-700">{h.valor_pago_acumulado ? moeda(h.valor_pago_acumulado) : '—'}</td>
              <td className="num text-right font-semibold">{moeda(h.saldo)}</td>
              <td className="num text-center">{data(h.vencimento)}</td>
              <td className="text-center"><SituacaoSelo s={h.situacao} /></td>
            </tr>)}</tbody>
          </table></div>
        </>}
        {g.des.length > 0 && <>
          <p className={`mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-orange-700 ${g.hon.length ? 'mt-2' : ''}`}><Icone nome="alerta" className="h-3.5 w-3.5" />Despesas extras em aberto</p>
          <div className="overflow-x-auto"><table className="tabela compacta">
            <thead><tr className="[&>th]:!bg-orange-50"><th>Descrição</th><th className="text-right">Valor</th><th className="text-center">Data</th>{g.des.some(d => d.observacoes) && <th>Obs.</th>}</tr></thead>
            <tbody>{g.des.map(d => <tr key={d.id}>
              <td>{d.descricao}</td>
              <td className="num text-right font-medium text-orange-700">{moeda(d.saldo)}{d.valor_pago > 0 && <span className="block text-[11px] text-slate-400">de {moeda(d.valor)}</span>}</td>
              <td className="num text-center">{data(d.data)}</td>
              {g.des.some(x => x.observacoes) && <td className="max-w-xs truncate text-slate-500" title={d.observacoes || ''}>{d.observacoes || '—'}</td>}
            </tr>)}</tbody>
          </table></div>
        </>}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-blue-50/70 px-3 py-1.5 text-sm">
          <span className="text-slate-600">
            {g.hon.length > 0 && <>Honorários: <b className="num text-slate-900">{moeda(g.totHon)}</b></>}
            {g.des.length > 0 && <span className={g.hon.length ? 'ml-4' : ''}>Despesas: <b className="num text-orange-700">{moeda(g.totDes)}</b></span>}
          </span>
          <span className="flex items-center gap-3">
            <span className="text-slate-600">Total a receber: <b className="num text-base text-slate-900">{moeda(g.total)}</b></span>
            <button onClick={extrato} className="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-200 hover:bg-blue-50 print:hidden">Relação c/ Pix</button>
            {boleto && <button onClick={boleto} title="Abrir o boleto em aberto no Asaas (PDF)" className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-200 hover:bg-blue-50 print:hidden"><img src="/asaas.png" alt="" className="h-3 w-3" />Boleto Asaas</button>}
            {whats && <a href={whats} target="_blank" rel="noreferrer" className="rounded-md bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-600 print:hidden">WhatsApp</a>}
          </span>
        </div>
      </div>
    </section>
  )
}

type Fin = { lista: { cliente: string; cnpj: string; hon: { comp: string; valor: number; pago: number; venc: string; status: string }[]; des: { desc: string; valor: number; data: string }[]; outros: number; datas: Set<string>; total: number }[]; totHon: number; totDes: number; totOut: number; total: number } | null

function Financeiro({ fin, porComp, c, pRec }: { fin: Fin; porComp: { comp: string; qtd: number; faturado: number; recebido: number; desconto: number; saldo: number }[]; c: string; pRec: string }) {
  if (!fin) return <Carregando />
  const mes = pRec.split('-').reverse().join('/')
  return <>
    <h2 className="text-center text-lg font-semibold text-slate-800">Baixas realizadas no mês de {mes} (competência: {c})</h2>
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-2 text-center"><p className="text-sm font-medium uppercase tracking-wide text-blue-800">Total honorários</p><p className="num text-xl font-bold text-blue-700">{moeda(fin.totHon)}</p></div>
      <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-2 text-center"><p className="text-sm font-medium uppercase tracking-wide text-orange-800">Total despesas</p><p className="num text-xl font-bold text-orange-700">{moeda(fin.totDes)}</p></div>
      <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-2 text-center"><p className="text-sm font-medium uppercase tracking-wide text-emerald-800">Juros e outros</p><p className="num text-xl font-bold text-emerald-700">{moeda(fin.totOut)}</p></div>
    </div>
    {fin.lista.length === 0 ? <div className="rounded-xl bg-white shadow-sm"><Vazio texto={`Nenhuma baixa em ${mes}.`} /></div> : fin.lista.map(x => (
      <section key={x.cliente} className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-100 break-inside-avoid">
        <header className="flex flex-wrap items-center justify-between gap-2 bg-[#1b2a4a] px-4 py-2 text-white"><h3 className="text-sm font-semibold">{x.cliente}</h3><span className="num text-sm text-blue-200">{x.cnpj ? doc(x.cnpj) : ''}</span></header>
        <div className="px-3 pb-3 pt-2">
          {x.hon.length > 0 && <div className="overflow-x-auto"><table className="tabela compacta">
            <thead><tr><th>Competência</th><th className="text-right">Valor</th><th className="text-right">Valor pago</th><th className="text-center">Vencimento</th><th className="text-center">Status</th></tr></thead>
            <tbody>{x.hon.map((h, k) => <tr key={k}><td className="num">{comp(h.comp)}</td><td className="num text-right">{moeda(h.valor)}</td><td className="num text-right font-semibold text-emerald-700">{moeda(h.pago)}</td>
              <td className="num text-center">{data(h.venc)}</td><td className="text-center">{h.status && <Selo texto={h.status} />}</td></tr>)}</tbody>
          </table></div>}
          {x.des.length > 0 && <div className={`overflow-x-auto ${x.hon.length ? 'mt-3' : ''}`}><table className="tabela compacta">
            <thead><tr className="[&>th]:!bg-orange-50"><th>Despesa extra</th><th className="text-right">Valor</th><th className="text-center">Data</th></tr></thead>
            <tbody>{x.des.map((d, k) => <tr key={k}><td>{d.desc}</td><td className="num text-right font-medium text-orange-700">{moeda(d.valor)}</td><td className="num text-center">{data(d.data)}</td></tr>)}</tbody>
          </table></div>}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-blue-50/70 px-3 py-1.5 text-sm text-slate-600">
            <span>Honorários: <b className="num text-slate-900">{moeda(x.hon.reduce((s, h) => s + h.pago, 0))}</b>
              <span className="ml-4">Despesas: <b className="num text-orange-700">{moeda(x.des.reduce((s, d) => s + d.valor, 0))}</b></span>
              {x.outros > 0 && <span className="ml-4">Juros/outros: <b className="num text-emerald-700">{moeda(x.outros)}</b></span>}
              <span className="ml-4">Data: <b className="num">{[...x.datas].sort().map(d => data(d)).join(', ')}</b></span></span>
            <span>Total: <b className="num text-base text-slate-900">{moeda(x.total)}</b></span>
          </div>
        </div>
      </section>))}
    <div className="flex items-center justify-between rounded-xl bg-[#1b2a4a] px-5 py-2.5 text-white">
      <span className="font-semibold uppercase tracking-wide">Total geral recebido em {mes}</span><span className="num text-xl font-bold">{moeda(fin.total)}</span>
    </div>

    <section className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-100 break-inside-avoid">
      <header className="bg-slate-50 px-5 py-3 text-sm font-semibold text-slate-700">Posição por competência (honorários) — últimas 12</header>
      <div className="overflow-x-auto"><table className="tabela compacta">
        <thead><tr><th>Competência</th><th className="text-right">Honorários</th><th className="text-right">Faturado</th><th className="text-right">Recebido</th><th className="text-right">Descontos</th><th className="text-right">Saldo</th><th className="text-right">% recebido</th></tr></thead>
        <tbody>{porComp.map(x => <tr key={x.comp}><td className="num">{comp(x.comp)}</td><td className="num text-right">{x.qtd}</td>
          <td className="num text-right">{moeda(x.faturado)}</td><td className="num text-right">{moeda(x.recebido)}</td><td className="num text-right">{x.desconto ? moeda(x.desconto) : '—'}</td>
          <td className="num text-right font-medium">{moeda(x.saldo)}</td><td className="num text-right">{x.faturado ? Math.round(x.recebido / x.faturado * 100) : 0}%</td></tr>)}</tbody>
      </table></div>
    </section>
  </>
}
