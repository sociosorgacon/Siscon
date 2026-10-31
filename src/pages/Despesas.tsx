import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, ok, todos, type Cliente, type Despesa } from '../lib/supabase'
import { useApp, useDados, descricoesPadrao } from '../lib/app'
import { moeda, data, comp, compParaIso, hojeIso, normaliza } from '../lib/format'
import { Abas, Botao, Cabecalho, Campo, Cartao, Carregando, Modal, Selo, Vazio, useAviso } from '../components/ui'

type Fixa = { id: string; cliente_id: string; descricao: string; valor: number; observacoes: string | null; ativa: boolean; clientes?: { razao_social: string } }
type ClienteMin = Pick<Cliente, 'id' | 'razao_social' | 'status'>

const somaMes = (mmaaaa: string, n: number) => {
  const [m, a] = mmaaaa.split('/').map(Number)
  const t = a * 12 + (m - 1) + n
  return `${String((t % 12) + 1).padStart(2, '0')}/${Math.floor(t / 12)}`
}

export default function Despesas() {
  const [aba, setAba] = useState<'lancamentos' | 'fixas'>('lancamentos')
  const { config } = useApp()
  const { dados: clientes } = useDados(() => todos<ClienteMin>((a, b) => supabase.from('clientes').select('id, razao_social, status').order('razao_social').range(a, b)))
  return (
    <>
      {/* Sugestões do campo Descrição: lista padronizada de Configurações (pode-se digitar outra) */}
      <datalist id="descricoes">{descricoesPadrao(config).map(d => <option key={d} value={d} />)}</datalist>
      <Abas abas={[['lancamentos', 'Despesas extras'], ['fixas', 'Despesas fixas (recorrentes)']] as const} atual={aba} mudar={setAba} />
      {aba === 'lancamentos' ? <Lancamentos clientes={clientes || []} /> : <Fixas clientes={clientes || []} />}
    </>
  )
}

function Lancamentos({ clientes }: { clientes: ClienteMin[] }) {
  const [status, setStatus] = useState('abertas')
  const [busca, setBusca] = useState('')
  const [edit, setEdit] = useState<Partial<Despesa> | null>(null)
  const { dados, recarregar } = useDados(() => todos<Despesa>((a, b) => supabase.from('v_despesas').select('*').order('data', { ascending: false }).range(a, b)))

  const lista = useMemo(() => (dados || []).filter(d =>
    (status === '' || (status === 'abertas' ? d.saldo > 0 : d.status === status)) &&
    (!busca || normaliza(`${d.cliente_nome} ${d.descricao}`).includes(normaliza(busca)))), [dados, status, busca])

  return (
    <>
      <Cabecalho titulo="Despesas extras" subtitulo={dados && `${lista.length} lançamentos · saldo em aberto ${moeda(lista.reduce((s, d) => s + d.saldo, 0))}`}
        acoes={<Botao onClick={() => setEdit({})}>Nova despesa</Botao>} />
      <Cartao>
        <div className="filtros">
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
                  <td className="max-w-[13rem] truncate font-medium text-slate-800" title={d.cliente_nome}>{d.cliente_nome}</td>
                  <td className="max-w-[13rem] truncate" title={d.descricao}>{d.descricao}</td>
                  <td className="num">{comp(d.competencia)}</td>
                  <td className="num text-right">{moeda(d.valor)}</td>
                  <td className="num text-right font-medium">{d.saldo ? moeda(d.saldo) : '—'}</td>
                  <td><Selo texto={d.status} /></td>
                  <td className="space-x-3 pr-5 text-right">
                    {d.saldo > 0 && <Link className="text-sm text-marca-700 hover:underline" to={`/recebimentos?cliente=${d.cliente_id}`}>Receber</Link>}
                    <Botao variante="link" onClick={() => setEdit(d)}>Editar</Botao>
                  </td>
                </tr>))}</tbody>
            </table>
          </div>}
      </Cartao>
      {edit && (edit.id
        ? <EditarDespesa d={edit as Despesa} clientes={clientes} fechar={() => setEdit(null)} salvo={() => { setEdit(null); recarregar() }} />
        : <NovaDespesa clientes={clientes} fechar={() => setEdit(null)} salvo={() => { setEdit(null); recarregar() }} />)}
    </>
  )
}

