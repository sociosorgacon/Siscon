import { useState } from 'react'
import { supabase, ok } from '../lib/supabase'
import { baixarBackup, TABELAS_BACKUP } from '../lib/backup'
import { Botao, useAviso } from './ui'
import { Icone } from './icones'

const NOMES: Record<string, string> = {
  configuracoes: 'Configurações', salarios_minimos: 'Salário mínimo (histórico)', clientes: 'Clientes', honorarios: 'Honorários',
  despesas: 'Despesas extras', despesas_fixas: 'Despesas fixas', recibos: 'Baixas e recibos', recibo_itens: 'Itens das baixas',
  asaas_eventos: 'Avisos do Asaas (baixas automáticas)', asaas_cobrancas: 'Boletos do Asaas', certificados_cobrados: 'Certificados digitais',
}
type Previa = { arquivo: string; exportado: string; origem: string; backup: Record<string, unknown>; linhas: { t: string; qtdBackup: number | null; qtdAtual: number | null; restaura: boolean; motivo: string }[] }

/** Lê o arquivo de backup (.json do botão ou .zip do backup automático do Drive) */
async function lerArquivo(f: File): Promise<Record<string, unknown>> {
  let texto: string
  if (/\.zip$/i.test(f.name)) {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(await f.arrayBuffer())
    const json = Object.values(zip.files).find(x => !x.dir && /\.json$/i.test(x.name))
    if (!json) throw new Error('O .zip não tem o arquivo .json do backup.')
    texto = await json.async('string')
  } else texto = await f.text()
  let j: Record<string, unknown>
  try { j = JSON.parse(texto) } catch { throw new Error('Arquivo inválido: não é um backup do Siscon.') }
  if (!j.exportado_em || !Array.isArray(j.clientes)) throw new Error('Arquivo inválido: não é um backup do Siscon.')
  return j
}

/**
 * Restaurar backup: prévia tabela a tabela (backup × hoje), exige digitar RESTAURAR, baixa ANTES um backup do estado atual
 * (para poder desfazer) e chama restaurar_backup no banco (tudo ou nada, numa transação).
 */
export default function RestaurarBackup() {
  const avisar = useAviso()
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [texto, setTexto] = useState('')
  const [etapa, setEtapa] = useState('')

  async function escolher(f?: File) {
    if (!f) return
    setPrevia(null); setTexto(''); setEtapa('Lendo o arquivo…')
    try {
      const b = await lerArquivo(f)
      // tabelas que deram erro no backup vêm vazias: não podem apagar os dados atuais
      const comErro = new Set(((b.tabelas_com_erro as string[]) || []).map(x => x.split(':')[0].trim()))
      const linhas = await Promise.all(TABELAS_BACKUP.map(async t => {
        const { count } = await supabase.from(t).select('*', { count: 'exact', head: true })
        const arr = b[t]
        const restaura = Array.isArray(arr) && !comErro.has(t)
        return { t, qtdBackup: Array.isArray(arr) ? arr.length : null, qtdAtual: count ?? null, restaura,
          motivo: restaura ? 'Substitui pelo backup' : comErro.has(t) ? 'Mantém (deu erro nesse backup)' : 'Mantém (não está no backup)' }
      }))
      setPrevia({ arquivo: f.name, exportado: String(b.exportado_em), origem: String(b.origem || ''), backup: b, linhas })
    } catch (e) { avisar((e as Error).message, 'erro') } finally { setEtapa('') }
  }

  async function restaurar() {
    if (!previa) return
    if (texto.trim().toUpperCase() !== 'RESTAURAR') return avisar('Digite RESTAURAR para confirmar.', 'erro')
    try {
      setEtapa('1/2 Baixando um backup do estado atual (para poder desfazer)…')
      const falhas = await baixarBackup()
      if (falhas.length) throw new Error(`O backup de segurança do estado atual falhou (${falhas.join(', ')}). Restauração cancelada.`)
      setEtapa('2/2 Restaurando…')
      const tabelas = previa.linhas.filter(l => l.restaura).map(l => l.t)
      const r = ok(await supabase.rpc('restaurar_backup', { p_backup: previa.backup, p_tabelas: tabelas })) as Record<string, number>
      avisar(`Backup restaurado: ${Object.values(r).reduce((a, b) => a + b, 0)} registros. A página vai recarregar.`)
      setTimeout(() => window.location.reload(), 2500)
    } catch (e) {
      const m = (e as Error).message
      avisar(/restaurar_backup/.test(m) && /function|não existe|not find/i.test(m) ? 'Falta rodar o script 016 no Supabase.' : `Nada foi alterado. ${m}`, 'erro')
      setEtapa('')
    }
  }

  const quando = previa ? new Date(previa.exportado) : null
  return (
    <div className="grid gap-3">
      <label className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600 hover:border-red-400 hover:bg-red-50/40">
        <Icone nome="baixar" className="h-5 w-5 rotate-180 text-red-600" />
        <span><b className="text-slate-800">Escolher o arquivo de backup</b> (.json do botão acima ou .zip do backup automático do Google Drive)</span>
        <input type="file" accept=".json,.zip,application/json,application/zip" className="hidden" onChange={e => { escolher(e.target.files?.[0]); e.target.value = '' }} />
      </label>
      {etapa && <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">{etapa}</p>}
      {previa && quando && <>
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">
          <b>Backup de {quando.toLocaleDateString('pt-BR')} às {quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</b>
          {previa.origem && ` (${previa.origem === 'automatico' ? 'automático do Google Drive' : 'baixado pelo botão'})`} · arquivo {previa.arquivo}.<br />
          Tudo o que foi lançado, alterado ou baixado <b>depois</b> dessa data nas tabelas abaixo marcadas com “Substitui” será <b>perdido</b>.
          Antes de restaurar, o Siscon baixa automaticamente um backup do estado atual para você poder desfazer.
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="tabela">
            <thead><tr><th>Tabela</th><th className="text-right">No backup</th><th className="text-right">Hoje no Siscon</th><th>O que acontece</th></tr></thead>
            <tbody>{previa.linhas.map(l => <tr key={l.t}>
              <td>{NOMES[l.t] || l.t}</td>
              <td className="num text-right">{l.qtdBackup ?? '—'}</td>
              <td className={`num text-right ${l.restaura && l.qtdAtual != null && l.qtdBackup != null && l.qtdAtual > l.qtdBackup ? 'font-semibold text-red-600' : ''}`}>{l.qtdAtual ?? '—'}</td>
              <td className={l.restaura ? 'text-red-700' : 'text-slate-500'}>{l.motivo}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <input className="campo w-56" placeholder="Digite RESTAURAR" value={texto} onChange={e => setTexto(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }} />
          <Botao type="button" variante="secundario" onClick={() => { setPrevia(null); setTexto('') }} disabled={!!etapa}>Cancelar</Botao>
          <button type="button" onClick={restaurar} disabled={!!etapa || texto.trim().toUpperCase() !== 'RESTAURAR'}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40">Restaurar este backup</button>
        </div>
      </>}
    </div>
  )
}
