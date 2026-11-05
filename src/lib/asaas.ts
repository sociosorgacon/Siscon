import { supabase } from './supabase'

export type AssinaturaAsaas = { id: string; cliente_asaas: string; nome: string; cpfCnpj: string; valor: number; proximo_vencimento: string; descricao: string; forma: string; ciclo: string }
export type CobrancaAsaas = { id: string; assinatura: string | null; cliente_asaas: string; nome: string; cpfCnpj: string; valor: number; vencimento: string; status: string; descricao: string; link: string | null }

/** Chama a Edge Function "asaas" (a chave da API fica só no Supabase) */
export async function chamarAsaas<T>(acao: 'saldo' | 'conferencia' | 'ajustes' | 'aplicar_boletos' | 'aplicar_assinaturas', extra: Record<string, unknown> = {}): Promise<T> {
  // Força a execução em São Paulo (o Asaas pode recusar chamadas de fora do Brasil). Vai só na URL:
  // a opção `region` do supabase-js manda o cabeçalho x-region, que o CORS da função não aceita.
  const { data, error } = await supabase.functions.invoke('asaas?forceFunctionRegion=sa-east-1', { body: { acao, ...extra } })
  if (error) {
    const ctx = (error as { context?: Response }).context
    const corpo = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null
    if (corpo?.erro) throw new Error(corpo.erro)
    if (ctx?.status === 404) throw new Error('Integração com o Asaas ainda não instalada no Supabase (função "asaas" não encontrada).')
    throw new Error(`Falha ao chamar a função do Asaas: ${error.message}`)
  }
  if (data?.erro) throw new Error(data.erro)
  return data as T
}
