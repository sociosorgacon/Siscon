import { useEffect, useState } from 'react'
import { supabase, ok, todos } from '../lib/supabase'
import { useApp, type Config } from '../lib/app'
import { hojeIso } from '../lib/format'
import { Botao, Cabecalho, Campo, Cartao, useAviso } from '../components/ui'

const descricoes: Partial<Record<keyof Config, string>> = {
  salario_minimo: 'Salário mínimo vigente', vigencia_salario: 'Data de vigência do salário', taxa_juros: 'Taxa de juros mensal (%)',
  competencia_atual: 'Competência atual para geração de honorários e juros', escritorio_nome: 'Nome do escritório (recibo)',
  escritorio_cnpj: 'CNPJ do escritório (recibo)', escritorio_endereco: 'Endereço do escritório (recibo)',
  escritorio_cidade: 'Cidade/UF (local do recibo)', escritorio_telefone: 'Telefone do escritório (recibo)',
}

export default function Configuracoes() {
  const { config, recarregarConfig } = useApp()
  const avisar = useAviso()
  const [f, setF] = useState<Config>(config)
  const [salvando, setSalvando] = useState(false)
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
    try {
      const tabelas = ['configuracoes', 'clientes', 'honorarios', 'despesas', 'recibos', 'recibo_itens'] as const
      const dados: Record<string, unknown> = { exportado_em: new Date().toISOString() }
      for (const t of tabelas) dados[t] = await todos((a, b) => supabase.from(t).select('*').range(a, b))
      const url = URL.createObjectURL(new Blob([JSON.stringify(dados)], { type: 'application/json' }))
      Object.assign(document.createElement('a'), { href: url, download: `siscon_backup_${hojeIso()}.json` }).click()
      URL.revokeObjectURL(url); avisar('Backup baixado. Guarde em local seguro: contém dados de clientes.')
    } catch (e) { avisar((e as Error).message, 'erro') }
  }

  return (
    <>
      <Cabecalho titulo="Configurações" acoes={<Botao variante="secundario" onClick={backup}>Baixar backup completo</Botao>} />
      <form onSubmit={salvar} className="grid gap-4 lg:grid-cols-2">
        <Cartao titulo="Cálculo dos honorários">
          <div className="grid grid-cols-2 gap-3 p-4">
            <Campo rotulo="Salário mínimo (R$)">{campo('salario_minimo', { inputMode: 'decimal' })}</Campo>
            <Campo rotulo="Vigência">{campo('vigencia_salario', { type: 'date' })}</Campo>
            <Campo rotulo="Juros ao mês (%)">{campo('taxa_juros', { inputMode: 'decimal' })}</Campo>
            <Campo rotulo="Competência atual (MM/AAAA)">{campo('competencia_atual')}</Campo>
            <p className="col-span-2 text-xs text-slate-500">
              Novo salário mínimo vale para os honorários gerados a partir de agora; os já lançados mantêm o valor. Juros são simples, por mês de competência em atraso.
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
          </div>
        </Cartao>
        <div className="lg:col-span-2 flex justify-end"><Botao disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar configurações'}</Botao></div>
      </form>
    </>
  )
}
