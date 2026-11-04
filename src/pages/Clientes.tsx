import { useMemo, useState } from 'react'
import { supabase, ok, todos, type Cliente } from '../lib/supabase'
import { useApp, useDados } from '../lib/app'
import { moeda, doc, normaliza } from '../lib/format'
import { Avatar, Botao, Busca, Cabecalho, Campo, Cartao, Carregando, Modal, Pilulas, Resumo, Selo, Vazio, useAviso } from '../components/ui'
import { Icone } from '../components/icones'

const novo = (): Partial<Cliente> => ({ status: 'Ativo', percentual_honorario: 0, dia_vencimento: 10, multa_por_atraso: true })

export default function Clientes() {
  const { config } = useApp()
  const avisar = useAviso()
  const sm = Number(config.salario_minimo)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<'Ativo' | 'Inativo' | ''>('Ativo')
  const [edit, setEdit] = useState<Partial<Cliente> | null>(null)
  const { dados, recarregar } = useDados(() =>
    todos<Cliente>((a, b) => supabase.from('clientes').select('*').order('razao_social').range(a, b)))

  const lista = useMemo(() => (dados || []).filter(c =>
    (!filtro || c.status === filtro) &&
    (!busca || normaliza(`${c.razao_social} ${c.nome_fantasia || ''} ${c.cnpj}`).includes(normaliza(busca)))), [dados, busca, filtro])

  const totalMensal = lista.filter(c => c.status === 'Ativo').reduce((s, c) => s + sm * c.percentual_honorario / 100, 0)

  return (
    <>
      <Cabecalho icone="clientes" titulo="Clientes" subtitulo="Cadastro, percentual do salário mínimo e dia de vencimento"
        acoes={<Botao onClick={() => setEdit(novo())}>Novo cliente</Botao>} />
      {dados && (() => {
        const ativos = dados.filter(c => c.status === 'Ativo'), mensal = ativos.reduce((s, c) => s + sm * c.percentual_honorario / 100, 0)
        return <Resumo itens={[
          { rotulo: 'Clientes ativos', valor: ativos.length, detalhe: `${dados.length - ativos.length} inativos`, tom: 'azul' },
          { rotulo: 'Honorários mensais', valor: moeda(mensal), detalhe: 'soma dos clientes ativos', tom: 'verde' },
          { rotulo: 'Honorário médio', valor: moeda(ativos.length ? mensal / ativos.length : 0), detalhe: 'por cliente ativo', tom: 'cinza' },
          { rotulo: 'Sem boleto vinculado', valor: ativos.filter(c => !c.asaas_customer_id && !c.asaas_nome).length, detalhe: 'sem vínculo com o Asaas', tom: 'laranja' },
        ]} />
      })()}
      <Cartao>
        <div className="filtros">
          <Pilulas atual={filtro} mudar={setFiltro} opcoes={[
            ['Ativo', 'Ativos', (dados || []).filter(c => c.status === 'Ativo').length], ['Inativo', 'Inativos', (dados || []).filter(c => c.status === 'Inativo').length], ['', 'Todos', (dados || []).length],
          ] as const} />
          <span className="text-xs text-slate-500">{lista.length} na lista · {moeda(totalMensal)}/mês</span>
          <Busca valor={busca} mudar={setBusca} placeholder="Buscar por nome ou CNPJ/CPF" className="ml-auto max-w-sm" />
        </div>
        {!dados ? <Carregando /> : lista.length === 0 ? <Vazio /> :
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead><tr><th>Cliente</th><th>CNPJ/CPF</th><th>Município</th><th className="text-right">% SM</th><th className="text-right">Honorário</th><th>Venc.</th><th>Status</th><th /></tr></thead>
              <tbody>{lista.map(c => (
                <tr key={c.id}>
                  <td className="max-w-[20rem]" title={c.razao_social}><span className="flex items-center gap-2.5"><Avatar nome={c.razao_social} />
                    <span className="min-w-0"><span className="block truncate font-medium text-slate-800">{c.razao_social}</span>{c.nome_fantasia && <span className="block truncate text-[11px] text-slate-400">{c.nome_fantasia}</span>}</span></span></td>
                  <td className="num">{doc(c.cnpj)}</td>
                  <td>{c.municipio ? `${c.municipio}${c.uf ? '/' + c.uf : ''}` : '—'}</td>
                  <td className="num text-right">{c.percentual_honorario.toLocaleString('pt-BR')}%</td>
                  <td className="num text-right font-medium text-slate-800">{moeda(sm * c.percentual_honorario / 100)}</td>
                  <td className="num">dia {c.dia_vencimento}</td>
                  <td><Selo texto={c.status} /></td>
                  <td className="pr-4 text-right"><button onClick={() => setEdit(c)} title="Editar" aria-label="Editar" className="rounded-md p-1.5 text-slate-500 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 hover:text-blue-700"><Icone nome="editar" className="h-3.5 w-3.5" /></button></td>
                </tr>))}
              </tbody>
            </table>
          </div>}
      </Cartao>
      {edit && <FormCliente cliente={edit} sm={sm} fechar={() => setEdit(null)}
        salvo={() => { setEdit(null); recarregar(); avisar('Cliente salvo.') }} />}
    </>
  )
}

