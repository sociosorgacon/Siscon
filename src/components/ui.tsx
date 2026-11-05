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

export function Cabecalho({ titulo, subtitulo, acoes, icone, logo }: { titulo: string; subtitulo?: ReactNode; acoes?: ReactNode; icone?: NomeIcone; logo?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-center gap-3">
        {logo && <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-slate-200">{logo}</span>}
        {icone && !logo && <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#1c3260] to-[#2563eb] text-white shadow-sm shadow-blue-900/20"><Icone nome={icone} className="h-5 w-5" /></span>}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{titulo}</h1>
          {subtitulo && <p className="mt-0.5 text-sm text-slate-500">{subtitulo}</p>}
        </div>
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

/** Linha de mini-indicadores no topo das páginas de cadastro */
const tonsResumo = {
  azul: 'border-l-blue-600', verde: 'border-l-emerald-500', vermelho: 'border-l-red-500', laranja: 'border-l-amber-500', cinza: 'border-l-slate-400',
}
export function Resumo({ itens }: { itens: { rotulo: string; valor: ReactNode; detalhe?: ReactNode; tom?: keyof typeof tonsResumo }[] }) {
  return (
    <div className={`mb-5 grid grid-cols-2 gap-3 ${itens.length >= 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
      {itens.map(i => (
        <div key={i.rotulo} className={`rounded-xl border border-slate-200/80 border-l-4 ${tonsResumo[i.tom || 'azul']} bg-white px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,.04)]`}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{i.rotulo}</p>
          <p className="num mt-1 text-xl font-semibold tracking-tight text-slate-900">{i.valor}</p>
          {i.detalhe && <p className="mt-0.5 text-xs text-slate-500">{i.detalhe}</p>}
        </div>))}
    </div>
  )
}

/** Campo de busca com ícone de lupa */
export function Busca({ valor, mudar, placeholder = 'Buscar', className = 'max-w-sm' }: { valor: string; mudar: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={`relative w-full ${className}`}>
      <Icone nome="busca" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input className="campo !pl-9" placeholder={placeholder} value={valor} onChange={e => mudar(e.target.value)} />
    </div>
  )
}

/** Botões de filtro em formato de pílula */
export function Pilulas<T extends string>({ opcoes, atual, mudar }: { opcoes: readonly (readonly [T, string, number?])[]; atual: T; mudar: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
      {opcoes.map(([v, t, n]) => (
        <button key={v} type="button" onClick={() => mudar(v)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${atual === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
          {t}{n != null && <span className={`ml-1.5 rounded-full px-1.5 text-[10px] ${atual === v ? 'bg-blue-50 text-blue-700' : 'bg-slate-200 text-slate-500'}`}>{n}</span>}
        </button>))}
    </div>
  )
}

/** Iniciais do cliente num círculo (cor fixa por nome) */
const coresAvatar = ['bg-blue-100 text-blue-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-800', 'bg-violet-100 text-violet-700', 'bg-rose-100 text-rose-700', 'bg-cyan-100 text-cyan-700', 'bg-teal-100 text-teal-700', 'bg-orange-100 text-orange-700']
export function Avatar({ nome }: { nome: string }) {
  // Iniciais da razão social: primeira letra das duas primeiras palavras, inclusive abreviações ("A. C. de Oliveira" → AC, "R & L Elétrica" → RL)
  const p = (nome || '?').replace(/[^A-Za-zÀ-ú ]/g, ' ').split(/\s+/).filter(w => w && !/^(de|da|do|dos|das|e|ltda|me|eireli|cia|s|a)$/i.test(w) || /^[A-Z]$/.test(w))
  const ini = ((p[0]?.[0] || nome[0] || '?') + (p[1]?.[0] || '')).toUpperCase()
  let h = 0; for (const ch of nome) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${coresAvatar[h % coresAvatar.length]}`}>{ini}</span>
}

/** Logo do Asaas (asas) — só ao lado do nome "Asaas". Em fundo escuro, vai num quadrinho branco. */
export function LogoAsaas({ className = 'h-4 w-4', fundo = false }: { className?: string; fundo?: boolean }) {
  const img = <img src="/asaas.png" alt="" aria-hidden="true" className={`${className} shrink-0 object-contain`} />
  return fundo ? <span className="inline-flex shrink-0 items-center justify-center rounded bg-white p-0.5">{img}</span> : img
}

/** Etiqueta do grupo do cliente no Asaas (lido do Asaas; o Siscon não edita) */
const coresGrupo: Record<string, string> = { Impressos: 'bg-blue-50 text-blue-700 ring-blue-200', 'Acessórias': 'bg-amber-50 text-amber-800 ring-amber-200', WhatsApp: 'bg-green-50 text-green-700 ring-green-200' }
const iconeGrupo: Record<string, string> = { 'Acessórias': '/acessorias.png', WhatsApp: '/whatsapp.png' }
export function GrupoAsaas({ grupo }: { grupo?: string | null }) {
  if (!grupo) return null
  return <span title="Grupo do cliente no Asaas" className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium ring-1 ring-inset ${coresGrupo[grupo] || 'bg-slate-100 text-slate-600 ring-slate-200'}`}>
    {grupo === 'Impressos' ? <Icone nome="impressora" className="h-3 w-3" /> : <img src={iconeGrupo[grupo] || '/asaas.png'} alt="" className="h-3 w-3 object-contain" />}{grupo}</span>
}

/** Filtro lateral de clientes (o mesmo de Relatórios): "Todos" ou marcar um ou mais; com busca. sel = null → todos */
export function FiltroClientes({ clientes, sel, mudar }: { clientes: { id: string; nome: string }[]; sel: Set<string> | null; mudar: (s: Set<string> | null) => void }) {
  const [busca, setBusca] = useState('')
  const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const lista = clientes.filter(c => !busca || norm(c.nome).includes(norm(busca)))
  const alternar = (id: string) => { const n = new Set(sel ?? []); if (n.has(id)) n.delete(id); else n.add(id); mudar(n.size ? n : null) }
  return (
    <aside className="h-fit rounded-xl border border-slate-200 bg-white shadow-sm print:hidden lg:sticky lg:top-20">
      <p className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700"><Icone nome="clientes" className="h-4 w-4 text-slate-400" />Clientes
        <span className="ml-auto text-xs text-slate-400">{sel ? `${sel.size} de ${clientes.length}` : clientes.length}</span></p>
      <div className="p-2">
        <input className="campo !h-8 mb-2 text-xs" placeholder="Buscar cliente" value={busca} onChange={e => setBusca(e.target.value)} />
        <button onClick={() => mudar(null)} className={`mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${!sel ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}>
          <input type="checkbox" readOnly checked={!sel} /> Todos os clientes</button>
        <ul className="max-h-[60vh] overflow-y-auto">
          {lista.map(c => <li key={c.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50" title={c.nome}>
              <input type="checkbox" checked={!!sel?.has(c.id)} onChange={() => alternar(c.id)} />
              <span className="truncate">{c.nome}</span></label></li>)}
        </ul>
      </div>
    </aside>
  )
}
/** Clientes distintos de uma lista (id + nome), em ordem alfabética */
export function clientesDe<T>(itens: T[] | null | undefined, id: (x: T) => string | null | undefined, nome: (x: T) => string) {
  const m = new Map<string, string>()
  for (const x of itens || []) { const i = id(x); if (i && !m.has(i)) m.set(i, nome(x)) }
  return [...m].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}