/** Nova despesa: um ou vários clientes, à vista ou parcelada */
function NovaDespesa({ clientes, fechar, salvo }: { clientes: ClienteMin[]; fechar: () => void; salvo: () => void }) {
  const avisar = useAviso()
  const { config } = useApp()
  const [sel, setSel] = useState<string[]>([])
  const [filtro, setFiltro] = useState('')
  const [f, setF] = useState({ descricao: '', valor: '', data: hojeIso(), competencia: config.competencia_atual, parcelas: 1, observacoes: '' })
  const ativos = clientes.filter(c => c.status === 'Ativo' && (!filtro || normaliza(c.razao_social).includes(normaliza(filtro))))
  const valor = Number(String(f.valor).replace(',', '.')) || 0
  const parcela = Math.round(valor / f.parcelas * 100) / 100

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (!sel.length) return avisar('Selecione ao menos um cliente.', 'erro')
    if (valor <= 0) return avisar('Informe o valor.', 'erro')
    const linhas = sel.flatMap(cid => Array.from({ length: f.parcelas }, (_, i) => ({
      cliente_id: cid, status: 'Pendente', data: f.data, observacoes: f.observacoes || null,
      descricao: f.parcelas > 1 ? `${f.descricao} (${i + 1}/${f.parcelas})` : f.descricao,
      // última parcela absorve a diferença de centavos
      valor: i === f.parcelas - 1 ? Math.round((valor - parcela * (f.parcelas - 1)) * 100) / 100 : parcela,
      competencia: compParaIso(somaMes(f.competencia, i)),
    })))
    try {
      ok(await supabase.from('despesas').insert(linhas))
      avisar(`${linhas.length} despesa(s) lançada(s).`); salvo()
    } catch (err) { avisar((err as Error).message, 'erro') }
  }

  return (
    <Modal titulo="Nova despesa extra" aberto fechar={fechar} largura="max-w-2xl">
      <form onSubmit={salvar} className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <span className="rotulo">Clientes ({sel.length} selecionado{sel.length === 1 ? '' : 's'})</span>
          <input className="campo mb-1" placeholder="Filtrar clientes" value={filtro} onChange={e => setFiltro(e.target.value)} />
          <div className="max-h-40 overflow-y-auto rounded-md border border-slate-200">
            {ativos.map(c => (
              <label key={c.id} className="flex items-center gap-2 px-3 py-1 text-sm hover:bg-slate-50">
                <input type="checkbox" checked={sel.includes(c.id)} onChange={e => setSel(s => e.target.checked ? [...s, c.id] : s.filter(x => x !== c.id))} />{c.razao_social}
              </label>))}
          </div>
        </div>
        <Campo rotulo="Descrição" className="col-span-2"><input className="campo" list="descricoes" required value={f.descricao} onChange={e => setF({ ...f, descricao: e.target.value })} placeholder="Ex.: IRPF 2026, alteração contratual" /></Campo>
        <Campo rotulo="Valor total (por cliente)"><input className="campo" inputMode="decimal" required value={f.valor} onChange={e => setF({ ...f, valor: e.target.value })} /></Campo>
        <Campo rotulo="Parcelas"><input className="campo" type="number" min="1" max="60" value={f.parcelas} onChange={e => setF({ ...f, parcelas: Math.max(1, Number(e.target.value)) })} /></Campo>
        <Campo rotulo="Data"><input className="campo" type="date" required value={f.data} onChange={e => setF({ ...f, data: e.target.value })} /></Campo>
        <Campo rotulo={f.parcelas > 1 ? 'Competência da 1ª parcela' : 'Competência (MM/AAAA)'}><input className="campo" pattern="\d{2}/\d{4}" required value={f.competencia} onChange={e => setF({ ...f, competencia: e.target.value })} /></Campo>
        <Campo rotulo="Observações" className="col-span-2"><textarea className="campo" rows={2} value={f.observacoes} onChange={e => setF({ ...f, observacoes: e.target.value })} /></Campo>
        {f.parcelas > 1 && valor > 0 && <p className="col-span-2 text-xs text-slate-500">{f.parcelas} parcelas de {moeda(parcela)}, de {f.competencia} a {somaMes(f.competencia, f.parcelas - 1)}.</p>}
        <div className="col-span-2 mt-2 flex justify-end gap-2"><Botao type="button" variante="secundario" onClick={fechar}>Cancelar</Botao><Botao>Lançar</Botao></div>
      </form>
    </Modal>
  )
}

