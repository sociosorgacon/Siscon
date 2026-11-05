import { createClient } from '@supabase/supabase-js'

// URL e chave publishable são públicas por natureza (vão no navegador).
// A proteção dos dados é o login + Row Level Security no banco.
const url = import.meta.env.VITE_SUPABASE_URL || 'https://glffjwcikoyggdfuzgyw.supabase.co'
const key = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_by16o5rDYG9DU5fPD8da5g_sfPBh7s_'

export const supabase = createClient(url, key)

/** Lança erro legível se a resposta do Supabase falhar. */
export function ok<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(traduzErro(res.error.message))
  return res.data as T
}

export function traduzErro(msg: string) {
  if (/Invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.'
  if (/duplicate key.*cliente_id.*competencia/i.test(msg)) return 'Já existe honorário desta competência para o cliente.'
  if (/violates foreign key/i.test(msg)) return 'Este registro está em uso e não pode ser excluído.'
  return msg
}

export type Cliente = {
  id: string; cnpj: string; razao_social: string; nome_fantasia: string | null; email: string | null
  telefone: string | null; logradouro: string | null; municipio: string | null; uf: string | null
  situacao: string | null; status: 'Ativo' | 'Inativo'; percentual_honorario: number; dia_vencimento: number
  multa_por_atraso: boolean; gera_fechamento?: boolean; boleto_cliente_id?: string | null; asaas_grupo?: string | null; asaas_customer_id: string | null; asaas_nome?: string | null
}

export type Honorario = {
  id: string; cliente_id: string; cliente_nome: string; cliente_cnpj: string; competencia: string; vencimento: string
  valor_original: number; juros: number; juros_calc: number; valor_atualizado_calc: number; desconto: number
  valor_pago_acumulado: number; saldo: number; status: string; situacao: string; meses_atraso: number
  calcular_juros: boolean; data_pagamento: string | null; metodo_pagamento: string | null; observacao: string | null
  em_atraso: boolean; cliente_telefone: string | null; multa_por_atraso: boolean
}

export type Despesa = {
  id: string; cliente_id: string; cliente_nome: string; cliente_cnpj: string; descricao: string; valor: number
  data: string; competencia: string; status: string; valor_pago: number; saldo: number
  data_pagamento: string | null; metodo_pagamento: string | null; observacoes: string | null
  em_atraso: boolean; cliente_telefone: string | null
}

export type ReciboItem = { tipo: string; descricao: string; valor: number; desconto: number; competencia: string | null; cliente_nome?: string | null }
export type Recibo = {
  id: string; numero: number | null; cliente_id: string | null; cliente_nome: string; cliente_cnpj: string | null
  valor: number; data_pagamento: string; metodo_pagamento: string | null; observacao: string | null
  com_recibo: boolean; cancelado: boolean; motivo_cancelamento: string | null; criado_por: string | null; recibo_itens?: ReciboItem[]
}

/** Busca todas as linhas, paginando de 1000 em 1000 (limite padrão do Supabase). */
export async function todos<T>(montar: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const saida: T[] = []
  for (let de = 0; ; de += 1000) {
    const lote = ok(await montar(de, de + 999))
    saida.push(...lote)
    if (lote.length < 1000) return saida
  }
}
