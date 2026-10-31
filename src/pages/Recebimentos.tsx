import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase, ok, todos, type Cliente, type Honorario, type Despesa, type Recibo } from '../lib/supabase'
import { useApp, useDados, escritorioDe } from '../lib/app'
import { moeda, data, comp, hojeIso, normaliza, doc } from '../lib/format'
import { imprimirRecibo } from '../lib/recibo-pdf'
import { Botao, Cabecalho, Campo, Cartao, Carregando, Vazio, useAviso } from '../components/ui'

type Linha = { tipo: 'honorario' | 'despesa'; id: string; descricao: string; comp: string; venc: string; saldo: number; situacao: string }
type Sel = { marcado: boolean; valor: string; desconto: string }
type Avulso = { descricao: string; valor: string }
const METODOS = ['Pix/Boleto', 'Pix', 'Boleto', 'Dinheiro', 'Transferência', 'Cartão']
/** Aceita "1.234,56", "1234,56" e "1234.56" */
const num = (s: string) => {
  const t = String(s || '').trim()
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t) || 0
}
const fmt = (n: number) => n.toFixed(2).replace('.', ',')

export default function Recebimentos() {
  const { config } = useApp()
  const avisar = useAviso()
  const [params, setParams] = useSearchParams()
  const clienteId = params.get('cliente') || ''
  const [modo, setModo] = useState<'cliente' | 'avulso'>('cliente')
  const [busca, setBusca] = useState('')
  const [sel, setSel] = useState<Record<string, Sel>>({})
  const [avulsos, setAvulsos] = useState<Avulso[]>([])
  const [pagador, setPagador] = useState({ nome: '', doc: '' })
  const [dataPg, setDataPg] = useState(hojeIso())
  const [metodo, setMetodo] = useState(METODOS[0])
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [ultimo, setUltimo] = useState<Recibo | null>(null)
  const [comRecibo, setComRecibo] = useState(true)
  const [integral, setIntegral] = useState(false)
  const [valorRecebido, setValorRecebido] = useState('')

  const { dados: clientes } = useDados(() => todos<Cliente>((a, b) => supabase.from('clientes').select('*').order('razao_social').range(a, b)))
  const cliente = clientes?.find(c => c.id === clienteId)

  const { dados: abertos, recarregar } = useDados(async (): Promise<Linha[]> => {
    if (!clienteId) return []
    const [h, d] = await Promise.all([
      todos<Honorario>((a, b) => supabase.from('v_honorarios').select('*').eq('cliente_id', clienteId).gt('saldo', 0).order('competencia').range(a, b)),
      todos<Despesa>((a, b) => supabase.from('v_despesas').select('*').eq('cliente_id', clienteId).gt('saldo', 0).order('data').range(a, b)),
    ])
    return [
      ...h.map(x => ({ tipo: 'honorario' as const, id: x.id, descricao: `Honorários${x.juros_calc ? ` (inclui ${moeda(x.juros_calc)} de juros)` : ''}`, comp: x.competencia, venc: x.vencimento, saldo: x.saldo, situacao: x.situacao })),
      ...d.map(x => ({ tipo: 'despesa' as const, id: x.id, descricao: x.descricao, comp: x.competencia, venc: x.data, saldo: x.saldo, situacao: x.status })),
    ]
  }, [clienteId])

  useEffect(() => { setSel({}); setAvulsos([]) }, [clienteId])

  const sugestoes = useMemo(() => !busca || cliente ? [] :
    (clientes || []).filter(c => normaliza(`${c.razao_social} ${c.cnpj}`).includes(normaliza(busca))).slice(0, 8), [busca, clientes, cliente])

  const itens = [
    ...(abertos || []).filter(l => sel[l.id]?.marcado).map(l => {
      const v = num(sel[l.id].valor), d = num(sel[l.id].desconto)
      // Baixa integral: o que faltar para quitar vira desconto (item fica "Pago")
      return { tipo: l.tipo, id: l.id, valor: v, desconto: integral ? Math.max(0, Math.round((l.saldo - v) * 100) / 100) : d }
    }),
    ...avulsos.filter(a => a.descricao && num(a.valor) > 0).map(a => ({ tipo: 'avulso', descricao: a.descricao, valor: num(a.valor) })),
  ]
  const total = itens.reduce((s, i) => s + i.valor, 0)

  function marcar(l: Linha, v: boolean) {
    setSel(s => ({ ...s, [l.id]: v ? { marcado: true, valor: fmt(l.saldo), desconto: '' } : { ...s[l.id], marcado: false } }))
  }
  /** Distribui o valor recebido pelos itens mais antigos primeiro */
  function distribuir() {
    let resto = num(valorRecebido)
    if (resto <= 0) return avisar('Informe o valor recebido.', 'erro')
    const ordem = [...(abertos || [])].sort((a, b) => (a.comp + a.venc).localeCompare(b.comp + b.venc))
    const novo: Record<string, Sel> = {}
    for (const l of ordem) {
      if (resto <= 0.009) break
      const v = Math.min(l.saldo, resto)
      novo[l.id] = { marcado: true, valor: fmt(v), desconto: '' }
      resto = Math.round((resto - v) * 100) / 100
    }
    setSel(novo)
    if (resto > 0.009) avisar(`Sobrou ${moeda(resto)} além do saldo em aberto. Lance a diferença como serviço avulso, se for o caso.`, 'erro')
  }

  function marcarTodos() {
    const todosMarcados = (abertos || []).every(l => sel[l.id]?.marcado)
    setSel(Object.fromEntries((abertos || []).map(l => [l.id, { marcado: !todosMarcados, valor: fmt(l.saldo), desconto: '' }])))
  }

  async function registrar() {
    if (!itens.length) return avisar('Selecione ao menos um item.', 'erro')
    if (modo === 'avulso' && !pagador.nome.trim()) return avisar('Informe o nome do pagador.', 'erro')
    for (const l of abertos || []) {
      const s = sel[l.id]
      if (s?.marcado && num(s.valor) + num(s.desconto) > l.saldo + 0.009) return avisar(`Valor acima do saldo em ${comp(l.comp)} (${moeda(l.saldo)}).`, 'erro')
    }
    if (!(modo === 'avulso' || comRecibo) && avulsos.some(a => a.descricao && num(a.valor) > 0)) return avisar('Serviço avulso só pode ser baixado com recibo.', 'erro')
    const quitados = integral ? itens.filter(i => (i as { desconto?: number }).desconto).length : 0
    if (!confirm(`Registrar baixa de ${moeda(total)} em ${data(dataPg)} ${modo === 'avulso' || comRecibo ? 'COM recibo' : 'SEM recibo'}?${quitados ? `\n\nBaixa integral: ${quitados} item(ns) serão quitados mesmo com valor menor que o saldo.` : ''}`)) return
    setSalvando(true)
    try {
      const r = ok(await supabase.rpc('registrar_recebimento', {
        p_cliente_id: modo === 'cliente' ? clienteId : null, p_data: dataPg, p_metodo: metodo, p_itens: itens,
        p_cliente_nome: modo === 'avulso' ? pagador.nome.trim().toUpperCase() : null,
        p_cliente_cnpj: modo === 'avulso' ? pagador.doc.replace(/\D/g, '') || null : null, p_observacao: obs || null,
        p_com_recibo: modo === 'avulso' || comRecibo,
      })) as Recibo
      setUltimo(r); avisar(r.numero ? `Recibo nº ${r.numero} emitido.` : 'Baixa registrada sem recibo.')
      setSel({}); setAvulsos([]); setObs(''); setPagador({ nome: '', doc: '' }); setValorRecebido(''); setIntegral(false); recarregar()
    } catch (e) { avisar((e as Error).message, 'erro') } finally { setSalvando(false) }
  }

  const trocarModo = (m: typeof modo) => { setModo(m); setParams({}); setBusca(''); setUltimo(null); setAvulsos(m === 'avulso' ? [{ descricao: '', valor: '' }] : []) }

  return (
    <>
      <Cabecalho titulo="Registrar recebimento" subtitulo="Baixa com recibo (numerado) ou sem recibo (ex.: boleto pago)"
        acoes={<div className="flex rounded-md border border-slate-300 bg-white p-0.5 text-sm">
          {(['cliente', 'avulso'] as const).map(m => <button key={m} onClick={() => trocarModo(m)}
            className={`rounded px-3 py-1.5 ${modo === m ? 'bg-marca-700 text-white' : 'text-slate-600'}`}>{m === 'cliente' ? 'Cliente cadastrado' : 'Recibo avulso'}</button>)}
        </div>} />

      {ultimo && !ultimo.numero && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Baixa sem recibo registrada para {ultimo.cliente_nome} — {moeda(ultimo.valor)}. Para desfazer, use Baixas e Recibos.
        </div>
      )}
      {ultimo?.numero && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>Recibo <b>nº {ultimo.numero}</b> emitido para {ultimo.cliente_nome} — {moeda(ultimo.valor)}.</span>
          <span className="flex gap-2">
            <Botao variante="secundario" onClick={() => imprimirRecibo(ultimo.id, escritorioDe(config))}>Abrir PDF</Botao>
            <Botao variante="secundario" onClick={() => imprimirRecibo(ultimo.id, escritorioDe(config), false)}>Baixar PDF</Botao>
          </span>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {modo === 'cliente' ? (
            <Cartao titulo="Cliente">
              <div className="relative p-4">
                {cliente ? (
                  <div className="flex items-center justify-between gap-3">
                    <div><p className="font-medium">{cliente.razao_social}</p><p className="text-xs text-slate-500">{doc(cliente.cnpj)}</p></div>
                    <Botao variante="secundario" onClick={() => { setParams({}); setBusca('') }}>Trocar</Botao>
                  </div>
                ) : <>
                  <input className="campo" autoFocus placeholder="Digite o nome ou CNPJ do cliente" value={busca} onChange={e => setBusca(e.target.value)} />
                  {sugestoes.length > 0 && <ul className="absolute left-4 right-4 z-10 mt-1 max-h-72 overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
                    {sugestoes.map(c => <li key={c.id}><button className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => setParams({ cliente: c.id })}>
                      {c.razao_social} <span className="text-xs text-slate-400">{doc(c.cnpj)}</span></button></li>)}
                  </ul>}
                </>}
              </div>
            </Cartao>
          ) : (
            <Cartao titulo="Pagador (sem cadastro)">
              <div className="grid grid-cols-3 gap-3 p-4">
                <Campo rotulo="Nome" className="col-span-3 sm:col-span-2"><input className="campo" value={pagador.nome} onChange={e => setPagador(p => ({ ...p, nome: e.target.value }))} /></Campo>
                <Campo rotulo="CPF/CNPJ (opcional)" className="col-span-3 sm:col-span-1"><input className="campo" value={pagador.doc} onChange={e => setPagador(p => ({ ...p, doc: e.target.value }))} /></Campo>
              </div>
            </Cartao>
          )}

          {modo === 'cliente' && clienteId && (
            <Cartao titulo="Itens em aberto" acoes={abertos?.length ? <Botao variante="link" onClick={marcarTodos}>Marcar todos</Botao> : null}>
              {!abertos ? <Carregando /> : abertos.length === 0 ? <Vazio texto="Este cliente não tem nada em aberto." /> :
                <div className="overflow-x-auto">
                  <table className="tabela">
                    <thead><tr><th /><th>Item</th><th>Comp.</th><th className="text-right">Saldo</th><th className="text-right">Receber (R$)</th><th className="w-28">{integral ? 'Desconto (integral)' : 'Desconto'}</th></tr></thead>
                    <tbody>{abertos.map(l => {
                      const s = sel[l.id]
                      return (
                        <tr key={l.id} className={s?.marcado ? 'bg-marca-50' : ''}>
                          <td><input type="checkbox" checked={!!s?.marcado} onChange={e => marcar(l, e.target.checked)} /></td>
                          <td className="max-w-[14rem] truncate">{l.tipo === 'despesa' ? <span className="mr-1 text-xs text-slate-400">Extra ·</span> : null}{l.descricao}</td>
                          <td className="num" title={`${l.situacao} · vencimento ${data(l.venc)}`}><span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${l.situacao === 'Atrasado' ? 'bg-red-500' : l.situacao === 'Pago Parcial' ? 'bg-amber-500' : 'bg-sky-500'}`} />{comp(l.comp)}</td>
                          <td className="num text-right">{moeda(l.saldo)}</td>
                          <td><input className="campo num !h-8 w-24 !px-2 text-right" disabled={!s?.marcado} value={s?.valor ?? ''} onChange={e => setSel(x => ({ ...x, [l.id]: { ...x[l.id], valor: e.target.value } }))} /></td>
                          <td><input className="campo num !h-8 w-24 !px-2 text-right" disabled={!s?.marcado || integral} placeholder="0,00" value={integral && s?.marcado ? fmt(Math.max(0, l.saldo - num(s.valor))) : s?.desconto ?? ''} onChange={e => setSel(x => ({ ...x, [l.id]: { ...x[l.id], desconto: e.target.value } }))} /></td>
                        </tr>)
                    })}</tbody>
                  </table>
                </div>}
            </Cartao>
          )}

          {(modo === 'avulso' || clienteId) && (
            <Cartao titulo="Serviços avulsos neste recibo" acoes={<Botao variante="link" onClick={() => setAvulsos(a => [...a, { descricao: '', valor: '' }])}>+ Adicionar</Botao>}>
              {avulsos.length === 0 ? <p className="px-4 py-3 text-sm text-slate-400">Ex.: IRPF, certidão, alteração contratual cobrada na hora.</p> :
                <div className="space-y-2 p-4">{avulsos.map((a, i) => (
                  <div key={i} className="flex gap-2">
                    <input className="campo" placeholder="Descrição (ex.: IRPF 2026)" value={a.descricao} onChange={e => setAvulsos(l => l.map((x, j) => j === i ? { ...x, descricao: e.target.value } : x))} />
                    <input className="campo num w-36 text-right" placeholder="0,00" value={a.valor} onChange={e => setAvulsos(l => l.map((x, j) => j === i ? { ...x, valor: e.target.value } : x))} />
                    <button className="px-2 text-slate-400 hover:text-red-600" onClick={() => setAvulsos(l => l.filter((_, j) => j !== i))} aria-label="Remover">×</button>
                  </div>))}</div>}
            </Cartao>
          )}
        </div>

        <Cartao titulo="Pagamento" className="h-fit xl:sticky xl:top-20">
          <div className="space-y-3 p-4">
            {modo === 'cliente' && clienteId && (
              <div className="rounded-md bg-slate-50 p-3">
                <Campo rotulo="Valor recebido (distribui do mais antigo)">
                  <div className="flex gap-2">
                    <input className="campo num text-right" placeholder="0,00" value={valorRecebido} onChange={e => setValorRecebido(e.target.value)} />
                    <Botao type="button" variante="secundario" onClick={distribuir}>Distribuir</Botao>
                  </div>
                </Campo>
                <label className="mt-2 flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={integral} onChange={e => setIntegral(e.target.checked)} />
                  <span>Baixa integral <span className="block text-xs text-slate-500">Quita os itens marcados mesmo com valor menor; a diferença fica registrada como desconto.</span></span>
                </label>
              </div>
            )}
            {modo === 'cliente' && (
              <div className="flex rounded-md border border-slate-300 p-0.5 text-sm">
                {[true, false].map(v => <button key={String(v)} type="button" onClick={() => setComRecibo(v)}
                  className={`flex-1 rounded px-3 py-1.5 ${comRecibo === v ? 'bg-marca-700 text-white' : 'text-slate-600'}`}>{v ? 'Com recibo' : 'Sem recibo'}</button>)}
              </div>
            )}
            <Campo rotulo="Data do pagamento"><input className="campo" type="date" value={dataPg} onChange={e => setDataPg(e.target.value)} /></Campo>
            <Campo rotulo="Forma de pagamento"><select className="campo" value={metodo} onChange={e => setMetodo(e.target.value)}>{METODOS.map(m => <option key={m}>{m}</option>)}</select></Campo>
            <Campo rotulo="Observação (sai no recibo)"><textarea className="campo" rows={2} value={obs} onChange={e => setObs(e.target.value)} /></Campo>
            <div className="flex items-baseline justify-between border-t border-slate-100 pt-3">
              <span className="text-sm text-slate-500">{itens.length} item(ns)</span>
              <span className="num text-2xl font-semibold text-marca-800">{moeda(total)}</span>
            </div>
            <Botao className="w-full" disabled={salvando || !itens.length} onClick={registrar}>{salvando ? 'Registrando…' : modo === 'avulso' || comRecibo ? 'Registrar e emitir recibo' : 'Registrar baixa sem recibo'}</Botao>
          </div>
        </Cartao>
      </div>
    </>
  )
}