function FormCliente({ cliente, sm, fechar, salvo }: { cliente: Partial<Cliente>; sm: number; fechar: () => void; salvo: () => void }) {
  const avisar = useAviso()
  const [c, setC] = useState<Partial<Cliente>>(cliente)
  const [salvando, setSalvando] = useState(false)
  const set = <K extends keyof Cliente>(k: K, v: Cliente[K] | null) => setC(x => ({ ...x, [k]: v }))
  const txt = (k: keyof Cliente) => ({ value: (c[k] as string) ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value || null as never) })

  async function buscarCnpj() {
    const n = (c.cnpj || '').replace(/\D/g, '')
    if (n.length !== 14) return avisar('Informe um CNPJ com 14 dígitos.', 'erro')
    try {
      const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${n}`)
      if (!r.ok) throw new Error()
      const d = await r.json()
      setC(x => ({
        ...x, razao_social: d.razao_social, nome_fantasia: d.nome_fantasia || x.nome_fantasia,
        logradouro: [d.logradouro, d.numero, d.bairro].filter(Boolean).join(', '), municipio: d.municipio, uf: d.uf,
        situacao: d.descricao_situacao_cadastral, email: x.email || d.email, telefone: x.telefone || d.ddd_telefone_1,
      }))
      avisar('Dados preenchidos pela Receita Federal.')
    } catch { avisar('Não foi possível consultar o CNPJ agora.', 'erro') }
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setSalvando(true)
    try {
      const { id, ...campos } = c
      const reg = { ...campos, cnpj: (c.cnpj || '').replace(/\D/g, ''), razao_social: (c.razao_social || '').trim().toUpperCase() }
      ok(id ? await supabase.from('clientes').update(reg).eq('id', id) : await supabase.from('clientes').insert(reg))
      salvo()
    } catch (err) { avisar((err as Error).message, 'erro') } finally { setSalvando(false) }
  }

  return (
    <Modal titulo={c.id ? 'Editar cliente' : 'Novo cliente'} aberto fechar={fechar} largura="max-w-2xl">
      <form onSubmit={salvar} className="grid grid-cols-6 gap-3">
        <Campo rotulo="CNPJ / CPF" className="col-span-6 sm:col-span-3">
          <div className="flex gap-2"><input className="campo" required {...txt('cnpj')} />
            <Botao type="button" variante="secundario" onClick={buscarCnpj} title="Preencher pela Receita">Buscar</Botao></div>
        </Campo>
        <Campo rotulo="Status" className="col-span-3 sm:col-span-3">
          <select className="campo" value={c.status} onChange={e => set('status', e.target.value as Cliente['status'])}>
            <option>Ativo</option><option>Inativo</option></select>
        </Campo>
        <Campo rotulo="Razão social / Nome" className="col-span-6"><input className="campo" required {...txt('razao_social')} /></Campo>
        <Campo rotulo="Nome fantasia" className="col-span-6 sm:col-span-3"><input className="campo" {...txt('nome_fantasia')} /></Campo>
        <Campo rotulo="Situação cadastral" className="col-span-6 sm:col-span-3"><input className="campo" {...txt('situacao')} /></Campo>
        <Campo rotulo="E-mail" className="col-span-6 sm:col-span-3"><input className="campo" type="email" {...txt('email')} /></Campo>
        <Campo rotulo="Telefone" className="col-span-6 sm:col-span-3"><input className="campo" {...txt('telefone')} /></Campo>
        <Campo rotulo="Endereço" className="col-span-6"><input className="campo" {...txt('logradouro')} /></Campo>
        <Campo rotulo="Município" className="col-span-4"><input className="campo" {...txt('municipio')} /></Campo>
        <Campo rotulo="UF" className="col-span-2"><input className="campo" maxLength={2} {...txt('uf')} /></Campo>

        <div className="col-span-6 mt-2 grid grid-cols-6 gap-3 rounded-md bg-marca-50 p-3">
          <Campo rotulo="% do salário mínimo" className="col-span-3 sm:col-span-2">
            <input className="campo" type="number" step="0.01" min="0" value={c.percentual_honorario ?? 0}
              onChange={e => set('percentual_honorario', Number(e.target.value))} />
          </Campo>
          <Campo rotulo="Dia de vencimento" className="col-span-3 sm:col-span-2">
            <input className="campo" type="number" min="1" max="31" value={c.dia_vencimento ?? 10} onChange={e => set('dia_vencimento', Number(e.target.value))} />
          </Campo>
          <div className="col-span-6 sm:col-span-2 self-end pb-2 text-sm">
            Honorário: <b className="num">{moeda(sm * (c.percentual_honorario || 0) / 100)}</b>
          </div>
          <label className="col-span-6 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!c.multa_por_atraso} onChange={e => set('multa_por_atraso', e.target.checked)} /> Multa por atraso (cobra juros de 1,55% a.m. quando a competência vira)
          </label>
        </div>

        <div className="col-span-6 mt-2 flex justify-end gap-2">
          <Botao type="button" variante="secundario" onClick={fechar}>Cancelar</Botao>
          <Botao disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Botao>
        </div>
      </form>
    </Modal>
  )
}
