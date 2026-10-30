import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

export function Botao({ variante = 'primario', className = '', ...p }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variante?: 'primario' | 'secundario' | 'perigo' | 'link' }) {
  const v = {
    primario: 'bg-marca-700 text-white hover:bg-marca-800 disabled:bg-slate-300',
    secundario: 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:text-slate-400',
    perigo: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-slate-300',
    link: 'text-marca-700 hover:underline px-0 py-0',
  }[variante]
  return <button {...p} className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${v} ${className}`} />
}

export function Cartao({ titulo, acoes, children, className = '' }: { titulo?: ReactNode; acoes?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white ${className}`}>
      {(titulo || acoes) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <h2 className="font-semibold text-slate-700">{titulo}</h2>
          <div className="flex gap-2">{acoes}</div>
        </header>
      )}
      <div>{children}</div>
    </section>
  )
}

export function Cabecalho({ titulo, subtitulo, acoes }: { titulo: string; subtitulo?: ReactNode; acoes?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">{titulo}</h1>
        {subtitulo && <p className="text-sm text-slate-500">{subtitulo}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{acoes}</div>
    </div>
  )
}

const cores: Record<string, string> = {
  Pago: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  'Pago Parcial': 'bg-amber-50 text-amber-700 ring-amber-200',
  Pendente: 'bg-sky-50 text-sky-700 ring-sky-200',
  Atrasado: 'bg-red-50 text-red-700 ring-red-200',
  Ativo: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Inativo: 'bg-slate-100 text-slate-600 ring-slate-200',
  Cancelado: 'bg-slate-100 text-slate-500 ring-slate-200 line-through',
}
export const Selo = ({ texto }: { texto: string }) =>
  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cores[texto] || 'bg-slate-100 text-slate-600 ring-slate-200'}`}>{texto}</span>

export function Modal({ titulo, aberto, fechar, children, largura = 'max-w-lg' }:
  { titulo: string; aberto: boolean; fechar: () => void; children: ReactNode; largura?: string }) {
  if (!aberto) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16" onMouseDown={fechar}>
      <div className={`w-full ${largura} rounded-lg bg-white shadow-xl`} onMouseDown={e => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="font-semibold">{titulo}</h3>
          <button onClick={fechar} className="text-xl leading-none text-slate-400 hover:text-slate-600" aria-label="Fechar">×</button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export function Campo({ rotulo, children, className = '' }: { rotulo: string; children: ReactNode; className?: string }) {
  return <label className={className}><span className="rotulo">{rotulo}</span>{children}</label>
}

export const Vazio = ({ texto = 'Nenhum registro encontrado.' }: { texto?: string }) =>
  <p className="px-4 py-10 text-center text-sm text-slate-400">{texto}</p>

export const Carregando = () => <p className="px-4 py-10 text-center text-sm text-slate-400">Carregando…</p>

// ---------- Avisos (toast) ----------
type Aviso = { id: number; texto: string; tipo: 'ok' | 'erro' }
const AvisoCtx = createContext<(texto: string, tipo?: 'ok' | 'erro') => void>(() => {})
export const useAviso = () => useContext(AvisoCtx)

export function AvisoProvider({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Aviso[]>([])
  const avisar = useCallback((texto: string, tipo: 'ok' | 'erro' = 'ok') => {
    const id = Date.now() + Math.random()
    setLista(l => [...l, { id, texto, tipo }])
    setTimeout(() => setLista(l => l.filter(a => a.id !== id)), tipo === 'erro' ? 7000 : 3500)
  }, [])
  return (
    <AvisoCtx.Provider value={avisar}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {lista.map(a => (
          <div key={a.id} className={`max-w-sm rounded-md px-4 py-3 text-sm text-white shadow-lg ${a.tipo === 'erro' ? 'bg-red-600' : 'bg-marca-800'}`}>{a.texto}</div>
        ))}
      </div>
    </AvisoCtx.Provider>
  )
}

export function Indicador({ rotulo, valor, detalhe, tom = 'neutro' }:
  { rotulo: string; valor: ReactNode; detalhe?: ReactNode; tom?: 'neutro' | 'ok' | 'alerta' | 'perigo' }) {
  const t = { neutro: 'text-slate-800', ok: 'text-emerald-700', alerta: 'text-amber-700', perigo: 'text-red-700' }[tom]
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{rotulo}</p>
      <p className={`num mt-1 text-2xl font-semibold ${t}`}>{valor}</p>
      {detalhe && <p className="mt-1 text-xs text-slate-500">{detalhe}</p>}
    </div>
  )
}
