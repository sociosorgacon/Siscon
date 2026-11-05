import { useEffect, useState } from 'react'
import { supabase, ok } from '../lib/supabase'
import { useApp, useDados, descricoesPadrao, type Config, type SalarioMinimo } from '../lib/app'
import { baixarBackup } from '../lib/backup'
import { moeda, comp } from '../lib/format'
import { Botao, Cabecalho, Campo, useAviso } from '../components/ui'
import { Icone, type NomeIcone } from '../components/icones'

const descricoes: Partial<Record<keyof Config, string>> = {
  salario_minimo: 'Salário mínimo vigente', vigencia_salario: 'Data de vigência do salário',
  competencia_atual: 'Competência atual para geração de honorários e juros', escritorio_nome: 'Nome do escritório (recibo)',
  escritorio_cnpj: 'CNPJ do escritório (recibo)', escritorio_endereco: 'Endereço do escritório (recibo)',
  escritorio_cidade: 'Cidade/UF (local do recibo)', escritorio_telefone: 'Telefone do escritório (recibo)',
  pix_chave: 'Chave Pix para o QR Code da relação de honorários',
  descricoes_despesas: 'Descrições padronizadas de despesas extras (uma por linha)',
}

export default function Configuracoes() {
  const { config, recarregarConfig } = useApp()
  const avisar = useAviso()
  const [f, setF] = useState<Config>(config)
  const [salvando, setSalvando] = useState(false)
  const [novaDesc, setNovaDesc] = useState('')
  const { dados: salarios, recarregar: recarregarSalarios } = useDados(async () =>
    ok(await supabase.from('salarios_minimos').select('vigencia, valor').order('vigencia', { ascending: false })) as SalarioMinimo[])
  const listaDesc = descricoesPadrao(f)
  const mudarDesc = (l: string[]) => setF({ ...f, descricoes_despesas: l.join('\n') })
  function adicionarDesc() {
    const d = novaDesc.trim().replace(/\s+/g, ' ')
    if (!d) return
    if (listaDesc.some(x => x.toLowerCase() === d.toLowerCase())) return avisar('Essa descrição já está na lista.', 'erro')
    mudarDesc([...listaDesc, d].sort((a, b) => a.localeCompare(b, 'pt-BR'))); setNovaDesc('')
  }
  useEffect(() => setF(config), [config])
  const campo = (k: keyof Config, props: React.InputHTMLAttributes<HTMLInputElement> = {}) =>
    <input className="campo" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} {...props} />

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (!/^\d{2}\/\d{4}$/.test(f.competencia_atual)) return avisar('Competência deve estar no formato MM/AAAA.', 'erro')
    if (f.competencia_atual !== config.competencia_atual &&
      !confirm(`Alterar a competência atual de ${config.competencia_atual} para ${f.competencia_atual} muda o cálculo de juros de todos os atrasados. Para a virada normal do mês, use "Avançar competência" em Honorários. Continuar?`)) return
    const smNovo = Number(String(f.salario_minimo).replace(',', '.'))
    const mudouSal = smNovo !== Number(config.salario_minimo) || f.vigencia_salario !== config.vigencia_salario
    const vig = /^\d{4}-\d{2}/.test(f.vigencia_salario) ? `${f.vigencia_salario.slice(0, 7)}-01` : ''
    if (mudouSal) {
      if (!(smNovo > 0)) return avisar('Informe o salário mínimo.', 'erro')
      if (!vig) return avisar('Informe a data de vigência do salário.', 'erro')
      const existente = (salarios || []).find(s => s.vigencia === vig)
      if (existente && Number(existente.valor) !== smNovo && !confirm(`Já existe salário de ${moeda(Number(existente.valor))} com vigência ${comp(vig)}. Substituir por ${moeda(smNovo)}?\n\nSe é um salário NOVO, cancele e informe a nova data de vigência (ex.: 01/01 do ano novo) para manter o anterior nas competências antigas.`)) return
    }
    setSalvando(true)
    try {
      if (mudouSal) ok(await supabase.from('salarios_minimos').upsert({ vigencia: vig, valor: smNovo }, { onConflict: 'vigencia' }))
      const linhas = (Object.keys(descricoes) as (keyof Config)[]).map(k => ({ chave: k, valor: String(f[k] ?? '').replace(',', k === 'taxa_juros' || k === 'salario_minimo' ? '.' : ','), descricao: descricoes[k] }))
      ok(await supabase.from('configuracoes').upsert(linhas, { onConflict: 'chave' }))
      await recarregarConfig(); recarregarSalarios(); avisar('Configurações salvas.')
    } catch (err) { avisar((err as Error).message, 'erro') } finally { setSalvando(false) }
  }

  async function backup() {
    try { await baixarBackup(); avisar('Backup baixado. Guarde em local seguro: contém dados de clientes.') }
    catch (e) { avisar((e as Error).message, 'erro') }
  }

  const sm = Number(String(f.salario_minimo).replace(',', '.')) || 0
  const alterado = JSON.stringify(f) !== JSON.stringify(config)

  return (
    <>
      <Cabecalho icone="config" titulo="Configurações" subtitulo="Parâmetros de cálculo, dados do escritório que saem nos recibos e descrições padronizadas"
        acoes={<Botao variante="secundario" onClick={backup}><span className="inline-flex items-center gap-1.5"><Icone nome="baixar" className="h-4 w-4" />Baixar backup completo</span></Botao>} />
      <form onSubmit={salvar} className="grid gap-5 pb-24 lg:grid-cols-2">
        <Secao icone="honorarios" cor="from-blue-600 to-blue-500" titulo="Cálculo dos honorários" descricao="Base de todos os honorários: salário mínimo × % do cliente">
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Salário mínimo (R$)">{campo('salario_minimo', { inputMode: 'decimal' })}</Campo>
            <Campo rotulo="Vigência">{campo('vigencia_salario', { type: 'date' })}</Campo>
            <Campo rotulo="Juros ao mês (fixo)"><input className="campo bg-slate-50 text-slate-500" value="1,55% a.m. (simples)" disabled /></Campo>
            <Campo rotulo="Competência atual (MM/AAAA)">{campo('competencia_atual')}</Campo>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-center">
            {[10, 40, 80].map(p => <div key={p}><p className="text-[11px] text-slate-500">Cliente com {p}%</p><p className="num text-sm font-semibold text-slate-800">{moeda(sm * p / 100)}</p></div>)}
          </div>
          <div className="mt-4">
            <p className="rotulo">Histórico do salário mínimo</p>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
              {(salarios || []).length === 0 && <p className="px-3 py-2 text-slate-400">Nenhum salário registrado.</p>}
              {(salarios || []).map((s, i) => <div key={s.vigencia} className="flex items-center justify-between px-3 py-1.5">
                <span className="text-slate-600">Competência {comp(s.vigencia)} em diante{i === 0 && <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">atual</span>}</span>
                <span className="num font-medium text-slate-800">{moeda(Number(s.valor))}</span></div>)}
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">Cada competência usa o salário vigente nela: salário novo com vigência 01/01/2027 vale da competência 01/2027 em diante; a 12/2026 (gerada em janeiro) continua com o anterior. Para salário novo, informe o valor <b>e</b> a nova vigência. Honorários já lançados mantêm o valor. Juros só para clientes com multa por atraso, contados a cada virada de competência.</p>
        </Secao>

        <Secao icone="recibos" cor="from-emerald-600 to-emerald-500" titulo="Dados do escritório" descricao="Aparecem no recibo, na relação de honorários e no Pix">
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Nome" className="col-span-2">{campo('escritorio_nome')}</Campo>
            <Campo rotulo="CNPJ">{campo('escritorio_cnpj')}</Campo>
            <Campo rotulo="Telefone">{campo('escritorio_telefone')}</Campo>
            <Campo rotulo="Endereço" className="col-span-2">{campo('escritorio_endereco')}</Campo>
            <Campo rotulo="Cidade/UF">{campo('escritorio_cidade')}</Campo>
            <Campo rotulo="Chave Pix (vazio = CNPJ)">{campo('pix_chave', { placeholder: f.escritorio_cnpj })}</Campo>
          </div>
          {/* prévia do cabeçalho do recibo */}
          <div className="mt-4 flex items-center gap-4 rounded-lg border border-dashed border-slate-300 p-3">
            <img src="/logo.png" alt="" className="h-9" />
            <div className="min-w-0 text-xs text-slate-500">
              <p className="truncate font-semibold text-slate-800">{f.escritorio_nome || '—'}</p>
              <p className="truncate">CNPJ {f.escritorio_cnpj || '—'} · {f.escritorio_endereco || 'endereço'} · {f.escritorio_cidade || ''}</p>
              <p>Pix: <span className="num">{f.pix_chave || f.escritorio_cnpj || '—'}</span></p>
            </div>
            <span className="ml-auto shrink-0 rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase text-slate-500">prévia do recibo</span>
          </div>
        </Secao>

        <Secao icone="despesas" cor="from-amber-500 to-amber-400" titulo="Descrições de despesas extras" descricao={`Sugestões do campo Descrição e base dos tipos no Painel · ${listaDesc.length} cadastradas`} className="lg:col-span-2">
          <div className="flex gap-2">
            <input className="campo" placeholder="Nova descrição (ex.: Fechamento de Escrita)" value={novaDesc} onChange={e => setNovaDesc(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); adicionarDesc() } }} />
            <Botao type="button" variante="secundario" onClick={adicionarDesc}><span className="inline-flex items-center gap-1"><Icone nome="mais" className="h-4 w-4" />Adicionar</span></Botao>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {listaDesc.length === 0 && <p className="text-sm text-slate-400">Nenhuma descrição cadastrada.</p>}
            {listaDesc.map(d => <span key={d} className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 py-1 pl-3 pr-1.5 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
              {d}<button type="button" title="Remover" onClick={() => mudarDesc(listaDesc.filter(x => x !== d))} className="rounded-full p-0.5 text-amber-700 hover:bg-amber-200/60"><Icone nome="fechar" className="h-3.5 w-3.5" /></button></span>)}
          </div>
        </Secao>

        {/* Barra fixa de salvar */}
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/90 backdrop-blur lg:left-64">
          <div className="mx-auto flex max-w-7xl items-center justify-end gap-3 px-6 py-3">
            <span className={`text-sm ${alterado ? 'font-medium text-amber-700' : 'text-slate-400'}`}>{alterado ? '● Alterações não salvas' : 'Tudo salvo'}</span>
            {alterado && <Botao type="button" variante="secundario" onClick={() => setF(config)}>Descartar</Botao>}
            <Botao disabled={salvando || !alterado}>{salvando ? 'Salvando…' : 'Salvar configurações'}</Botao>
          </div>
        </div>
      </form>
    </>
  )
}

function Secao({ icone, cor, titulo, descricao, children, className = '' }: { icone: NomeIcone; cor: string; titulo: string; descricao: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)] ${className}`}>
      <header className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br ${cor} text-white shadow-sm`}><Icone nome={icone} className="h-4 w-4" /></span>
        <div><h2 className="text-[15px] font-semibold text-slate-800">{titulo}</h2><p className="text-xs text-slate-500">{descricao}</p></div>
      </header>
      <div className="p-5">{children}</div>
    </section>
  )
}
