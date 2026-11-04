import { useMemo, useState } from 'react'
import { supabase, ok, todos, type Cliente, type Honorario, type Despesa } from '../lib/supabase'
import { useApp, useDados } from '../lib/app'
import { chamarAsaas, type AssinaturaAsaas, type CobrancaAsaas } from '../lib/asaas'
import AsaasExtrato from './AsaasExtrato'
import { moeda, data, comp, doc, normaliza } from '../lib/format'
import { baixarExcel } from '../lib/excel'
import { Avatar, Botao, Cabecalho, Campo, Cartao, Carregando, Modal, Pilulas, Resumo, Selo, Vazio, useAviso } from '../components/ui'
import { Icone, type NomeIcone } from '../components/icones'

const dig = (s: string | null | undefined) => (s || '').replace(/\D/g, '')
const r2 = (n: number) => Math.round(n * 100) / 100
/** Boleto com vencimento no mês M corresponde à competência M-1 (vencimento = mês seguinte à competência) */
const compDoVenc = (venc: string) => {
  const [a, m] = venc.split('-').map(Number)
  return m === 1 ? `${a - 1}-12-01` : `${a}-${String(m - 1).padStart(2, '0')}-01`
}

type Evento = { id: string; evento: string; payment_id: string | null; customer_id: string | null; valor: number | null; vencimento: string | null
  data_pagamento: string | null; descricao: string | null; status: 'processado' | 'pendente' | 'ignorado' | 'erro'; mensagem: string | null
  recibo_id: string | null; recebido_em: string }
const NOMES_EVENTO: Record<string, string> = { PAYMENT_RECEIVED: 'Pagamento recebido', PAYMENT_CONFIRMED: 'Pagamento confirmado',
  PAYMENT_REFUNDED: 'Estorno', PAYMENT_RECEIVED_IN_CASH_UNDONE: 'Recebimento desfeito', PAYMENT_CHARGEBACK_DONE: 'Chargeback' }
const COR_STATUS: Record<Evento['status'], string> = { processado: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  pendente: 'bg-amber-50 text-amber-700 ring-amber-200', erro: 'bg-red-50 text-red-700 ring-red-200', ignorado: 'bg-slate-100 text-slate-500 ring-slate-200' }
const ROTULO_STATUS: Record<Evento['status'], string> = { processado: 'Baixado', pendente: 'Conferir', erro: 'Erro', ignorado: 'Ignorado' }

