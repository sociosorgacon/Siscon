import { useMemo, useState } from 'react'
import { supabase, ok, todos, type Cliente, type Honorario, type Despesa } from '../lib/supabase'
import { useApp, useDados, salarioPara, type SalarioMinimo } from '../lib/app'
import { chamarAsaas, abrirBoleto, type AssinaturaAsaas, type CobrancaAsaas } from '../lib/asaas'
import { moeda, data, comp, compParaIso } from '../lib/format'
import { Avatar, Botao, Cartao, Carregando, LogoAsaas, Resumo, Vazio, useAviso } from '../components/ui'
import { Aviso } from './Asaas'

/**
 * Etapa 2 do Asaas — ajustes COM APROVAÇÃO (regras do usuário):
 * • boleto de competência C (vence no mês seguinte) = honorário de C + despesas extras de C;
 * • despesa cujo boleto já foi pago/venceu (ou não existe) vai para o próximo boleto PENDENTE (alterável enquanto pendente);
 * • descrição com uma linha por item ("Honorários Mensais - 1.621,00");
 * • cliente sem assinatura no Asaas: ignorado (a despesa fica só no Siscon).
 * Despesas com competência anterior a "asaas_ajuste_desde" não entram (já foram cobradas à mão).
 */
type DespesaB = Despesa & { asaas_boleto_id: string | null }
type Fixa = { cliente_id: string; valor: number; ativa: boolean }
type Item = { texto: string; valor: number; despesa?: string }
type Proposta = { id: string; cliente: Cliente; vencimento: string; comp: string; atual: number; novo: number; descAtual: string; descNova: string; itens: Item[]; avisos: string[] }

