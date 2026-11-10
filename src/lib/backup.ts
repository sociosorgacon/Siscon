import { supabase, todos } from './supabase'
import { hojeIso } from './format'

/** Todas as tabelas do Siscon (manter igual à lista da função de backup automático: supabase/functions/backup) */
export const TABELAS_BACKUP = ['configuracoes', 'salarios_minimos', 'clientes', 'honorarios', 'despesas', 'despesas_fixas',
  'recibos', 'recibo_itens', 'asaas_eventos', 'asaas_cobrancas', 'certificados_cobrados'] as const

/** Baixa um JSON com todas as tabelas do Siscon (contém dados de clientes: guardar em local seguro) */
export async function baixarBackup() {
  const dados: Record<string, unknown> = { exportado_em: new Date().toISOString(), origem: 'manual' }
  const faltando: string[] = []
  for (const t of TABELAS_BACKUP) {
    try { dados[t] = await todos((a, b) => supabase.from(t).select('*').range(a, b)) }
    catch { dados[t] = []; faltando.push(t) }   // tabela ainda não criada no banco: segue sem ela
  }
  if (faltando.length) dados.tabelas_com_erro = faltando
  const url = URL.createObjectURL(new Blob([JSON.stringify(dados)], { type: 'application/json' }))
  Object.assign(document.createElement('a'), { href: url, download: `siscon_backup_${hojeIso()}.json` }).click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
  return faltando
}
