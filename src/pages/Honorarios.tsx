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
    if (!confirm(`Encerrar a competência ${config.competencia_atual} e avançar para a próxima?\n\nIsso gera os honorários e as despesas fixas do novo mês e aplica mais 1 mês de juros (1,55%) nos atrasados de clientes com multa.`)) return
    setOcupado(true)
    try {
      const r = ok(await supabase.rpc('avancar_competencia')) as { competencia: string; gerados: number; despesas_fixas: number }
      await recarregarConfig(); setCompSel(r.competencia)
      avisar(`Competência ${r.competencia} aberta: ${r.gerados} honorários e ${r.despesas_fixas ?? 0} despesas fixas gerados.`)
    } catch (e) { avisar((e as Error).message, 'erro') } finally { setOcupado(false) }
  }

  return (
    <>
      <Cabecalho titulo="Honorários" subtitulo="Valor = salário mínimo × % do cliente · vencimento no mês seguinte"
        acoes={<>
          <Botao variante="secundario" onClick={() => setNovo(true)}>Geração avulsa</Botao>
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
  const sm = Number(config.salario_minimo)
  const { dados: clientes } = useDados(() => todos<Cliente>((a, b) => supabase.from('clientes').select('*').eq('status', 'Ativo').order('razao_social').range(a, b)))
  const [sel, setSel] = useState<string[]>([])
  const [filtro, setFiltro] = useState('')
  const [comps, setComps] = useState(competencia)
  const [personalizado, setPersonalizado] = useState('')
  const lista = (clientes || []).filter(c => !filtro || normaliza(c.razao_social).includes(normaliza(filtro)))
  const listaComps = comps.split(/[\s,;]+/).filter(Boolean)
  const compsValidas = listaComps.every(c => /^\d{2}\/\d{4}$/.test(c))

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (!sel.length) return avisar('Selecione ao menos um cliente.', 'erro')
    if (!listaComps.length || !compsValidas) return avisar('Competências no formato MM/AAAA, separadas por vírgula.', 'erro')
    const vp = Number(personalizado.replace(',', '.'))
    const linhas = sel.flatMap(id => {
      const cli = clientes!.find(c => c.id === id)!
      return listaComps.map(cp => {
        const iso = compParaIso(cp)
        const [a, m] = iso.split('-').map(Number)
        const prox = new Date(a, m, 1)
        const ultimo = new Date(prox.getFullYear(), prox.getMonth() + 1, 0).getDate()
        const venc = `${prox.getFullYear()}-${String(prox.getMonth() + 1).padStart(2, '0')}-${String(Math.min(cli.dia_vencimento, ultimo)).padStart(2, '0')}`
        const v = personalizado ? vp : Math.round(sm * cli.percentual_honorario) / 100
        return { cliente_id: id, competencia: iso, juros_desde: iso, vencimento: venc, valor_original: v, valor_atualizado: v, status: 'Pendente' }
      })
    })
    if (linhas.some(l => !(l.valor_original > 0))) return avisar('Há cliente com valor zero. Informe um valor personalizado.', 'erro')
    try {
      const r = ok(await supabase.from('honorarios').upsert(linhas, { onConflict: 'cliente_id,competencia', ignoreDuplicates: true }).select('id')) as { id: string }[]
      avisar(`${r.length} honorário(s) lançado(s)${r.length < linhas.length ? `; ${linhas.length - r.length} já existiam e foram mantidos` : ''}.`); salvo()
    } catch (err) { avisar((err as Error).message, 'erro') }
  }

  return (
    <Modal titulo="Geração avulsa de honorários" aberto fechar={fechar} largura="max-w-2xl">
      <form onSubmit={salvar} className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <span className="rotulo">Clientes ({sel.length} selecionado{sel.length === 1 ? '' : 's'})</span>
          <input className="campo mb-1" placeholder="Filtrar clientes" value={filtro} onChange={e => setFiltro(e.target.value)} />
          <div className="max-h-48 overflow-y-auto rounded-md border border-slate-200">
            {lista.map(c => (
              <label key={c.id} className="flex items-center justify-between gap-2 px-3 py-1 text-sm hover:bg-slate-50">
                <span className="flex items-center gap-2"><input type="checkbox" checked={sel.includes(c.id)} onChange={e => setSel(s => e.target.checked ? [...s, c.id] : s.filter(x => x !== c.id))} />{c.razao_social}</span>
                <span className="num text-xs text-slate-400">{moeda(sm * c.percentual_honorario / 100)}</span>
              </label>))}
          </div>
        </div>
        <Campo rotulo="Competências (MM/AAAA, separadas por vírgula)" className="col-span-2"><input className="campo" value={comps} onChange={e => setComps(e.target.value)} placeholder="07/2026, 08/2026" /></Campo>
        <Campo rotulo="Valor personalizado (vazio = % do salário mínimo)" className="col-span-2"><input className="campo" inputMode="decimal" value={personalizado} onChange={e => setPersonalizado(e.target.value)} /></Campo>
        <p className="col-span-2 text-xs text-slate-500">Serão lançados até {sel.length * listaComps.length} honorário(s). Os que já existirem na mesma competência são mantidos.</p>
        <div className="col-span-2 mt-2 flex justify-end gap-2"><Botao type="button" variante="secundario" onClick={fechar}>Cancelar</Botao><Botao>Lançar</Botao></div>
      </form>
    </Modal>
  )
}
