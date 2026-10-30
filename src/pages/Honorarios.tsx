import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, ok, todos, type Cliente, type Honorario } from '../lib/supabase'
import { useApp, useDados } from '../lib/app'
import { moeda, data, comp, compParaIso, ultimasCompetencias, normaliza } from '../lib/format'
import { Botao, Cabecalho, Campo, Cartao, Carregando, Modal, Selo, Vazio, useAviso } from '../components/ui'

export default function Honorarios() {
  const { config, recarregarConfig } = useApp()
  const avisar = useAviso()
  const comps = useMemo(() => config.competencia_atual ? ultimasCompetencias(config.competencia_atual, 30) : [], [config.competencia_atual])
  const [compSel, setCompSel] = useState<string | null>(null)
  const competencia = compSel ?? config.competencia_atual
  const [situacao, setSituacao] = useState('')
  const [busca, setBusca] = useState('')
  const [edit, setEdit] = useState<Honorario | null>(null)
  const [novo, setNovo] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  const { dados, recarregar } = useDados(() => todos<Honorario>((a, b) => {
    let q = supabase.from('v_honorarios').select('*').order('cliente_nome').order('competencia', { ascending: false })
    if (competencia) q = q.eq('competencia', compParaIso(competencia))
    return q.range(a, b)
  }), [competencia])

  const lista = useMemo(() => (dados || []).filter(h =>
    (!situacao || h.situacao === situacao || (situacao === 'abertos' && h.saldo > 0)) &&
    (!busca || normaliza(`${h.cliente_nome} ${h.cliente_cnpj}`).includes(normaliza(busca)))), [dados, situacao, busca])

  const tot = lista.reduce((s, h) => ({ valor: s.valor + h.valor_atualizado_calc, pago: s.pago + h.valor_pago_acumulado, saldo: s.saldo + h.saldo }), { valor: 0, pago: 0, saldo: 0 })

  async function gerar() {
    if (!competencia) return
    if (!confirm(`Gerar os honorários da competência ${competencia} para todos os clientes ativos?\nQuem já tiver honorário nessa competência não será duplicado.`)) return
    setOcupado(true)
    try {
      const n = ok(await supabase.rpc('gerar_honorarios', { p_competencia: compParaIso(competencia) })) as number
      avisar(n ? `${n} honorários gerados para ${competencia}.` : 'Nenhum honorário novo: todos já existiam.')
      recarregar()
    } catch (e) { avisar((e as Error).message, 'erro') } finally { setOcupado(false) }
  }

  async function avancar() {
    if (!confirm(`Encerrar a competência ${config.competencia_atual} e avançar para a próxima?\n\nIsso gera os honorários do novo mês e passa a calcular mais 1 mês de juros sobre os atrasados.`)) return
    setOcupado(true)
    try {
      const r = ok(await supabase.rpc('avancar_competencia')) as { competencia: string; gerados: number }
      await recarregarConfig(); setCompSel(r.competencia)
      avisar(`Competência ${r.competencia} aberta: ${r.gerados} honorários gerados.`)
    } catch (e) { avisar((e as Error).message, 'erro') } finally { setOcupado(false) }
  }

  return (
    <>
      <Cabecalho titulo="Honorários" subtitulo="Valor = salário mínimo × % do cliente · vencimento no mês seguinte"
        acoes={<>
          <Botao variante="secundario" onClick={() => setNovo(true)}>Lançar avulso</Botao>
          <Botao variante="secundario" onClick={gerar} disabled={ocupado || !competencia}>Gerar competência {competencia}</Botao>
          <Botao onClick={avancar} disabled={ocupado}>Avançar competência</Botao>
        </>} />
      <Cartao>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <select className="campo w-44" value={competencia} onChange={e => setCompSel(e.target.value)}>
            <option value="">Todas as competências</option>
            {comps.map(c => <option key={c} value={c}>Competência {c}</option>)}
          </select>
          <select className="campo w-44" value={situacao} onChange={e => setSituacao(e.target.value)}>
            <option value="">Todas as situações</option><option value="abertos">Em aberto (saldo)</option>
            <option>Pendente</option><option>Atrasado</option><option>Pago Parcial</option><option>Pago</option>
          </select>
          <input className="campo max-w-xs" placeholder="Buscar cliente" value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        {!dados ? <Carregando /> : lista.length === 0 ? <Vazio texto={`Nenhum honorário${competencia ? ' em ' + competencia : ''}. Use "Gerar competência".`} /> :
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead><tr><th>Cliente</th><th>Comp.</th><th>Vencimento</th><th className="text-right">Original</th><th className="text-right">Juros</th>
                <th className="text-right">Pago</th><th className="text-right">Saldo</th><th>Situação</th><th /></tr></thead>
              <tbody>{lista.map(h => (
                <tr key={h.id}>
                  <td className="max-w-xs truncate" title={h.cliente_nome}>{h.cliente_nome}</td>
                  <td className="num">{comp(h.competencia)}</td>
                  <td className="num">{data(h.vencimento)}</td>
                  <td className="num text-right">{moeda(h.valor_original)}</td>
                  <td className="num text-right" title={h.meses_atraso ? `${h.meses_atraso} mês(es) de juros` : ''}>{h.juros_calc ? moeda(h.juros_calc) : '—'}</td>
                  <td className="num text-right">{h.valor_pago_acumulado ? moeda(h.valor_pago_acumulado) : '—'}</td>
                  <td className="num text-right font-medium">{h.saldo ? moeda(h.saldo) : '—'}</td>
                  <td><Selo texto={h.situacao} /></td>
                  <td className="space-x-3 text-right">
                    {h.saldo > 0 && <Link className="text-sm text-marca-700 hover:underline" to={`/recebimentos?cliente=${h.cliente_id}`}>Receber</Link>}
                    <Botao variante="link" onClick={() => setEdit(h)}>Editar</Botao>
                  </td>
                </tr>))}
              </tbody>
              <tfoot><tr className="font-medium"><td colSpan={3} className="px-3 py-2">{lista.length} honorários</td><td colSpan={2} className="num px-3 text-right">{moeda(tot.valor)}</td>
                <td className="num px-3 text-right">{moeda(tot.pago)}</td><td className="num px-3 text-right">{moeda(tot.saldo)}</td><td colSpan={2} /></tr></tfoot>
            </table>
          </div>}
      </Cartao>
      {edit && <EditarHonorario h={edit} fechar={() => setEdit(null)} salvo={() => { setEdit(null); recarregar() }} />}
      {novo && <NovoHonorario competencia={competencia || config.competencia_atual} fechar={() => setNovo(false)} salvo={() => { setNovo(false); recarregar() }} />}
    </>
  )
}