export default function Asaas() {
  const [aba, setAba] = useState<'baixas' | 'extrato' | 'conferencia'>('baixas')
  return (
    <>
      <Cabecalho icone="receber" titulo="Integração Asaas" subtitulo="Baixa automática dos boletos pagos, importação do extrato e conferência das assinaturas" />
      <div className="mb-5 inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
        {([['baixas', 'Baixas automáticas', 'ok'], ['extrato', 'Importar extrato (OFX)', 'baixar'], ['conferencia', 'Conferência de assinaturas', 'relatorios']] as const).map(([k, t, ic]) => (
          <button key={k} onClick={() => setAba(k)} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${aba === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
            <Icone nome={ic} className={`h-4 w-4 ${aba === k ? 'text-blue-600' : ''}`} />{t}</button>))}
      </div>
      {aba === 'baixas' ? <Baixas /> : aba === 'extrato' ? <AsaasExtrato /> : <Conferencia />}
    </>
  )
}

/** Pagamentos avisados pelo Asaas (webhook) e o resultado da baixa automática */
function Baixas() {
  const avisar = useAviso()
  const [so, setSo] = useState<'conferir' | 'todos'>('conferir')
  const [vinc, setVinc] = useState<Evento | null>(null)
  const [clienteSel, setClienteSel] = useState('')
  const [busca, setBusca] = useState('')
  const { dados, recarregar } = useDados(async () => {
    const [ev, cli] = await Promise.all([
      todos<Evento>((a, b) => supabase.from('asaas_eventos').select('id, evento, payment_id, customer_id, valor, vencimento, data_pagamento, descricao, status, mensagem, recibo_id, recebido_em')
        .order('recebido_em', { ascending: false }).range(a, b)),
      todos<Cliente>((a, b) => supabase.from('clientes').select('*').order('razao_social').range(a, b)),
    ])
    return { ev, cli }
  })
  const nomeDe = (customer: string | null) => dados?.cli.find(c => customer && c.asaas_customer_id === customer)?.razao_social
  const lista = (dados?.ev || []).filter(e => so === 'todos' || e.status === 'pendente' || e.status === 'erro')
  const nConferir = (dados?.ev || []).filter(e => e.status === 'pendente' || e.status === 'erro').length

  async function acao(fn: () => PromiseLike<{ data: unknown; error: { message: string } | null }>, msg: string) {
    try { ok(await fn()); avisar(msg); recarregar() } catch (e) { avisar((e as Error).message, 'erro') }
  }
  async function vincular() {
    if (!vinc?.customer_id || !clienteSel) return
    await acao(() => supabase.rpc('asaas_vincular_cliente', { p_customer_id: vinc.customer_id, p_cliente_id: clienteSel }),
      'Cliente vinculado. Os pagamentos pendentes dele foram reprocessados.')
    setVinc(null); setClienteSel(''); setBusca('')
  }
  const opcoes = (dados?.cli || []).filter(c => !busca || normaliza(`${c.razao_social} ${c.cnpj}`).includes(normaliza(busca)))

  return (
    <>
      {dados && (() => {
        const proc = dados.ev.filter(e => e.status === 'processado' && /RECEIVED|CONFIRMED/.test(e.evento))
        return <Resumo itens={[
          { rotulo: 'Baixados automaticamente', valor: moeda(proc.reduce((t, e) => t + (e.valor || 0), 0)), detalhe: `${proc.length} pagamentos`, tom: 'verde' },
          { rotulo: 'A conferir', valor: dados.ev.filter(e => e.status === 'pendente').length, detalhe: 'vincular cliente ou valor diferente', tom: 'laranja' },
          { rotulo: 'Com erro', valor: dados.ev.filter(e => e.status === 'erro').length, detalhe: 'use Reprocessar', tom: 'vermelho' },
          { rotulo: 'Último aviso', valor: dados.ev[0] ? data(dados.ev[0].recebido_em) : '—', detalhe: `${dados.ev.length} avisos recebidos`, tom: 'azul' },
        ]} />
      })()}
      {nConferir > 0 && <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <Icone nome="alerta" className="mt-0.5 h-4 w-4 shrink-0" /><span><b>{nConferir} pagamento(s)</b> aguardando conferência. Na primeira vez de cada cliente, use <b>Vincular cliente</b>: depois disso as baixas dele são automáticas.</span></div>}
      <Cartao>
        <div className="filtros">
          <Pilulas atual={so} mudar={setSo} opcoes={[['conferir', 'A conferir', nConferir], ['todos', 'Todos os avisos', (dados?.ev || []).length]] as const} />
          <span className="ml-auto" /><Botao variante="secundario" onClick={recarregar}><span className="inline-flex items-center gap-1.5"><Icone nome="alta" className="h-4 w-4" />Atualizar</span></Botao>
        </div>
        {!dados ? <Carregando /> : lista.length === 0 ? <Vazio texto={so === 'conferir' ? 'Nada aguardando conferência.' : 'Nenhum aviso do Asaas recebido ainda.'} /> :
          <div className="overflow-x-auto"><table className="tabela">
            <thead><tr><th>Aviso</th><th>Cliente</th><th>Venc. / Pago em</th><th className="text-right">Valor</th><th>Situação</th><th className="text-right">Ações</th></tr></thead>
            <tbody>{lista.map(e => <tr key={e.id} className="align-top">
              <td>{NOMES_EVENTO[e.evento] || e.evento}<span className="block text-xs text-slate-400">{data(e.recebido_em)}</span></td>
              <td className="!whitespace-normal min-w-[10rem] max-w-[16rem]" title={e.descricao || ''}>{nomeDe(e.customer_id)
                ? <span className="flex items-center gap-2"><Avatar nome={nomeDe(e.customer_id)!} /><span className="font-medium text-slate-800">{nomeDe(e.customer_id)}</span></span>
                : <span className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-700"><Icone nome="alerta" className="h-4 w-4" /></span><span className="text-xs text-slate-500">{e.customer_id || '—'}<br /><b className="text-amber-700">sem vínculo</b></span></span>}</td>
              <td className="num">{data(e.vencimento)}<span className="block text-xs text-slate-400">pago {data(e.data_pagamento)}</span></td>
              <td className="num text-right">{moeda(e.valor)}</td>
              <td className="!whitespace-normal min-w-[12rem]"><span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${COR_STATUS[e.status]}`}>{ROTULO_STATUS[e.status]}</span>
                {e.mensagem && <span className="mt-1 block text-xs text-slate-500">{e.mensagem}</span>}</td>
              <td className="pr-5 text-right">
                {(e.status === 'pendente' || e.status === 'erro') && <div className="flex flex-col items-end gap-1">
                  {e.customer_id && !nomeDe(e.customer_id) && <Botao variante="link" onClick={() => setVinc(e)}>Vincular cliente</Botao>}
                  <Botao variante="link" onClick={() => acao(() => supabase.rpc('asaas_processar', { p_id: e.id }), 'Reprocessado.')}>Reprocessar</Botao>
                  <Botao variante="link" className="!text-slate-500" onClick={() => confirm('Ignorar este aviso? Use quando a baixa já foi feita manualmente.') &&
                    acao(() => supabase.from('asaas_eventos').update({ status: 'ignorado', mensagem: 'Ignorado manualmente' }).eq('id', e.id), 'Aviso ignorado.')}>Ignorar</Botao>
                </div>}
              </td>
            </tr>)}</tbody>
          </table></div>}
      </Cartao>
      <Modal titulo="Vincular cliente do Asaas" aberto={!!vinc} fechar={() => setVinc(null)}>
        <p className="mb-3 text-sm text-slate-600">Cliente do Asaas <b>{vinc?.customer_id}</b>{vinc?.descricao ? <> · boleto "{vinc.descricao}"</> : null} · {moeda(vinc?.valor)}, venc. {data(vinc?.vencimento)}.
          Escolha o cliente do Siscon. Os próximos pagamentos dele serão baixados automaticamente.</p>
        <Campo rotulo="Buscar"><input className="campo" placeholder="Nome ou CNPJ" value={busca} onChange={e => setBusca(e.target.value)} /></Campo>
        <select className="campo mt-2" size={8} value={clienteSel} onChange={e => setClienteSel(e.target.value)}>
          {opcoes.map(c => <option key={c.id} value={c.id}>{c.razao_social} — {doc(c.cnpj)}</option>)}
        </select>
        <div className="mt-4 flex justify-end gap-2">
          <Botao variante="secundario" onClick={() => setVinc(null)}>Cancelar</Botao>
          <Botao disabled={!clienteSel} onClick={vincular}>Vincular e dar baixa</Botao>
        </div>
      </Modal>
    </>
  )
}

function Conferencia() {
  const { config } = useApp()
  const avisar = useAviso()
  const { dados, erro, recarregar } = useDados(async () => {
    const [asaas, saldo, clientes, hon, des] = await Promise.all([
      chamarAsaas<{ assinaturas: AssinaturaAsaas[]; cobrancas: CobrancaAsaas[] }>('conferencia'),
      chamarAsaas<{ saldo: number }>('saldo'),
      todos<Cliente>((a, b) => supabase.from('clientes').select('*').range(a, b)),
      todos<Honorario>((a, b) => supabase.from('v_honorarios').select('*').range(a, b)),
      todos<Despesa>((a, b) => supabase.from('v_despesas').select('*').range(a, b)),
    ])
    return { ...asaas, saldo: saldo.saldo, clientes, hon, des }
  })

  const r = useMemo(() => {
    if (!dados) return null
    const sm = Number(config.salario_minimo) || 0
    const acha = (idAsaas: string, cnpj: string) =>
      dados.clientes.find(c => c.asaas_customer_id === idAsaas) || dados.clientes.find(c => cnpj && dig(c.cnpj) === cnpj)
    const assinaturas = dados.assinaturas.map(s => {
      const c = acha(s.cliente_asaas, s.cpfCnpj)
      const honorario = c ? r2(sm * c.percentual_honorario / 100) : null
      const diaAsaas = Number(s.proximo_vencimento?.slice(8, 10)) || null
      const problemas = !c ? ['Não encontrado no Siscon'] : [
        ...(Math.abs(s.valor - (honorario || 0)) > 0.009 ? ['Valor diferente'] : []),
        ...(diaAsaas !== c.dia_vencimento ? ['Vencimento diferente'] : []),
        ...(c.status !== 'Ativo' ? ['Cliente inativo no Siscon'] : []),
      ]
      return { ...s, cliente: c, siscon: c?.razao_social || '', honorario, dif: honorario == null ? null : r2(s.valor - honorario),
        diaAsaas, diaSiscon: c?.dia_vencimento ?? null, situacao: problemas.length ? problemas.join(' · ') : 'OK' }
    }).sort((a, b) => (a.situacao === 'OK' ? 1 : 0) - (b.situacao === 'OK' ? 1 : 0) || a.nome.localeCompare(b.nome))

    const cobrancas = dados.cobrancas.map(p => {
      const c = acha(p.cliente_asaas, p.cpfCnpj)
      const compIso = compDoVenc(p.vencimento)
      const siscon = c ? r2(dados.hon.filter(h => h.cliente_id === c.id && h.competencia === compIso).reduce((s, h) => s + h.saldo, 0)
        + dados.des.filter(d => d.cliente_id === c.id && d.competencia === compIso).reduce((s, d) => s + d.saldo, 0)) : null
      const dif = siscon == null ? null : r2(p.valor - siscon)
      return { ...p, siscon_nome: c?.razao_social || '', comp: comp(compIso), siscon, dif,
        situacao: !c ? 'Não encontrado no Siscon' : Math.abs(dif || 0) > 0.009 ? 'Valor diferente' : 'OK',
        statusPt: p.status === 'OVERDUE' ? 'Vencido' : 'Pendente' }
    }).sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.nome.localeCompare(b.nome))

    return { assinaturas, cobrancas, comProblema: assinaturas.filter(a => a.situacao !== 'OK').length,
      cobDif: cobrancas.filter(c => c.situacao !== 'OK').length }
  }, [dados, config.salario_minimo])

  async function exportar() {
    if (!r) return
    try {
      await baixarExcel(`Siscon_Conferencia_Asaas_${new Date().toISOString().slice(0, 10)}.xlsx`, [
        { nome: 'Assinaturas', titulo: 'Assinaturas ativas no Asaas × cadastro do Siscon', total: ['valor', 'honorario', 'dif'],
          colunas: [{ titulo: 'Cliente (Asaas)', chave: 'nome', largura: 42 }, { titulo: 'CNPJ/CPF', chave: 'doc', largura: 20 },
            { titulo: 'Cliente (Siscon)', chave: 'siscon', largura: 42 }, { titulo: 'Valor Asaas', chave: 'valor', tipo: 'moeda' },
            { titulo: 'Honorário Siscon', chave: 'honorario', tipo: 'moeda', largura: 16 }, { titulo: 'Diferença', chave: 'dif', tipo: 'moeda' },
            { titulo: 'Dia venc. Asaas', chave: 'diaAsaas', tipo: 'numero', largura: 14 }, { titulo: 'Dia venc. Siscon', chave: 'diaSiscon', tipo: 'numero', largura: 15 },
            { titulo: 'Próximo venc.', chave: 'proximo_vencimento', tipo: 'data', largura: 13 }, { titulo: 'Situação', chave: 'situacao', largura: 40 }],
          linhas: r.assinaturas.map(a => ({ ...a, doc: doc(a.cpfCnpj) })) },
        { nome: 'Boletos em aberto', titulo: 'Boletos em aberto no Asaas × saldo da competência no Siscon', total: ['valor', 'siscon', 'dif'],
          colunas: [{ titulo: 'Cliente (Asaas)', chave: 'nome', largura: 42 }, { titulo: 'Vencimento', chave: 'vencimento', tipo: 'data', largura: 12 },
            { titulo: 'Competência', chave: 'comp', largura: 12 }, { titulo: 'Status', chave: 'statusPt', largura: 10 },
            { titulo: 'Valor boleto', chave: 'valor', tipo: 'moeda' }, { titulo: 'Em aberto Siscon', chave: 'siscon', tipo: 'moeda', largura: 16 },
            { titulo: 'Diferença', chave: 'dif', tipo: 'moeda' }, { titulo: 'Descrição do boleto', chave: 'descricao', largura: 40 }, { titulo: 'Situação', chave: 'situacao', largura: 26 }],
          linhas: r.cobrancas as unknown as Record<string, unknown>[] },
      ])
    } catch (e) { avisar('Erro ao gerar Excel: ' + (e as Error).message, 'erro') }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Somente leitura: compara as assinaturas e os boletos em aberto do Asaas com o Siscon.</p>
        <div className="flex gap-2"><Botao variante="secundario" onClick={recarregar}>Atualizar</Botao><Botao onClick={exportar} disabled={!r}>Exportar Excel</Botao></div>
      </div>
      {erro ? <Aviso icone="alerta" titulo="Não foi possível consultar o Asaas agora"
          texto={/not_allowed_ip|403/.test(erro)
            ? 'O Asaas bloqueia consultas vindas do servidor do Siscon (bloqueio por IP na borda deles). Saldo e conferência voltam a funcionar quando o IP fixo for configurado. A baixa automática e a importação do extrato NÃO dependem disso.'
            : 'Tente "Atualizar" daqui a pouco. Se continuar, me envie a mensagem abaixo.'}
          detalhe={erro} />
        : !r || !dados ? <Carregando /> : <>
        <Resumo itens={[
          { rotulo: 'Saldo na conta Asaas', valor: moeda(dados.saldo), tom: 'verde' },
          { rotulo: 'Assinaturas ativas', valor: r.assinaturas.length, detalhe: `Total ${moeda(r.assinaturas.reduce((s, a) => s + a.valor, 0))}/mês`, tom: 'azul' },
          { rotulo: 'Assinaturas a conferir', valor: r.comProblema, detalhe: 'valor, vencimento ou cliente diferente', tom: r.comProblema ? 'laranja' : 'verde' },
          { rotulo: 'Boletos com diferença', valor: r.cobDif, detalhe: `de ${r.cobrancas.length} em aberto no Asaas`, tom: r.cobDif ? 'vermelho' : 'verde' },
        ]} />

        <Cartao titulo="Assinaturas ativas no Asaas" className="mt-6">
          {r.assinaturas.length === 0 ? <Vazio texto="Nenhuma assinatura ativa." /> :
            <div className="overflow-x-auto"><table className="tabela">
              <thead><tr><th>Cliente</th><th className="text-right">Valor Asaas</th><th className="text-right">Honorário Siscon</th><th className="text-right">Diferença</th><th>Dia venc.</th><th>Situação</th></tr></thead>
              <tbody>{r.assinaturas.map(a => <tr key={a.id}>
                <td className="max-w-sm truncate" title={`${a.nome} · ${doc(a.cpfCnpj)}`}>{a.nome}<span className="block text-xs text-slate-400">{doc(a.cpfCnpj)}</span></td>
                <td className="num text-right">{moeda(a.valor)}</td>
                <td className="num text-right">{a.honorario == null ? '—' : moeda(a.honorario)}</td>
                <td className={`num text-right ${a.dif ? 'font-medium text-red-700' : 'text-slate-400'}`}>{a.dif == null ? '—' : moeda(a.dif)}</td>
                <td className="num">{a.diaAsaas ?? '—'}{a.diaSiscon != null && a.diaSiscon !== a.diaAsaas && <span className="text-xs text-red-700"> (Siscon: {a.diaSiscon})</span>}</td>
                <td className="text-xs">{a.situacao === 'OK' ? <Selo texto="Ativo" /> : <span className="text-amber-700">{a.situacao}</span>}</td>
              </tr>)}</tbody>
            </table></div>}
        </Cartao>

        <Cartao titulo="Boletos em aberto no Asaas" className="mt-6">
          {r.cobrancas.length === 0 ? <Vazio texto="Nenhum boleto em aberto." /> :
            <div className="overflow-x-auto"><table className="tabela">
              <thead><tr><th>Cliente</th><th>Vencimento</th><th>Comp.</th><th>Status</th><th className="text-right">Boleto</th><th className="text-right">Em aberto Siscon</th><th className="text-right">Diferença</th><th /></tr></thead>
              <tbody>{r.cobrancas.map(c => <tr key={c.id}>
                <td className="max-w-sm truncate" title={c.descricao}>{c.nome}</td>
                <td className="num">{data(c.vencimento)}</td><td className="num">{c.comp}</td>
                <td><Selo texto={c.statusPt === 'Vencido' ? 'Atrasado' : 'Pendente'} /></td>
                <td className="num text-right">{moeda(c.valor)}</td>
                <td className="num text-right">{c.siscon == null ? '—' : moeda(c.siscon)}</td>
                <td className={`num text-right ${c.dif ? 'font-medium text-red-700' : 'text-slate-400'}`}>{c.dif == null ? <span className="text-xs text-amber-700">sem cliente</span> : moeda(c.dif)}</td>
                <td className="pr-5 text-right">{c.link && <a className="text-sm text-marca-700 hover:underline" href={c.link} target="_blank" rel="noreferrer">Boleto</a>}</td>
              </tr>)}</tbody>
            </table></div>}
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            Competência = mês anterior ao vencimento. "Em aberto Siscon" = saldo de honorário + despesas extras dessa competência (boletos vencidos podem diferir por causa dos juros).
          </p>
        </Cartao>
      </>}
    </>
  )
}

/** Quadro de aviso com ícone (erros e explicações) */
export function Aviso({ icone, titulo, texto, detalhe }: { icone: NomeIcone; titulo: string; texto: string; detalhe?: string }) {
  return (
    <div className="flex gap-4 rounded-xl border border-amber-200 bg-amber-50/70 p-5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700"><Icone nome={icone} className="h-5 w-5" /></span>
      <div className="min-w-0">
        <p className="font-semibold text-amber-900">{titulo}</p>
        <p className="mt-1 text-sm text-amber-800">{texto}</p>
        {detalhe && <p className="mt-2 break-all rounded-md bg-white/70 px-3 py-2 font-mono text-[11px] text-slate-500">{detalhe}</p>}
      </div>
    </div>
  )
}