function EditarDespesa({ d, clientes, fechar, salvo }: { d: Despesa; clientes: ClienteMin[]; fechar: () => void; salvo: () => void }) {
  const avisar = useAviso()
  const [f, setF] = useState({ cliente_id: d.cliente_id, descricao: d.descricao, valor: d.valor, data: d.data, competencia: comp(d.competencia), observacoes: d.observacoes || '' })
  const pago = d.valor_pago > 0
  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    try {
      ok(await supabase.from('despesas').update({ ...f, competencia: compParaIso(f.competencia), observacoes: f.observacoes || null }).eq('id', d.id))
      avisar('Despesa salva.'); salvo()
    } catch (err) { avisar((err as Error).message, 'erro') }
  }
  async function excluir() {
    if (!confirm('Excluir esta despesa?')) return
    try { ok(await supabase.from('despesas').delete().eq('id', d.id)); avisar('Despesa excluída.'); salvo() }
    catch (err) { avisar((err as Error).message, 'erro') }
  }
  return (
    <Modal titulo="Editar despesa" aberto fechar={fechar}>
      <form onSubmit={salvar} className="grid grid-cols-2 gap-3">
        <Campo rotulo="Cliente" className="col-span-2">
          <select className="campo" disabled={pago} value={f.cliente_id} onChange={e => setF({ ...f, cliente_id: e.target.value })}>
            {clientes.map(c => <option key={c.id} value={c.id}>{c.razao_social}</option>)}</select>
        </Campo>
        <Campo rotulo="Descrição" className="col-span-2"><input className="campo" list="descricoes" required value={f.descricao} onChange={e => setF({ ...f, descricao: e.target.value })} /></Campo>
        <Campo rotulo="Valor"><input className="campo" type="number" step="0.01" min="0.01" disabled={pago} value={f.valor} onChange={e => setF({ ...f, valor: Number(e.target.value) })} /></Campo>
        <Campo rotulo="Data"><input className="campo" type="date" value={f.data} onChange={e => setF({ ...f, data: e.target.value })} /></Campo>
        <Campo rotulo="Competência (MM/AAAA)"><input className="campo" pattern="\d{2}/\d{4}" value={f.competencia} onChange={e => setF({ ...f, competencia: e.target.value })} /></Campo>
        <Campo rotulo="Observações" className="col-span-2"><textarea className="campo" rows={2} value={f.observacoes} onChange={e => setF({ ...f, observacoes: e.target.value })} /></Campo>
        {pago && <p className="col-span-2 text-xs text-amber-700">Já há pagamento: cliente e valor ficam bloqueados. Para corrigir, cancele a baixa.</p>}
        <div className="col-span-2 mt-2 flex justify-between">
          {!pago ? <Botao type="button" variante="perigo" onClick={excluir}>Excluir</Botao> : <span />}
          <div className="flex gap-2"><Botao type="button" variante="secundario" onClick={fechar}>Cancelar</Botao><Botao>Salvar</Botao></div>
        </div>
      </form>
    </Modal>
  )
}

