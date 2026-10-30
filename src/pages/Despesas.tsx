import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, ok, todos, type Cliente, type Despesa } from '../lib/supabase'
import { useApp, useDados } from '../lib/app'
import { moeda, data, comp, compParaIso, hojeIso, normaliza } from '../lib/format'
import { Botao, Cabecalho, Campo, Cartao, Carregando, Modal, Selo, Vazio, useAviso } from '../components/ui'

export default function Despesas() {
  const [status, setStatus] = useState('abertas')
  const [busca, setBusca] = useState('')
  const [edit, setEdit] = useState<Partial<Despesa> | null>(null)
  const { dados, recarregar } = useDados(() => todos<Despesa>((a, b) => supabase.from('v_despesas').select('*').order('data', { ascending: false }).range(a, b)))

  const lista = useMemo(() => (dados || []).filter(d =>
    (status === '' || (status === 'abertas' ? d.saldo > 0 : d.status === status)) &&
    (!busca || normaliza(`${d.cliente_nome} ${d.descricao}`).includes(normaliza(busca)))), [dados, status, busca])
  const saldo = lista.reduce((s, d) => s + d.saldo, 0)

  return (
    <>
      <Cabecalho titulo="Despesas extras" subtitulo={dados && `${lista.length} lançamentos · saldo em aberto ${moeda(saldo)}`}
        acoes={<Botao onClick={() => setEdit({ data: hojeIso() })}>Nova despesa</Botao>} />
      <Cartao>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <select className="campo w-40" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="abertas">Em aberto</option><option>Pendente</option><option>Pago Parcial</option><option>Pago</option><option value="">Todas</option>
          </select>
          <input className="campo max-w-sm" placeholder="Buscar cliente ou descrição" value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        {!dados ? <Carregando /> : lista.length === 0 ? <Vazio /> :
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead><tr><th>Data</th><th>Cliente</th><th>Descrição</th><th>Comp.</th><th className="text-right">Valor</th><th className="text-right">Saldo</th><th>Status</th><th /></tr></thead>
              <tbody>{lista.map(d => (
                <tr key={d.id}>
                  <td className="num">{data(d.data)}</td>
                  <td className="max-w-[16rem] truncate" title={d.cliente_nome}>{d.cliente_nome}</td>
                  <td className="max-w-[16rem] truncate" title={d.descricao}>{d.descricao}</td>
                  <td className="num">{comp(d.competencia)}</td>
                  <td className="num text-right">{moeda(d.valor)}</td>
                  <td className="num text-right font-medium">{d.saldo ? moeda(d.saldo) : '—'}</td>
                  <td><Selo texto={d.status} /></td>
                  <td className="space-x-3 text-right">
                    {d.saldo > 0 && <Link className="text-sm text-marca-700 hover:underline" to={`/recebimentos?cliente=${d.cliente_id}`}>Receber</Link>}
                    <Botao variante="link" onClick={() => setEdit(d)}>Editar</Botao>
                  </td>
                </tr>))}</tbody>
            </table>
          </div>}
      </Cartao>
      {edit && <FormDespesa d={edit} fechar={() => setEdit(null)} salvo={() => { setEdit(null); recarregar() }} />}
    </>
  )
}

function FormDespesa({ d, fechar, salvo }: { d: Partial<Despesa>; fechar: () => void; salvo: () => void }) {
  const avisar = useAviso()
  const { config } = useApp()
  const { dados: clientes } = useDados(() => todos<Pick<Cliente, 'id' | 'razao_social'>>((a, b) => supabase.from('clientes').select('id, razao_social').order('razao_social').range(a, b)))
  const [f, setF] = useState({
    cliente_id: d.cliente_id || '', descricao: d.descricao || '', valor: d.valor ?? 0, data: d.data || hojeIso(),
    competencia: d.competencia ? comp(d.competencia) : config.competencia_atual, observacoes: d.observacoes || '',
  })
  const pago = (d.valor_pago || 0) > 0

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    const reg = { ...f, competencia: compParaIso(f.competencia), observacoes: f.observacoes || null }
    try {
      ok(d.id ? await supabase.from('despesas').update(reg).eq('id', d.id) : await supabase.from('despesas').insert({ ...reg, status: 'Pendente' }))
      avisar('Despesa salva.'); salvo()
    } catch (err) { avisar((err as Error).message, 'erro') }
  }
  async function excluir() {
    if (!confirm('Excluir esta despesa?')) return
    try { ok(await supabase.from('despesas').delete().eq('id', d.id!)); avisar('Despesa excluída.'); salvo() }
    catch (err) { avisar((err as Error).message, 'erro') }
  }

  return (
    <Modal titulo={d.id ? 'Editar despesa' : 'Nova despesa extra'} aberto fechar={fechar}>
      <form onSubmit={salvar} className="grid grid-cols-2 gap-3">
        <Campo rotulo="Cliente" className="col-span-2">
          <select className="campo" required disabled={pago} value={f.cliente_id} onChange={e => setF({ ...f, cliente_id: e.target.value })}>
            <option value="">Selecione…</option>{clientes?.map(c => <option key={c.id} value={c.id}>{c.razao_social}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Descrição" className="col-span-2"><input className="campo" required value={f.descricao} onChange={e => setF({ ...f, descricao: e.target.value })} placeholder="Ex.: IRPF 2026, alteração contratual" /></Campo>
        <Campo rotulo="Valor"><input className="campo" type="number" step="0.01" min="0.01" required disabled={pago} value={f.valor} onChange={e => setF({ ...f, valor: Number(e.target.value) })} /></Campo>
        <Campo rotulo="Data"><input className="campo" type="date" required value={f.data} onChange={e => setF({ ...f, data: e.target.value })} /></Campo>
        <Campo rotulo="Competência (MM/AAAA)"><input className="campo" pattern="\d{2}/\d{4}" required value={f.competencia} onChange={e => setF({ ...f, competencia: e.target.value })} /></Campo>
        <Campo rotulo="Observações" className="col-span-2"><textarea className="campo" rows={2} value={f.observacoes} onChange={e => setF({ ...f, observacoes: e.target.value })} /></Campo>
        {pago && <p className="col-span-2 text-xs text-amber-700">Já há pagamento: cliente e valor ficam bloqueados. Para corrigir, cancele o recibo.</p>}
        <div className="col-span-2 mt-2 flex justify-between">
          {d.id && !pago ? <Botao type="button" variante="perigo" onClick={excluir}>Excluir</Botao> : <span />}
          <div className="flex gap-2"><Botao type="button" variante="secundario" onClick={fechar}>Cancelar</Botao><Botao>Salvar</Botao></div>
        </div>
      </form>
    </Modal>
  )
}