const r2 = (n: number) => Math.round(n * 100) / 100
const dig = (s: string | null | undefined) => (s || '').replace(/\D/g, '')
const compDoVenc = (venc: string) => { const [a, m] = venc.split('-').map(Number); return m === 1 ? `${a - 1}-12-01` : `${a}-${String(m - 1).padStart(2, '0')}-01` }
const linha = (texto: string, valor: number) => `${texto} - ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type Dados = { assinaturas: AssinaturaAsaas[]; cobrancas: CobrancaAsaas[]; cli: Cliente[]; hon: Honorario[]; des: DespesaB[]; fixas: Fixa[]; sal: SalarioMinimo[] }
let cache: { t: number; desde: string; dados: Dados } | null = null
const forcar = { atual: false }
const tentados = new Set<string>()   // clientes do Asaas já procurados nesta sessão (evita repetir a consulta lenta)
/** Ao sair da página Integração Asaas o cache é descartado: ao voltar (ex.: depois de lançar despesas), consulta de novo */
export const limparCacheAjustes = () => { cache = null }

export default function AsaasAjustes() {
  const avisar = useAviso()
  const { config } = useApp()
  const [marcados, setMarcados] = useState<Set<string> | null>(null)
  const [marcAss, setMarcAss] = useState<Set<string> | null>(null)
  const [aplicando, setAplicando] = useState(false)
  const desde = compParaIso((config as unknown as Record<string, string>).asaas_ajuste_desde || config.competencia_atual)

  const { dados, erro, recarregar: recarregarDados } = useDados(async () => {
    // guarda a consulta por 10 min enquanto o Siscon estiver aberto (trocar de aba não consulta de novo)
    if (!forcar.atual && cache && cache.desde === desde && Date.now() - cache.t < 10 * 60 * 1000) return cache.dados
    forcar.atual = false
    const [asaas, cli, hon, des, fixas, sal, docs] = await Promise.all([
      chamarAsaas<{ assinaturas: AssinaturaAsaas[]; cobrancas: CobrancaAsaas[] }>('ajustes'),
      todos<Cliente>((a, b) => supabase.from('clientes').select('*').range(a, b)),
      todos<Honorario>((a, b) => supabase.from('v_honorarios').select('*').gte('competencia', desde).range(a, b)),
      todos<DespesaB>((a, b) => supabase.from('v_despesas').select('*').gt('saldo', 0).range(a, b)),
      todos<Fixa>((a, b) => supabase.from('despesas_fixas').select('cliente_id, valor, ativa').range(a, b)),
      ok(await supabase.from('salarios_minimos').select('vigencia, valor')) as SalarioMinimo[],
      // CPF/CNPJ do cliente do Asaas já guardado pelos avisos/planilha (para clientes ainda sem vínculo)
      todos<{ customer_id: string; cpf_cnpj: string }>((a, b) => supabase.from('asaas_cobrancas').select('customer_id, cpf_cnpj').not('customer_id', 'is', null).not('cpf_cnpj', 'is', null).range(a, b)),
    ])
    const docDe = new Map(docs.map(d => [d.customer_id, d.cpf_cnpj]))
    // Clientes do Asaas ainda sem vínculo no Siscon: busca o CPF/CNPJ deles UMA vez (consulta completa, mais lenta)
    // e grava o vínculo (asaas_customer_id) quando só um cliente do Siscon tem aquele documento. Depois disso fica rápido.
    const vinculados = new Set(cli.map(c => c.asaas_customer_id).filter(Boolean))
    const semVinculo = [...new Set([...asaas.cobrancas, ...asaas.assinaturas].map(x => x.cliente_asaas))]
      .filter(id => id && !vinculados.has(id) && !docDe.has(id) && !tentados.has(id))
    if (semVinculo.length) {
      semVinculo.forEach(id => tentados.add(id))
      const conf = await chamarAsaas<{ assinaturas: AssinaturaAsaas[]; cobrancas: CobrancaAsaas[] }>('conferencia')
      const docCus = new Map([...conf.assinaturas, ...conf.cobrancas].filter(x => x.cpfCnpj).map(x => [x.cliente_asaas, x.cpfCnpj]))
      for (const cus of semVinculo) {
        const d = docCus.get(cus); if (!d) continue
        const cands = cli.filter(c => dig(c.cnpj) === d && !c.asaas_customer_id)
        if (cands.length !== 1) { docDe.set(cus, d); continue }
        const { error } = await supabase.from('clientes').update({ asaas_customer_id: cus }).eq('id', cands[0].id).is('asaas_customer_id', null)
        if (!error) cands[0].asaas_customer_id = cus; else docDe.set(cus, d)
      }
    }
    const comDoc = <T extends { cliente_asaas: string; cpfCnpj: string }>(x: T) => ({ ...x, cpfCnpj: x.cpfCnpj || docDe.get(x.cliente_asaas) || '' })
    const r = { assinaturas: asaas.assinaturas.map(comDoc), cobrancas: asaas.cobrancas.map(comDoc), cli, hon, des, fixas, sal }
    cache = { t: Date.now(), desde, dados: r }
    return r
  }, [desde])
  const recarregar = () => { forcar.atual = true; recarregarDados() }

  const r = useMemo(() => {
    if (!dados) return null
    const hoje = new Date().toLocaleDateString('sv-SE')
    const acha = (cus: string, cpf: string) => dados.cli.find(c => c.asaas_customer_id === cus) || dados.cli.find(c => cpf && dig(c.cnpj) === cpf)
    const pend = dados.cobrancas.filter(p => p.status === 'PENDING' && p.assinatura && p.vencimento >= hoje)
      .map(p => ({ p, c: acha(p.cliente_asaas, p.cpfCnpj) })).filter(x => x.c) as { p: CobrancaAsaas; c: Cliente }[]
    const pendIds = new Set(pend.map(x => x.p.id))
    // cliente cobrado no boleto de outro (boleto_cliente_id), ex.: Samira no boleto do Laboratório Alfa
    const pag = (id: string) => dados.cli.find(x => x.id === id)?.boleto_cliente_id || id
    const nomeCurto = (id: string) => (dados.cli.find(x => x.id === id)?.razao_social || '').split(' ').slice(0, 2).join(' ')
    const assinaturaDe = (id: string | null) => dados.assinaturas.find(s => s.id === id)

    // cada despesa em aberto vai para UM boleto: o já gravado (se ainda pendente) ou o 1º boleto pendente com competência >= a dela
    const despesasDo = new Map<string, DespesaB[]>()
    for (const d of dados.des) {
      let alvo: string | undefined
      if (d.asaas_boleto_id) { if (pendIds.has(d.asaas_boleto_id)) alvo = d.asaas_boleto_id; else continue }  // já cobrada num boleto (pago/vencido)
      else if (d.competencia >= desde) alvo = pend.filter(x => x.c.id === pag(d.cliente_id) && compDoVenc(x.p.vencimento) >= d.competencia)
        .sort((a, b) => a.p.vencimento.localeCompare(b.p.vencimento))[0]?.p.id
      if (!alvo) continue
      despesasDo.set(alvo, [...(despesasDo.get(alvo) || []), d])
    }

    const propostas: Proposta[] = []
    for (const { p, c } of pend) {
      const C = compDoVenc(p.vencimento)
      const hons = dados.hon.filter(x => pag(x.cliente_id) === c.id && x.competencia === C).sort((a, b) => (a.cliente_id === c.id ? 0 : 1) - (b.cliente_id === c.id ? 0 : 1))
      const h = hons[0]
      const extras = despesasDo.get(p.id) || []
      const avisos: string[] = []
      const itens: Item[] = []
      const gerada = C <= compParaIso(config.competencia_atual)
      if (h) {
        for (const x of hons) {
          const quem = x.cliente_id === c.id ? '' : ` (${nomeCurto(x.cliente_id)})`
          if (x.valor_pago_acumulado > 0 || x.status === 'Pago') avisos.push(`honorário ${comp(C)}${quem} já tem baixa de ${moeda(x.valor_pago_acumulado)} no Siscon`)
          const v = x.status === 'Pago' ? 0 : r2(Math.max(0, x.valor_original - x.valor_pago_acumulado - x.desconto))
          if (v > 0) itens.push({ texto: 'Honorários Mensais' + quem, valor: v })
        }
      } else if (!gerada) {
        // competência ainda não gerada no Siscon: mantém a base da assinatura (honorário + fixas) e só acrescenta as despesas lançadas
        if (!extras.length) continue
        const base = r2(p.valor - extras.filter(d => d.asaas_boleto_id === p.id).reduce((s, d) => s + d.saldo, 0))
        itens.push({ texto: 'Assinatura', valor: base })
      }
      if (!itens.length && !extras.length) continue
      for (const d of extras.sort((a, b) => a.competencia.localeCompare(b.competencia) || a.descricao.localeCompare(b.descricao)))
        itens.push({ texto: (d.competencia < C ? `${d.descricao} (${comp(d.competencia)})` : d.descricao) + (d.cliente_id !== c.id ? ` - ${nomeCurto(d.cliente_id)}` : ''), valor: r2(d.saldo), despesa: d.id })
      const novo = r2(itens.reduce((s, i) => s + i.valor, 0))
      // Descrição: o Asaas já imprime a descrição da ASSINATURA no boleto (ex.: "Honorários Mensais").
      // Por isso o Siscon manda só as despesas extras (uma linha por item, com valor), sem repetir o honorário
      // nem o que já está na descrição da assinatura (ex.: NFStock da El-Shaday). Sem extras, a descrição fica como está.
      const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ')
      const descAss = semAcento(assinaturaDe(p.assinatura)?.descricao || '')
      const visiveis = itens.filter(i => i.despesa && !descAss.includes(semAcento(extras.find(d => d.id === i.despesa)!.descricao)))
      const descNova = visiveis.length ? visiveis.map(i => linha(i.texto, i.valor)).join('\n') : (p.descricao || '')
      const mudouValor = Math.abs(novo - p.valor) > 0.009
      // só conta como mudança de descrição se alguma despesa ainda não aparece no boleto (descrição dele + a da assinatura)
      const mudouDesc = extras.some(d => !semAcento((p.descricao || '') + ' ' + descAss).includes(semAcento(d.descricao)))
      if (!mudouValor && !mudouDesc) continue
      if (novo <= 0) avisos.push('valor ficaria zerado: confira e, se for o caso, cancele o boleto no Asaas')
      else if (novo < p.valor - 0.009) avisos.push(`valor menor que o atual no Asaas (${moeda(p.valor)}): o boleto pode incluir débito de outro mês colocado à mão`)
      propostas.push({ id: p.id, cliente: c, vencimento: p.vencimento, comp: C, atual: p.valor, novo, descAtual: p.descricao || '', descNova, itens, avisos })
    }
    propostas.sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.cliente.razao_social.localeCompare(b.cliente.razao_social))

    // assinaturas: valor esperado = honorário (salário vigente × %) + despesas fixas ativas
    const sm = salarioPara(dados.sal, compParaIso(config.competencia_atual), Number(config.salario_minimo))
    const assinaturas = dados.assinaturas.map(s => ({ s, c: acha(s.cliente_asaas, s.cpfCnpj) })).filter(x => x.c).map(({ s, c }) => {
      const grupo = dados.cli.filter(x => x.id === c!.id || x.boleto_cliente_id === c!.id)
      const fixas = dados.fixas.filter(f => grupo.some(g => g.id === f.cliente_id) && f.ativa).reduce((t, f) => t + Number(f.valor), 0)
      const esperado = r2(grupo.reduce((t, g) => t + Math.round(sm * g.percentual_honorario) / 100, 0) + fixas)
      return { s, c: c!, esperado, fixas }
    }).filter(x => Math.abs(x.esperado - x.s.valor) > 0.009 && x.c.status === 'Ativo' && x.esperado > 0)
    // mostra só os boletos que vencem no mês atual; os dos meses seguintes aparecem no mês do vencimento
    // (a distribuição das despesas continua considerando todos os boletos pendentes)
    const mes = hoje.slice(0, 7)
    const doMes = propostas.filter(p => p.vencimento.startsWith(mes))
    return { propostas: doMes, depois: propostas.length - doMes.length, mes, assinaturas }
  }, [dados, desde, config.competencia_atual, config.salario_minimo])

  const sel = marcados ?? new Set((r?.propostas || []).filter(p => !p.avisos.length).map(p => p.id))
  const selAss = marcAss ?? new Set<string>()
  const alterna = (set: Set<string>, id: string, fn: (s: Set<string>) => void) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); fn(n) }

  async function aplicarBoletos() {
    const lista = (r?.propostas || []).filter(p => sel.has(p.id))
    if (!lista.length) return
    if (!confirm(`Alterar ${lista.length} boleto(s) no Asaas (valor e descrição)? Só boletos ainda pendentes serão alterados.`)) return
    setAplicando(true)
    try {
      const { resultado } = await chamarAsaas<{ resultado: { id: string; ok: boolean; msg: string }[] }>('aplicar_boletos',
        { ajustes: lista.map(p => ({ id: p.id, valor: p.novo, descricao: p.descNova })) })
      // grava em qual boleto cada despesa foi cobrada (só dos boletos alterados com sucesso)
      for (const p of lista.filter(x => resultado.find(y => y.id === x.id)?.ok)) {
        const ids = p.itens.map(i => i.despesa).filter(Boolean) as string[]
        if (ids.length) ok(await supabase.from('despesas').update({ asaas_boleto_id: p.id }).in('id', ids))
      }
      const erros = resultado.filter(x => !x.ok)
      avisar(erros.length ? `${resultado.length - erros.length} alterado(s); ${erros.length} com erro: ${erros.map(e => e.msg).join(' · ')}` : `${resultado.length} boleto(s) alterado(s) no Asaas.`, erros.length ? 'erro' : undefined)
      setMarcados(null); recarregar()
    } catch (e) { avisar((e as Error).message, 'erro') } finally { setAplicando(false) }
  }

  /** Despesas deste ajuste ficam fora do Asaas (cobradas por Pix/recibo): não aparecem mais nos ajustes */
  async function ignorar(p: Proposta) {
    const ids = p.itens.map(i => i.despesa).filter(Boolean) as string[]
    if (!ids.length) return avisar('Este ajuste não tem despesa extra para deixar de fora (é diferença de honorário).', 'erro')
    if (!confirm(`Não cobrar pelo Asaas: ${p.itens.filter(i => i.despesa).map(i => i.texto).join(', ')}?`)) return
    try { ok(await supabase.from('despesas').update({ asaas_boleto_id: 'fora' }).in('id', ids)); recarregar() }
    catch (e) { avisar((e as Error).message, 'erro') }
  }

  async function aplicarAssinaturas() {
    const lista = (r?.assinaturas || []).filter(a => selAss.has(a.s.id))
    if (!lista.length || !confirm(`Alterar o valor de ${lista.length} assinatura(s) no Asaas? Vale para os próximos boletos.`)) return
    setAplicando(true)
    try {
      const { resultado } = await chamarAsaas<{ resultado: { id: string; ok: boolean; msg: string }[] }>('aplicar_assinaturas',
        { ajustes: lista.map(a => ({ id: a.s.id, valor: a.esperado })) })
      const erros = resultado.filter(x => !x.ok)
      avisar(erros.length ? `${erros.length} com erro: ${erros.map(e => e.msg).join(' · ')}` : `${resultado.length} assinatura(s) alterada(s).`, erros.length ? 'erro' : undefined)
      setMarcAss(null); recarregar()
    } catch (e) { avisar((e as Error).message, 'erro') } finally { setAplicando(false) }
  }

  if (erro) return <Aviso icone="alerta" titulo="Não foi possível consultar o Asaas agora" texto="Tente atualizar daqui a pouco. Se continuar, me envie a mensagem abaixo." detalhe={erro} />
  if (!r) return <Carregando />
  const totalDif = r.propostas.filter(p => sel.has(p.id)).reduce((s, p) => s + p.novo - p.atual, 0)

  return <>
    <Resumo itens={[
      { rotulo: 'Boletos a ajustar', valor: r.propostas.length, detalhe: `vencimento em ${r.mes.slice(5)}/${r.mes.slice(0, 4)}`, tom: r.propostas.length ? 'laranja' : 'verde' },
      { rotulo: 'Selecionados', valor: sel.size, detalhe: `diferença ${moeda(totalDif)}`, tom: 'azul' },
      { rotulo: 'Assinaturas com valor diferente', valor: r.assinaturas.length, detalhe: 'honorário + fixas', tom: r.assinaturas.length ? 'laranja' : 'verde' },
    ]} />
    <p className="mb-3 text-sm text-slate-500">O boleto de cada competência recebe o honorário e as despesas extras dela; despesa cujo boleto já foi pago ou venceu vai para o próximo boleto pendente. Nada é alterado no Asaas sem você confirmar. Despesas com competência anterior a {comp(desde)} não entram (já cobradas à mão).</p>

    <Cartao titulo={`Boletos com vencimento em ${r.mes.slice(5)}/${r.mes.slice(0, 4)} a ajustar`} acoes={<div className="flex gap-2">
      <Botao variante="secundario" onClick={() => { setMarcados(null); recarregar() }}>Atualizar</Botao>
      <Botao onClick={aplicarBoletos} disabled={aplicando || !sel.size}>{aplicando ? 'Alterando…' : `Alterar ${sel.size} no Asaas`}</Botao></div>}>
      {r.depois > 0 && <p className="border-b border-slate-100 bg-slate-50 px-5 py-2 text-xs text-slate-500">{r.depois} ajuste(s) em boletos dos meses seguintes aparecerão aqui no mês do vencimento.</p>}
      {r.propostas.length === 0 ? <Vazio texto="Nenhum boleto deste mês precisa de ajuste." /> :
        <ul className="divide-y divide-slate-100">
          {r.propostas.map(p => (
            <li key={p.id} className="flex gap-3 px-5 py-3 text-sm">
              <input type="checkbox" className="mt-1.5" checked={sel.has(p.id)} onChange={() => alterna(sel, p.id, setMarcados)} />
              <Avatar nome={p.cliente.razao_social} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-slate-800">{p.cliente.razao_social}</span>
                  <span className="num text-slate-500">{moeda(p.atual)} → <b className={p.novo > p.atual ? 'text-blue-700' : 'text-amber-700'}>{moeda(p.novo)}</b></span>
                </div>
                <p className="text-xs text-slate-400">vence {data(p.vencimento)} · competência {comp(p.comp)}</p>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                  <pre className="whitespace-pre-wrap rounded-md bg-slate-50 px-2.5 py-1.5 font-sans text-xs text-slate-500"><span className="block text-[10px] font-semibold uppercase text-slate-400">Hoje no Asaas</span>{p.descAtual || '—'}</pre>
                  <pre className="whitespace-pre-wrap rounded-md bg-blue-50 px-2.5 py-1.5 font-sans text-xs text-slate-700"><span className="block text-[10px] font-semibold uppercase text-blue-500">Vai ficar</span>{p.descNova || '—'}<span className="mt-0.5 block text-[10px] text-slate-400">+ descrição da assinatura (o Asaas acrescenta)</span></pre>
                </div>
                <div className="mt-1 flex gap-4"><button className="text-xs font-medium text-marca-700 hover:underline" onClick={() => abrirBoleto({ id: p.id }).catch(e => avisar((e as Error).message, 'erro'))}><span className="inline-flex items-center gap-1"><LogoAsaas className="h-3 w-3" />Ver boleto (PDF)</span></button>
                {p.itens.some(i => i.despesa) && <button className="text-xs text-slate-500 hover:text-red-600 hover:underline" onClick={() => ignorar(p)}>Não cobrar estas despesas pelo Asaas</button>}</div>
                {p.avisos.map(a => <p key={a} className="mt-1 text-xs font-medium text-amber-700">⚠ {a} (desmarcado; marque se estiver certo)</p>)}
              </div>
            </li>))}
        </ul>}
    </Cartao>

    <div className="mt-6" />
    <Cartao titulo="Assinaturas com valor diferente do Siscon" acoes={<Botao variante="secundario" onClick={aplicarAssinaturas} disabled={aplicando || !selAss.size}>Alterar {selAss.size} assinatura(s)</Botao>}>
      {r.assinaturas.length === 0 ? <Vazio texto="Todas as assinaturas estão com o valor do Siscon." /> :
        <table className="tabela compacta">
          <thead><tr><th></th><th>Cliente</th><th className="text-right">No Asaas</th><th className="text-right">Siscon (honorário + fixas)</th><th>Próximo venc.</th></tr></thead>
          <tbody>{r.assinaturas.map(a => <tr key={a.s.id}>
            <td><input type="checkbox" checked={selAss.has(a.s.id)} onChange={() => alterna(selAss, a.s.id, setMarcAss)} /></td>
            <td>{a.c.razao_social}</td>
            <td className="num text-right">{moeda(a.s.valor)}</td>
            <td className="num text-right font-medium">{moeda(a.esperado)}{a.fixas > 0 && <span className="ml-1 text-xs text-slate-400">(fixas {moeda(a.fixas)})</span>}</td>
            <td>{data(a.s.proximo_vencimento)}</td>
          </tr>)}</tbody>
        </table>}
      <p className="px-5 pb-3 pt-2 text-xs text-slate-500">Muda o valor dos <b>próximos</b> boletos da assinatura. Os boletos já criados são ajustados pela lista acima. Nenhuma assinatura vem marcada: confira antes (ex.: boleto com honorário de outra pessoa junto, como a Samira no Laboratório Alfa).</p>
    </Cartao>
  </>
}