function Fixas({ clientes }: { clientes: ClienteMin[] }) {
  const avisar = useAviso()
  const { config } = useApp()
  const [edit, setEdit] = useState<Partial<Fixa> | null>(null)
  const { dados, recarregar } = useDados(() => todos<Fixa>((a, b) => supabase.from('despesas_fixas').select('*, clientes(razao_social)').order('created_at').range(a, b)))

  async function gerar() {
    if (!confirm(`Gerar as despesas fixas na competência ${config.competencia_atual}? Não duplica as que já existirem.`)) return
    try {
      const n = ok(await supabase.rpc('gerar_despesas_fixas', { p_competencia: compParaIso(config.competencia_atual) })) as number
      avisar(n ? `${n} despesas geradas em ${config.competencia_atual}.` : 'Nada a gerar: todas já existiam.')
    } catch (e) { avisar((e as Error).message, 'erro') }
  }
  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (!edit) return
    const { id, clientes: _c, ...reg } = edit
    try {
      ok(id ? await supabase.from('despesas_fixas').update(reg).eq('id', id) : await supabase.from('despesas_fixas').insert(reg))
      setEdit(null); recarregar(); avisar('Despesa fixa salva.')
    } catch (err) { avisar((err as Error).message, 'erro') }
  }

  return (
    <>
      <Cabecalho titulo="Despesas fixas" subtitulo="Lançadas automaticamente ao avançar a competência (ou pelo botão)"
        acoes={<><Botao variante="secundario" onClick={gerar}>Gerar em {config.competencia_atual}</Botao><Botao onClick={() => setEdit({ ativa: true, valor: 0 })}>Nova despesa fixa</Botao></>} />
      <Cartao>
        {!dados ? <Carregando /> : dados.length === 0 ? <Vazio texto="Nenhuma despesa fixa cadastrada." /> :
          <div className="overflow-x-auto"><table className="tabela">
            <thead><tr><th>Cliente</th><th>Descrição</th><th className="text-right">Valor</th><th>Situação</th><th /></tr></thead>
            <tbody>{dados.map(x => <tr key={x.id} className={x.ativa ? '' : 'text-slate-400'}>
              <td className="max-w-xs truncate">{x.clientes?.razao_social}</td><td>{x.descricao}</td><td className="num text-right">{moeda(x.valor)}</td>
              <td>{x.ativa ? 'Ativa' : 'Pausada'}</td><td className="text-right"><Botao variante="link" onClick={() => setEdit(x)}>Editar</Botao></td></tr>)}</tbody>
          </table></div>}
      </Cartao>
      <Modal titulo={edit?.id ? 'Editar despesa fixa' : 'Nova despesa fixa'} aberto={!!edit} fechar={() => setEdit(null)}>
        {edit && <form onSubmit={salvar} className="grid grid-cols-2 gap-3">
          <Campo rotulo="Cliente" className="col-span-2"><select className="campo" required value={edit.cliente_id || ''} onChange={e => setEdit({ ...edit, cliente_id: e.target.value })}>
            <option value="">Selecione…</option>{clientes.filter(c => c.status === 'Ativo').map(c => <option key={c.id} value={c.id}>{c.razao_social}</option>)}</select></Campo>
          <Campo rotulo="Descrição" className="col-span-2"><input className="campo" list="descricoes" required value={edit.descricao || ''} onChange={e => setEdit({ ...edit, descricao: e.target.value })} /></Campo>
          <Campo rotulo="Valor mensal"><input className="campo" type="number" step="0.01" min="0.01" required value={edit.valor || ''} onChange={e => setEdit({ ...edit, valor: Number(e.target.value) })} /></Campo>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={!!edit.ativa} onChange={e => setEdit({ ...edit, ativa: e.target.checked })} /> Ativa</label>
          <Campo rotulo="Observações" className="col-span-2"><textarea className="campo" rows={2} value={edit.observacoes || ''} onChange={e => setEdit({ ...edit, observacoes: e.target.value })} /></Campo>
          <div className="col-span-2 flex justify-end gap-2"><Botao type="button" variante="secundario" onClick={() => setEdit(null)}>Cancelar</Botao><Botao>Salvar</Botao></div>
        </form>}
      </Modal>
    </>
  )
}
