import { supabase, todos } from './supabase'
import { hojeIso } from './format'

/** Baixa um JSON com todas as tabelas do Siscon (contém dados de clientes: guardar em local seguro) */
export async function baixarBackup() {
  const tabelas = ['configuracoes', 'clientes', 'honorarios', 'despesas', 'recibos', 'recibo_itens', 'despesas_fixas', 'asaas_eventos'] as const
  const dados: Record<string, unknown> = { exportado_em: new Date().toISOString() }
  for (const t of tabelas) {
    try { dados[t] = await todos((a, b) => supabase.from(t).select('*').range(a, b)) }
    catch (e) { if (t === 'asaas_eventos' || t === 'despesas_fixas') dados[t] = []; else throw e }
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(dados)], { type: 'application/json' }))
  Object.assign(document.createElement('a'), { href: url, download: `siscon_backup_${hojeIso()}.json` }).click()
  URL.revokeObjectURL(url)
}
