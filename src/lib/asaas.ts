import { FunctionRegion } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type AssinaturaAsaas = { id: string; cliente_asaas: string; nome: string; cpfCnpj: string; valor: number; proximo_vencimento: string; descricao: string; forma: string; ciclo: string }
export type CobrancaAsaas = { id: string; assinatura: string | null; cliente_asaas: string; nome: string; cpfCnpj: string; valor: number; vencimento: string; status: string; descricao: string; link: string | null }

/** Chama a Edge Function "asaas" (a chave da API fica só no Supabase) */
export async function chamarAsaas<T>(acao: 'saldo' | 'conferencia'): Promise<T> {
  // Força a execução em São Paulo: o Asaas pode recusar chamadas vindas de servidores fora do Brasil
  const { data, error } = await supabase.functions.invoke('asaas', { body: { acao }, region: FunctionRegion.SaEast1 })
  if (error) {
    const ctx = (error as { context?: Response }).context
    const corpo = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null
    throw new Error(corpo?.erro || (/Failed to send|not found|404/i.test(error.message)
      ? 'Integração com o Asaas ainda não instalada no Supabase.' : error.message))
  }
  if (data?.erro) throw new Error(data.erro)
  return data as T
}
