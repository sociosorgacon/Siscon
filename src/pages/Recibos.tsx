import { useMemo, useState } from 'react'
import { supabase, ok, todos, type Recibo } from '../lib/supabase'
import { useApp, useDados, escritorioDe } from '../lib/app'
import { moeda, data, normaliza } from '../lib/format'
import { imprimirRecibo } from '../lib/recibo-pdf'
import { Botao, Cabecalho, Cartao, Carregando, Modal, Selo, Vazio, useAviso } from '../components/ui'

export default function Recibos() {
  const { config } = useApp()
  const avisar = useAviso()
  const [busca, setBusca] = useState('')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [tipo, setTipo] = useState<'' | 'com' | 'sem'>('')
  const [cancelar, setCancelar] = useState<Recibo | null>(null)
  const [motivo, setMotivo] = useState('')
  const { dados, recarregar } = useDados(() => todos<Recibo>((a, b) =>
    supabase.from('recibos').select('*').order('data_pagamento', { ascending: false }).order('numero', { ascending: false, nullsFirst: false }).range(a, b)))

  const lista = useMemo(() => (dados || []).filter(r =>
    (!tipo || (tipo === 'com') === r.com_recibo) && (!de || r.data_pagamento >= de) && (!ate || r.data_pagamento <= ate) &&
    (!busca || normaliza(`${r.cliente_nome} ${r.numero ?? ''} ${r.cliente_cnpj ?? ''}`).includes(normaliza(busca)))), [dados, busca, de, ate, tipo])
  const total = lista.filter(r => !r.cancelado).reduce((s, r) => s + r.valor, 0)

  async function confirmarCancelamento() {
    if (!cancelar) return
    try {
      ok(await supabase.rpc('estornar_recibo', { p_recibo_id: cancelar.id, p_motivo: motivo }))
      avisar(`Baixa cancelada. Os itens voltaram para "em aberto".`); setCancelar(null); setMotivo(''); recarregar()
    } catch (e) { avisar((e as Error).message, 'erro') }
  }

  return (
    <>
      <Cabecalho titulo="Baixas e Recibos" subtitulo={dados && `${lista.length} baixas · ${moeda(total)} recebidos`} />
      <Cartao>
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-3">
          <input className="campo max-w-sm" placeholder="Buscar por cliente ou número" value={busca} onChange={e => setBusca(e.target.value)} />
          <select className="campo w-40" value={tipo} onChange={e => setTipo(e.target.value as typeof tipo)}>
            <option value="">Todas as baixas</option><option value="com">Com recibo</option><option value="sem">Sem recibo</option>
          </select>
          <label className="text-xs text-slate-500">De <input className="campo" type="date" value={de} onChange={e => setDe(e.target.value)} /></label>
          <label className="text-xs text-slate-500">Até <input className="campo" type="date" value={ate} onChange={e => setAte(e.target.value)} /></label>
        </div>
        {!dados ? <Carregando /> : lista.length === 0 ? <Vazio /> :
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead><tr><th>Nº</th><th>Data</th><th>Cliente</th><th>Forma</th><th className="text-right">Valor</th><th /><th /></tr></thead>
              <tbody>{lista.map(r => (
                <tr key={r.id} className={r.cancelado ? 'text-slate-400' : ''}>
                  <td className="num">{r.numero ? String(r.numero).padStart(5, '0') : <span className="text-xs text-slate-400">sem recibo</span>}</td>
                  <td className="num">{data(r.data_pagamento)}</td>
                  <td className="max-w-md truncate" title={r.cliente_nome}>{r.cliente_nome}{!r.cliente_id && <span className="ml-1 text-xs text-slate-400">(avulso)</span>}</td>
                  <td>{r.metodo_pagamento || '—'}</td>
                  <td className={`num text-right ${r.cancelado ? 'line-through' : ''}`}>{moeda(r.valor)}</td>
                  <td>{r.cancelado && <span title={r.motivo_cancelamento || ''}><Selo texto="Cancelado" /></span>}</td>
                  <td className="space-x-3 text-right">
                    {r.com_recibo && <Botao variante="link" onClick={() => imprimirRecibo(r.id, escritorioDe(config))}>PDF</Botao>}
                    {!r.cancelado && <Botao variante="link" className="!text-red-600" onClick={() => setCancelar(r)}>Cancelar</Botao>}
                  </td>
                </tr>))}</tbody>
            </table>
          </div>}
      </Cartao>
      <Modal titulo={`Cancelar baixa${cancelar?.numero ? ' · recibo nº ' + cancelar.numero : ''}`} aberto={!!cancelar} fechar={() => setCancelar(null)}>
        <p className="mb-3 text-sm text-slate-600">
          A baixa de <b>{cancelar?.cliente_nome}</b> ({moeda(cancelar?.valor)}) será cancelada e os honorários/despesas pagos por ela voltam a ficar em aberto. O registro não é apagado.
        </p>
        <textarea className="campo" rows={2} placeholder="Motivo (obrigatório)" value={motivo} onChange={e => setMotivo(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <Botao variante="secundario" onClick={() => setCancelar(null)}>Voltar</Botao>
          <Botao variante="perigo" disabled={!motivo.trim()} onClick={confirmarCancelamento}>Cancelar baixa</Botao>
        </div>
      </Modal>
    </>
  )
}