function EditarHonorario({ h, fechar, salvo }: { h: Honorario; fechar: () => void; salvo: () => void }) {
  const avisar = useAviso()
  const [valor, setValor] = useState(h.valor_original)
  const [venc, setVenc] = useState(h.vencimento)
  const [juros, setJuros] = useState(h.calcular_juros)
  const [obs, setObs] = useState(h.observacao || '')
  const temPagamento = h.valor_pago_acumulado > 0

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    try {
      ok(await supabase.from('honorarios').update({
        valor_original: valor, valor_atualizado: valor + h.juros, vencimento: venc, calcular_juros: juros, observacao: obs || null,
      }).eq('id', h.id))
      avisar('Honorário atualizado.'); salvo()
    } catch (err) { avisar((err as Error).message, 'erro') }
  }
  async function excluir() {
    if (!confirm('Excluir este honorário? Esta ação não pode ser desfeita.')) return
    try { ok(await supabase.from('honorarios').delete().eq('id', h.id)); avisar('Honorário excluído.'); salvo() }
    catch (err) { avisar((err as Error).message, 'erro') }
  }

  return (
    <Modal titulo={`${h.cliente_nome} · ${comp(h.competencia)}`} aberto fechar={fechar}>
      <form onSubmit={salvar} className="grid grid-cols-2 gap-3">
        <Campo rotulo="Valor original"><input className="campo" type="number" step="0.01" value={valor} disabled={temPagamento} onChange={e => setValor(Number(e.target.value))} /></Campo>
        <Campo rotulo="Vencimento"><input className="campo" type="date" value={venc} disabled={temPagamento} onChange={e => setVenc(e.target.value)} /></Campo>
        <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={juros} onChange={e => setJuros(e.target.checked)} /> Calcular juros por atraso</label>
        <Campo rotulo="Observação" className="col-span-2"><textarea className="campo" rows={2} value={obs} onChange={e => setObs(e.target.value)} /></Campo>
        {temPagamento && <p className="col-span-2 text-xs text-amber-700">Já há pagamento neste honorário: valor e vencimento ficam bloqueados. Para corrigir, cancele o recibo em Recibos.</p>}
        <div className="col-span-2 mt-2 flex justify-between">
          {!temPagamento ? <Botao type="button" variante="perigo" onClick={excluir}>Excluir</Botao> : <span />}
          <div className="flex gap-2"><Botao type="button" variante="secundario" onClick={fechar}>Cancelar</Botao><Botao>Salvar</Botao></div>
        </div>
      </form>
    </Modal>
  )
}

