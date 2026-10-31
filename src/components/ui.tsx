import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { Icone, type NomeIcone } from './icones'

export function Botao({ variante = 'primario', className = '', ...p }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variante?: 'primario' | 'secundario' | 'perigo' | 'link' }) {
  const v = {
    primario: 'h-10 bg-marca-700 text-white shadow-sm shadow-marca-900/20 hover:bg-marca-800 active:bg-marca-900 disabled:bg-slate-300 disabled:shadow-none',
    secundario: 'h-10 bg-white border border-slate-300 text-slate-700 shadow-sm hover:bg-slate-50 hover:border-slate-400 disabled:text-slate-400',
    perigo: 'h-10 bg-red-600 text-white shadow-sm hover:bg-red-700 disabled:bg-slate-300',
    link: 'text-marca-700 hover:text-marca-900 hover:underline underline-offset-2 !px-0 !py-0',
  }[variante]
  return <button {...p} className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-marca-100 disabled:cursor-not-allowed ${v} ${className}`} />
}

export function Cartao({ titulo, acoes, children, className = '' }: { titulo?: ReactNode; acoes?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`cartao overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,.04),0_1px_3px_rgba(16,24,40,.06)] ${className}`}>
      {(titulo || acoes) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-slate-800">{titulo}</h2>
          <div className="flex flex-wrap items-center gap-2">{acoes}</div>
        </header>
      )}
      <div>{children}</div>
    </section>
  )
}

export function Cabecalho({ titulo, subtitulo, acoes }: { titulo: string; subtitulo?: ReactNode; acoes?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{titulo}</h1>
        {subtitulo && <p className="mt-1 text-sm text-slate-500">{subtitulo}</p>}
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
  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cores[texto] || 'bg-slate-100 text-slate-600 ring-slate-200'}`}><i className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />{texto}</span>

export function Modal({ titulo, aberto, fechar, children, largura = 'max-w-lg' }:
  { titulo: string; aberto: boolean; fechar: () => void; children: ReactNode; largura?: string }) {
  if (!aberto) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-[8vh] backdrop-blur-[2px]" onMouseDown={fechar}>
      <div className={`w-full ${largura} rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5`} onMouseDown={e => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-base font-semibold text-slate-900">{titulo}</h3>
          <button onClick={fechar} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Fechar"><Icone nome="fechar" /></button>
        </header>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

export function Campo({ rotulo, children, className = '' }: { rotulo: string; children: ReactNode; className?: string }) {
  return <label className={`block ${className}`}><span className="rotulo">{rotulo}</span>{children}</label>
}

export const Vazio = ({ texto = 'Nenhum registro encontrado.' }: { texto?: string }) =>
  <div className="flex flex-col items-center gap-2 px-4 py-14 text-center text-sm text-slate-400">
    <span className="rounded-full bg-slate-100 p-3"><Icone nome="busca" className="h-5 w-5" /></span>{texto}
  </div>

export const Carregando = () =>
  <div className="space-y-3 p-5" aria-label="Carregando">
    {[0, 1, 2, 3].map(i => <div key={i} className="h-4 animate-pulse rounded bg-slate-100" style={{ width: `${90 - i * 12}%` }} />)}
  </div>

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
          <div key={a.id} className={`flex max-w-sm items-start gap-2 rounded-xl px-4 py-3 text-sm text-white shadow-xl ${a.tipo === 'erro' ? 'bg-red-600' : 'bg-marca-800'}`}><Icone nome={a.tipo === 'erro' ? 'alerta' : 'ok'} className="mt-0.5 h-4 w-4 shrink-0" />{a.texto}</div>
        ))}
      </div>
    </AvisoCtx.Provider>
  )
}

const tons = {
  neutro: { valor: 'text-slate-900', icone: 'bg-marca-50 text-marca-700', barra: 'bg-marca-700' },
  ok: { valor: 'text-emerald-700', icone: 'bg-emerald-50 text-emerald-600', barra: 'bg-emerald-500' },
  alerta: { valor: 'text-amber-700', icone: 'bg-amber-50 text-amber-600', barra: 'bg-amber-500' },
  perigo: { valor: 'text-red-700', icone: 'bg-red-50 text-red-600', barra: 'bg-red-500' },
}

export function Indicador({ rotulo, valor, detalhe, tom = 'neutro', icone }:
  { rotulo: string; valor: ReactNode; detalhe?: ReactNode; tom?: keyof typeof tons; icone?: NomeIcone }) {
  const t = tons[tom]
  return (
    <div className="cartao relative overflow-hidden rounded-xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04),0_1px_3px_rgba(16,24,40,.06)]">
      <span className={`absolute inset-y-0 left-0 w-1 ${t.barra}`} />
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{rotulo}</p>
        {icone && <span className={`rounded-lg p-2 ${t.icone}`}><Icone nome={icone} className="h-4 w-4" /></span>}
      </div>
      <p className={`num mt-2 text-[26px] font-semibold leading-tight tracking-tight ${t.valor}`}>{valor}</p>
      {detalhe && <p className="mt-1.5 text-xs text-slate-500">{detalhe}</p>}
    </div>
  )
}

/** Abas em formato de segmentos */
export function Abas<T extends string>({ abas, atual, mudar }: { abas: readonly (readonly [T, string])[]; atual: T; mudar: (a: T) => void }) {
  return (
    <div className="mb-5 inline-flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm print:hidden">
      {abas.map(([k, n]) => (
        <button key={k} onClick={() => mudar(k)}
          className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${atual === k ? 'bg-marca-700 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>{n}</button>
      ))}
    </div>
  )
}
