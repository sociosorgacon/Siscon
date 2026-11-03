import { useEffect, useState } from 'react'
import { supabase, ok, todos } from '../lib/supabase'
import { useApp, descricoesPadrao, type Config } from '../lib/app'
import { baixarBackup } from '../lib/backup'
import { hojeIso } from '../lib/format'
import { Botao, Cabecalho, Campo, Cartao, useAviso } from '../components/ui'

const descricoes: Partial<Record<keyof Config, string>> = {
  salario_minimo: 'Salário mínimo vigente', vigencia_salario: 'Data de vigência do salário',
  competencia_atual: 'Competência atual para geração de honorários e juros', escritorio_nome: 'Nome do escritório (recibo)',
  escritorio_cnpj: 'CNPJ do escritório (recibo)', escritorio_endereco: 'Endereço do escritório (recibo)',
  escritorio_cidade: 'Cidade/UF (local do recibo)', escritorio_telefone: 'Telefone do escritório (recibo)',
  pix_chave: 'Chave Pix para o QR Code dos extratos',
  descricoes_despesas: 'Descrições padronizadas de despesas extras (uma por linha)',
}

export default function Configuracoes() {
  const { config, recarregarConfig } = useApp()
  const avisar = useAviso()
  const [f, setF] = useState<Config>(config)
  const [salvando, setSalvando] = useState(false)
  const [novaDesc, setNovaDesc] = useState('')
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
    setSalvando(true)
    try {
      const linhas = (Object.keys(descricoes) as (keyof Config)[]).map(k => ({ chave: k, valor: String(f[k] ?? '').replace(',', k === 'taxa_juros' || k === 'salario_minimo' ? '.' : ','), descricao: descricoes[k] }))
      ok(await supabase.from('configuracoes').upsert(linhas, { onConflict: 'chave' }))
      await recarregarConfig(); avisar('Configurações salvas.')
    } catch (err) { avisar((err as Error).message, 'erro') } finally { setSalvando(false) }
  }

  async function backup() {
    try { await baixarBackup(); avisar('Backup baixado. Guarde em local seguro: contém dados de clientes.') }
    catch (e) { avisar((e as Error).message, 'erro') }
  }

  return (
    <>
      <Cabecalho titulo="Configurações" acoes={<Botao variante="secundario" onClick={backup}>Baixar backup completo</Botao>} />
      <form onSubmit={salvar} className="grid gap-4 lg:grid-cols-2">
        <Cartao titulo="Cálculo dos honorários">
          <div className="grid grid-cols-2 gap-3 p-4">
            <Campo rotulo="Salário mínimo (R$)">{campo('salario_minimo', { inputMode: 'decimal' })}</Campo>
            <Campo rotulo="Vigência">{campo('vigencia_salario', { type: 'date' })}</Campo>
            <Campo rotulo="Juros ao mês (fixo)"><input className="campo bg-slate-50" value="1,55%" disabled /></Campo>
            <Campo rotulo="Competência atual (MM/AAAA)">{campo('competencia_atual')}</Campo>
            <p className="col-span-2 text-xs text-slate-500">
              Novo salário mínimo vale para os honorários gerados a partir de agora; os já lançados mantêm o valor. Juros simples de 1,55% ao mês sobre o valor original, contados a cada virada de competência, só para clientes com multa por atraso.
            </p>
          </div>
        </Cartao>
        <Cartao titulo="Dados do escritório (aparecem no recibo)">
          <div className="grid grid-cols-2 gap-3 p-4">
            <Campo rotulo="Nome" className="col-span-2">{campo('escritorio_nome')}</Campo>
            <Campo rotulo="CNPJ">{campo('escritorio_cnpj')}</Campo>
            <Campo rotulo="Telefone">{campo('escritorio_telefone')}</Campo>
            <Campo rotulo="Endereço" className="col-span-2">{campo('escritorio_endereco')}</Campo>
            <Campo rotulo="Cidade/UF">{campo('escritorio_cidade')}</Campo>
            <Campo rotulo="Chave Pix (vazio = CNPJ)">{campo('pix_chave', { placeholder: f.escritorio_cnpj })}</Campo>
            <p className="col-span-2 text-xs text-slate-500">O QR Code Pix dos extratos é gerado com o valor exato do débito do cliente. Confira se a chave está cadastrada na conta que recebe.</p>
          </div>
        </Cartao>
        <Cartao titulo="Descrições de despesas extras">
          <div className="grid gap-3 p-4">
            <p className="text-xs text-slate-500">Opções que aparecem no campo Descrição ao lançar uma despesa (ainda é possível digitar outra). Clique em "Salvar configurações" para gravar.</p>
            <div className="flex gap-2">
              <input className="campo" placeholder="Nova descrição…" value={novaDesc} onChange={e => setNovaDesc(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); adicionarDesc() } }} />
              <Botao type="button" variante="secundario" onClick={adicionarDesc}>Adicionar</Botao>
            </div>
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {listaDesc.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">Nenhuma descrição cadastrada.</li>}
              {listaDesc.map(d => <li key={d} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>{d}</span>
                <Botao type="button" variante="link" onClick={() => mudarDesc(listaDesc.filter(x => x !== d))}>Remover</Botao>
              </li>)}
            </ul>
          </div>
        </Cartao>
        <div className="lg:col-span-2 flex justify-end"><Botao disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar configurações'}</Botao></div>
      </form>
    </>
  )
}
