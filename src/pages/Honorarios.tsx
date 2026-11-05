import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, ok, todos, type Cliente, type Honorario } from '../lib/supabase'
import { useApp, useDados, salarioPara, type SalarioMinimo } from '../lib/app'
import { moeda, data, comp, compParaIso, ultimasCompetencias, normaliza, doc } from '../lib/format'
import { Avatar, FiltroClientes, clientesDe, Botao, Busca, Cabecalho, Campo, Cartao, Carregando, Modal, Pilulas, Resumo, Selo, Vazio, useAviso } from '../components/ui'
import { Icone } from '../components/icones'

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
  const [fechamento, setFechamento] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  const { dados, recarregar } = useDados(() => todos<Honorario>((a, b) => {
    let q = supabase.from('v_honorarios').select('*').order('cliente_nome').order('competencia', { ascending: false })
    if (competencia) q = q.eq('competencia', compParaIso(competencia))
    return q.range(a, b)
  }), [competencia])

  const [selCli, setSelCli] = useState<Set<string> | null>(null)
  const lista = useMemo(() => (dados || []).filter(h => (!selCli || selCli.has(h.cliente_id)) &&
    (!situacao || h.situacao === situacao || (situacao === 'abertos' && h.saldo > 0)) &&
    (!busca || normaliza(`${h.cliente_nome} ${h.cliente_cnpj}`).includes(normaliza(busca)))), [dados, situacao, busca, selCli])

  const conta = (f: (h: Honorario) => boolean) => (dados || []).filter(h => (!busca || normaliza(`${h.cliente_nome} ${h.cliente_cnpj}`).includes(normaliza(busca))) && f(h)).length
  const todosTot = (dados || []).reduce((s, h) => ({ orig: s.orig + h.valor_original, jur: s.jur + h.juros_calc, valor: s.valor + h.valor_atualizado_calc, pago: s.pago + h.valor_pago_acumulado, saldo: s.saldo + h.saldo, atr: s.atr + (h.situacao === 'Atrasado' ? h.saldo : 0), nAtr: s.nAtr + (h.situacao === 'Atrasado' ? 1 : 0) }), { orig: 0, jur: 0, valor: 0, pago: 0, saldo: 0, atr: 0, nAtr: 0 })
  const tot = lista.reduce((s, h) => ({ orig: s.orig + h.valor_original, jur: s.jur + h.juros_calc, valor: s.valor + h.valor_atualizado_calc, pago: s.pago + h.valor_pago_acumulado, saldo: s.saldo + h.saldo }), { orig: 0, jur: 0, valor: 0, pago: 0, saldo: 0 })

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
      <Cabecalho icone="honorarios" titulo="Honorários" subtitulo="Valor = salário mínimo × % do cliente · vencimento no mês seguinte"
        acoes={<>
          <Botao variante="secundario" onClick={() => setFechamento(true)}>Fechamento de Escrita</Botao>
          <Botao variante="secundario" onClick={() => setNovo(true)}>Geração avulsa</Botao>
          <Botao variante="secundario" onClick={gerar} disabled={ocupado || !competencia}>Gerar competência {competencia}</Botao>
          <Botao onClick={avancar} disabled={ocupado}>Avançar competência</Botao>
        </>} />
      {dados && <Resumo itens={[
        // só na tela: honorários e juros separados (relatórios para o cliente continuam com o valor somado)
        { rotulo: competencia ? `Honorários ${competencia}` : 'Honorários', valor: moeda(todosTot.orig), detalhe: `${dados.length} honorários`, tom: 'azul' },
        { rotulo: 'Juros', valor: moeda(todosTot.jur), detalhe: `total com juros ${moeda(todosTot.valor)}`, tom: 'cinza' },
        { rotulo: 'Recebido', valor: moeda(todosTot.pago), detalhe: todosTot.valor ? `${Math.round(todosTot.pago / todosTot.valor * 100)}% do faturado` : undefined, tom: 'verde' },
        { rotulo: 'Em aberto', valor: moeda(todosTot.saldo), detalhe: `${dados.filter(h => h.saldo > 0).length} honorários`, tom: 'laranja' },
        { rotulo: 'Atrasado', valor: moeda(todosTot.atr), detalhe: `${todosTot.nAtr} honorários`, tom: 'vermelho' },
      ]} />}
      <div className="grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)]">
        <FiltroClientes clientes={clientesDe(dados, h => h.cliente_id, h => h.cliente_nome)} sel={selCli} mudar={setSelCli} />
        <div className="min-w-0">
      <Cartao>
        <div className="filtros">
          <select className="campo w-52" value={competencia} onChange={e => setCompSel(e.target.value)}>
            <option value="">Todas as competências</option>
            {comps.map(c => <option key={c} value={c}>Competência {c}</option>)}
          </select>
          <Pilulas atual={situacao} mudar={setSituacao} opcoes={[
            ['', 'Todos', conta(() => true)], ['abertos', 'Em aberto', conta(h => h.saldo > 0)], ['Pendente', 'Pendente', conta(h => h.situacao === 'Pendente')],
            ['Atrasado', 'Atrasado', conta(h => h.situacao === 'Atrasado')], ['Pago Parcial', 'Parcial', conta(h => h.situacao === 'Pago Parcial')], ['Pago', 'Pago', conta(h => h.situacao === 'Pago')],
          ] as const} />
          <Busca valor={busca} mudar={setBusca} placeholder="Buscar cliente ou CNPJ" className="ml-auto max-w-xs" />
        </div>
        {!dados ? <Carregando /> : lista.length === 0 ? <Vazio texto={`Nenhum honorário${competencia ? ' em ' + competencia : ''}. Use "Gerar competência".`} /> :
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead><tr><th>Cliente</th><th>Comp.</th><th>Vencimento</th><th className="text-right">Original</th><th className="text-right">Juros</th>
                <th className="text-right">Pago</th><th className="text-right">Saldo</th><th>Situação</th><th /></tr></thead>
              <tbody>{lista.map(h => (
                <tr key={h.id}>
                  <td className="max-w-[18rem]" title={h.cliente_nome}><span className="flex items-center gap-2.5"><Avatar nome={h.cliente_nome} />
                    <span className="min-w-0"><span className="block truncate font-medium text-slate-800">{h.cliente_nome}</span><span className="num block text-[11px] text-slate-400">{doc(h.cliente_cnpj)}</span></span></span></td>
                  <td className="num">{comp(h.competencia)}</td>
                  <td className="num">{data(h.vencimento)}</td>
                  <td className="num text-right">{moeda(h.valor_original)}</td>
                  <td className="num text-right" title={h.meses_atraso ? `${h.meses_atraso} mês(es) de juros` : ''}>{h.juros_calc ? moeda(h.juros_calc) : '—'}</td>
                  <td className="num text-right">{h.valor_pago_acumulado ? moeda(h.valor_pago_acumulado) : '—'}</td>
                  <td className="num text-right font-medium">{h.saldo ? moeda(h.saldo) : '—'}</td>
                  <td><Selo texto={h.situacao} /></td>
                  <td className="pr-4 text-right"><span className="inline-flex items-center gap-1.5">
                    {h.saldo > 0 && <Link className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100" to={`/recebimentos?cliente=${h.cliente_id}`}>Receber</Link>}
                    <button onClick={() => setEdit(h)} title="Editar" aria-label="Editar" className="rounded-md p-1.5 text-slate-500 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 hover:text-blue-700"><Icone nome="editar" className="h-3.5 w-3.5" /></button>
                  </span></td>
                </tr>))}
              </tbody>
              <tfoot><tr className="font-semibold text-slate-800"><td colSpan={3} className="px-3 py-2">{lista.length} honorários</td><td className="num px-3 text-right">{moeda(tot.orig)}</td><td className="num px-3 text-right">{tot.jur ? moeda(tot.jur) : '—'}</td>
                <td className="num px-3 text-right">{moeda(tot.pago)}</td><td className="num px-3 text-right">{moeda(tot.saldo)}</td><td colSpan={2} /></tr></tfoot>
            </table>
          </div>}
      </Cartao>
        </div>
      </div>
      {edit && <EditarHonorario h={edit} fechar={() => setEdit(null)} salvo={() => { setEdit(null); recarregar() }} />}
      {fechamento && <FechamentoEscrita fechar={() => setFechamento(false)} />}
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
  const { dados: salarios } = useDados(async () => ok(await supabase.from('salarios_minimos').select('vigencia, valor')) as SalarioMinimo[])
  const { dados: clientes } = useDados(() => todos<Cliente>((a, b) => supabase.from('clientes').select('*').eq('status', 'Ativo').order('razao_social').range(a, b)))
  const [sel, setSel] = useState<string[]>([])
  const [filtro, setFiltro] = useState('')
  const [comps, setComps] = useState(competencia)
  const [personalizado, setPersonalizado] = useState('')
  const lista = (clientes || []).filter(c => !filtro || normaliza(c.razao_social).includes(normaliza(filtro)))
  const listaComps = comps.split(/[\s,;]+/).filter(Boolean)
  const compsValidas = listaComps.every(c => /^\d{2}\/\d{4}$/.test(c))
  const smPrevia = compsValidas && listaComps.length ? salarioPara(salarios || [], compParaIso(listaComps[0]), sm) : sm

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
        const v = personalizado ? vp : Math.round(salarioPara(salarios || [], iso, sm) * cli.percentual_honorario) / 100
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
                <span className="num text-xs text-slate-400">{moeda(smPrevia * c.percentual_honorario / 100)}</span>
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

/** Fechamento de Escrita (ano): um honorário a mais no fim do ano, mesmo valor do mensal (salário vigente × %),
 *  parcelável. Lançado como despesa extra (sem juros), da competência atual em diante: "Fechamento de Escrita 2026 (1/3)". */
function FechamentoEscrita({ fechar }: { fechar: () => void }) {
  const avisar = useAviso()
  const { config } = useApp()
  const ano = config.competencia_atual.slice(3)
  const nome = `Fechamento de Escrita ${ano}`
  const { dados } = useDados(async () => {
    const [cli, sal, ja] = await Promise.all([
      todos<Cliente>((a, b) => supabase.from('clientes').select('*').eq('status', 'Ativo').eq('gera_fechamento', true).gt('percentual_honorario', 0).order('razao_social').range(a, b)),
      ok(await supabase.from('salarios_minimos').select('vigencia, valor')) as SalarioMinimo[],
      todos<{ cliente_id: string }>((a, b) => supabase.from('despesas').select('cliente_id').ilike('descricao', `${nome}%`).range(a, b)),
    ])
    return { cli, sal, ja: new Set(ja.map(x => x.cliente_id)) }
  })
  const sm = dados ? salarioPara(dados.sal, compParaIso(config.competencia_atual), Number(config.salario_minimo)) : 0
  const valorDe = (c: Cliente) => Math.round(sm * c.percentual_honorario) / 100
  const [sel, setSel] = useState<string[]>([])
  const [filtro, setFiltro] = useState('')
  const [parcelas, setParcelas] = useState(3)
  // padrão: todos os clientes da lista marcados (menos os que já têm o fechamento do ano)
  useEffect(() => { if (dados) setSel(dados.cli.filter(c => !dados.ja.has(c.id)).map(c => c.id)) }, [dados])
  const [salvando, setSalvando] = useState(false)
  const livres = (dados?.cli || []).filter(c => !dados!.ja.has(c.id))
  const lista = (dados?.cli || []).filter(c => !filtro || normaliza(c.razao_social).includes(normaliza(filtro)))
  const todosMarcados = livres.length > 0 && livres.every(c => sel.includes(c.id))
  const total = livres.filter(c => sel.includes(c.id)).reduce((s, c) => s + valorDe(c), 0)
  const compN = (n: number) => { const [m, a] = config.competencia_atual.split('/').map(Number); const d = new Date(a, m - 1 + n, 1); return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` }

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    const clientes = livres.filter(c => sel.includes(c.id))
    if (!clientes.length) return avisar('Selecione ao menos um cliente.', 'erro')
    if (!confirm(`Lançar "${nome}" para ${clientes.length} cliente(s), em ${parcelas} parcela(s), total ${moeda(total)}?`)) return
    const hoje = new Date().toLocaleDateString('sv-SE')
    const linhas = clientes.flatMap(c => {
      const v = valorDe(c), p = Math.round(v / parcelas * 100) / 100
      return Array.from({ length: parcelas }, (_, i) => ({
        cliente_id: c.id, status: 'Pendente', data: hoje, observacoes: null,
        descricao: parcelas > 1 ? `${nome} (${i + 1}/${parcelas})` : nome,
        valor: i === parcelas - 1 ? Math.round((v - p * (parcelas - 1)) * 100) / 100 : p,  // última parcela absorve os centavos
        competencia: compParaIso(compN(i)),
      }))
    })
    setSalvando(true)
    try { ok(await supabase.from('despesas').insert(linhas)); avisar(`${nome}: ${linhas.length} lançamento(s) para ${clientes.length} cliente(s).`); fechar() }
    catch (err) { avisar((err as Error).message, 'erro') } finally { setSalvando(false) }
  }

  return (
    <Modal titulo={nome} aberto fechar={fechar} largura="max-w-2xl">
      {!dados ? <Carregando /> : <form onSubmit={salvar} className="grid gap-3">
        <p className="text-sm text-slate-500">Mesmo valor do honorário mensal de cada cliente (salário mínimo de {moeda(sm)} × %). Entra como despesa extra, <b>sem juros</b>, a partir da competência {config.competencia_atual}. Só aparecem os clientes marcados com “Gera Fechamento de Escrita” no cadastro.</p>
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" checked={todosMarcados} onChange={e => setSel(e.target.checked ? livres.map(c => c.id) : [])} />Selecionar todos ({livres.length})</label>
            <span className="text-xs text-slate-500">{sel.length} selecionado{sel.length === 1 ? '' : 's'}</span>
          </div>
          <input className="campo mb-1" placeholder="Filtrar clientes" value={filtro} onChange={e => setFiltro(e.target.value)} />
          <div className="max-h-72 overflow-y-auto rounded-md border border-slate-200">
            {lista.map(c => {
              const ja = dados.ja.has(c.id)
              return <label key={c.id} className={`flex items-center justify-between gap-2 px-3 py-1 text-sm ${ja ? 'text-slate-400' : 'hover:bg-slate-50'}`}>
                <span className="flex min-w-0 items-center gap-2"><input type="checkbox" disabled={ja} checked={!ja && sel.includes(c.id)} onChange={e => setSel(s => e.target.checked ? [...s, c.id] : s.filter(x => x !== c.id))} /><span className="truncate">{c.razao_social}</span>{ja && <span className="shrink-0 rounded bg-slate-100 px-1.5 text-[10px]">já lançado</span>}</span>
                <span className="num shrink-0 text-xs text-slate-500">{moeda(valorDe(c))}</span>
              </label>
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Parcelas"><input className="campo" type="number" min="1" max="12" value={parcelas} onChange={e => setParcelas(Math.min(12, Math.max(1, Number(e.target.value) || 1)))} /></Campo>
          <div className="self-end rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">Total <b className="num text-slate-800">{moeda(total)}</b></div>
        </div>
        <p className="text-xs text-slate-500">{parcelas > 1 ? `${parcelas} parcelas mensais, de ${config.competencia_atual} a ${compN(parcelas - 1)}` : `Parcela única na competência ${config.competencia_atual}`} · descrição "{parcelas > 1 ? `${nome} (1/${parcelas})` : nome}".</p>
        <div className="mt-1 flex justify-end gap-2"><Botao type="button" variante="secundario" onClick={fechar}>Cancelar</Botao><Botao disabled={salvando || !sel.length}>{salvando ? 'Lançando…' : 'Lançar'}</Botao></div>
      </form>}
    </Modal>
  )
}
