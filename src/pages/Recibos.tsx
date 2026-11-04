import { useMemo, useState } from 'react'
import { supabase, ok, todos, type Recibo } from '../lib/supabase'
import { useApp, useDados, escritorioDe } from '../lib/app'
import { moeda, data, normaliza } from '../lib/format'
import { imprimirRecibo } from '../lib/recibo-pdf'
import { Avatar, Botao, Busca, Cabecalho, Cartao, Carregando, Modal, Pilulas, Resumo, Selo, Vazio, useAviso } from '../components/ui'
import { Icone } from '../components/icones'

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
      <Cabecalho icone="recibos" titulo="Baixas e Recibos" subtitulo="Todos os recebimentos registrados, com e sem recibo. Cancelar não apaga: devolve os itens para em aberto." />
      {dados && (() => {
        const validas = lista.filter(r => !r.cancelado), com = validas.filter(r => r.com_recibo), sem = validas.filter(r => !r.com_recibo)
        const soma = (l: typeof lista) => moeda(l.reduce((t, r) => t + r.valor, 0))
        return <Resumo itens={[
          { rotulo: 'Total recebido', valor: soma(validas), detalhe: `${validas.length} baixas${de || ate ? ' no período' : ''}`, tom: 'verde' },
          { rotulo: 'Com recibo', valor: soma(com), detalhe: `${com.length} recibos numerados`, tom: 'azul' },
          { rotulo: 'Sem recibo', valor: soma(sem), detalhe: `${sem.length} baixas (boleto, Pix…)`, tom: 'cinza' },
          { rotulo: 'Canceladas', valor: lista.filter(r => r.cancelado).length, detalhe: 'não entram nos totais', tom: 'vermelho' },
        ]} />
      })()}
      <Cartao>
        <div className="filtros">
          <Pilulas atual={tipo} mudar={setTipo} opcoes={[
            ['', 'Todas', (dados || []).length], ['com', 'Com recibo', (dados || []).filter(r => r.com_recibo).length], ['sem', 'Sem recibo', (dados || []).filter(r => !r.com_recibo).length],
          ] as const} />
          <span className="flex items-center gap-2 text-xs text-slate-500"><Icone nome="calendario" className="h-4 w-4 text-slate-400" />
            <input className="campo !h-9 w-36" type="date" value={de} onChange={e => setDe(e.target.value)} title="De" /> até
            <input className="campo !h-9 w-36" type="date" value={ate} onChange={e => setAte(e.target.value)} title="Até" />
            {(de || ate) && <button onClick={() => { setDe(''); setAte('') }} className="text-blue-700 hover:underline">limpar</button>}</span>
          <Busca valor={busca} mudar={setBusca} placeholder="Cliente, CNPJ ou nº do recibo" className="ml-auto max-w-xs" />
        </div>
        {!dados ? <Carregando /> : lista.length === 0 ? <Vazio /> :
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead><tr><th>Recibo</th><th>Data</th><th>Cliente</th><th>Forma</th><th className="text-right">Valor</th><th>Situação</th><th /></tr></thead>
              <tbody>{lista.map(r => (
                <tr key={r.id} className={r.cancelado ? 'text-slate-400' : ''}>
                  <td>{r.numero ? <span className="num rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-800 ring-1 ring-inset ring-blue-100">Nº {String(r.numero).padStart(5, '0')}</span>
                    : <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">sem recibo</span>}</td>
                  <td className="num">{data(r.data_pagamento)}</td>
                  <td className="max-w-[22rem]" title={r.cliente_nome}><span className="flex items-center gap-2.5"><Avatar nome={r.cliente_nome} />
                    <span className="min-w-0"><span className="block truncate font-medium text-slate-800">{r.cliente_nome}</span>
                      <span className="block truncate text-[11px] text-slate-400">{!r.cliente_id ? 'avulso / vários clientes' : r.observacao || '\u00a0'}</span></span></span></td>
                  <td><span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">{r.metodo_pagamento || '—'}</span></td>
                  <td className={`num text-right font-semibold ${r.cancelado ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{moeda(r.valor)}</td>
                  <td>{r.cancelado ? <span title={r.motivo_cancelamento || ''}><Selo texto="Cancelado" /></span> : <Selo texto="Pago" />}</td>
                  <td className="pr-4 text-right"><span className="inline-flex items-center gap-1.5">
                    {r.com_recibo && <button onClick={() => imprimirRecibo(r.id, escritorioDe(config))} title="Abrir PDF do recibo" className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200 hover:bg-blue-50"><Icone nome="baixar" className="h-3.5 w-3.5" />PDF</button>}
                    {!r.cancelado && <button onClick={() => setCancelar(r)} className="rounded-md px-2.5 py-1 text-xs font-medium text-red-600 ring-1 ring-inset ring-red-200 hover:bg-red-50">Cancelar</button>}
                  </span></td>
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
