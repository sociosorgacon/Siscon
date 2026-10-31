import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type Config = { competencia_atual: string; salario_minimo: string; taxa_juros: string; vigencia_salario: string
  escritorio_nome: string; escritorio_cnpj: string; escritorio_endereco: string; escritorio_cidade: string; escritorio_telefone: string; pix_chave: string }
type Ctx = { sessao: Session | null; config: Config; recarregarConfig: () => Promise<void> }

const vazio: Config = { competencia_atual: '', salario_minimo: '0', taxa_juros: '1.55', vigencia_salario: '',
  escritorio_nome: 'Orgacon Contabilidade', escritorio_cnpj: '', escritorio_endereco: '', escritorio_cidade: 'Iúna/ES', escritorio_telefone: '', pix_chave: '' }
const AppCtx = createContext<Ctx>({ sessao: null, config: vazio, recarregarConfig: async () => {} })
export const useApp = () => useContext(AppCtx)

export function AppProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Session | null | undefined>(undefined)
  const [config, setConfig] = useState<Config>(vazio)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessao(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSessao(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const recarregarConfig = useCallback(async () => {
    const { data } = await supabase.from('configuracoes').select('chave, valor')
    if (data) setConfig({ ...vazio, ...Object.fromEntries(data.map(c => [c.chave, c.valor])) })
  }, [])

  useEffect(() => { if (sessao) recarregarConfig() }, [sessao, recarregarConfig])

  if (sessao === undefined) return null
  return <AppCtx.Provider value={{ sessao, config, recarregarConfig }}>{children}</AppCtx.Provider>
}

/** Carrega dados com estado de carregamento e função para recarregar */
export function useDados<T>(carregar: () => Promise<T>, deps: unknown[] = []) {
  const [dados, setDados] = useState<T | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const recarregar = useCallback(async () => {
    try { setErro(null); setDados(await carregar()) } catch (e) { setErro((e as Error).message) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { recarregar() }, [recarregar])
  return { dados, erro, recarregar }
}

export const escritorioDe = (c: Config) => ({
  nome: c.escritorio_nome, cnpj: c.escritorio_cnpj, endereco: c.escritorio_endereco, cidade: c.escritorio_cidade, telefone: c.escritorio_telefone,
})

/** Dados do Pix: chave configurada (padrão = CNPJ do escritório), favorecido e cidade */
export const pixDe = (c: Config) => ({
  chave: c.pix_chave || c.escritorio_cnpj, nome: c.escritorio_nome, cidade: (c.escritorio_cidade || 'Iuna').split('/')[0],
})