function NovoHonorario({ competencia, fechar, salvo }: { competencia: string; fechar: () => void; salvo: () => void }) {
  const avisar = useAviso()
  const { config } = useApp()
  const { dados: clientes } = useDados(() => todos<Cliente>((a, b) => supabase.from('clientes').select('*').eq('status', 'Ativo').order('razao_social').range(a, b)))
  const [clienteId, setClienteId] = useState('')
  const [comp_, setComp] = useState(competencia)
  const cli = clientes?.find(c => c.id === clienteId)
  const sugerido = cli ? Math.round(Number(config.salario_minimo) * cli.percentual_honorario) / 100 : 0
  const [valor, setValor] = useState<number | ''>('')

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (!cli) return
    const iso = compParaIso(comp_)
    const [a, m] = iso.split('-').map(Number)
    const prox = new Date(a, m, 1)
    const ultimo = new Date(prox.getFullYear(), prox.getMonth() + 1, 0).getDate()
    const venc = `${prox.getFullYear()}-${String(prox.getMonth() + 1).padStart(2, '0')}-${String(Math.min(cli.dia_vencimento, ultimo)).padStart(2, '0')}`
    const v = valor === '' ? sugerido : valor
    try {
      ok(await supabase.from('honorarios').insert({ cliente_id: cli.id, competencia: iso, juros_desde: iso, vencimento: venc, valor_original: v, valor_atualizado: v, status: 'Pendente' }))
      avisar('Honorário lançado.'); salvo()
    } catch (err) { avisar((err as Error).message, 'erro') }
  }

  return (
    <Modal titulo="Lançar honorário avulso" aberto fechar={fechar}>
      <form onSubmit={salvar} className="grid grid-cols-2 gap-3">
        <Campo rotulo="Cliente" className="col-span-2">
          <select className="campo" required value={clienteId} onChange={e => { setClienteId(e.target.value); setValor('') }}>
            <option value="">Selecione…</option>{clientes?.map(c => <option key={c.id} value={c.id}>{c.razao_social}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Competência (MM/AAAA)"><input className="campo" pattern="\d{2}/\d{4}" required value={comp_} onChange={e => setComp(e.target.value)} /></Campo>
        <Campo rotulo={`Valor (sugerido ${moeda(sugerido)})`}><input className="campo" type="number" step="0.01" value={valor} placeholder={String(sugerido)} onChange={e => setValor(e.target.value === '' ? '' : Number(e.target.value))} /></Campo>
        <div className="col-span-2 mt-2 flex justify-end gap-2"><Botao type="button" variante="secundario" onClick={fechar}>Cancelar</Botao><Botao>Lançar</Botao></div>
      </form>
    </Modal>
  )
}
