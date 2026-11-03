import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/app'
import { Icone, type NomeIcone } from './icones'

const secoes: { titulo: string; itens: [string, string, NomeIcone][] }[] = [
  { titulo: 'Visão geral', itens: [['/', 'Painel', 'painel']] },
  { titulo: 'Operação', itens: [
    ['/clientes', 'Clientes', 'clientes'],
    ['/honorarios', 'Honorários', 'honorarios'],
    ['/despesas', 'Despesas Extras', 'despesas'],
    ['/recebimentos', 'Receber', 'receber'],
    ['/recibos', 'Baixas e Recibos', 'recibos'],
  ] },
  { titulo: 'Gestão', itens: [
    ['/relatorios', 'Relatórios', 'relatorios'],
    ['/asaas', 'Conferência Asaas', 'receber'],
    ['/configuracoes', 'Configurações', 'config'],
  ] },
]

const Chip = ({ rotulo, valor }: { rotulo: string; valor: string }) => (
  <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500 shadow-sm">
    {rotulo} <b className="font-semibold text-slate-800">{valor}</b>
  </span>
)

export default function Layout() {
  const { sessao, config } = useApp()
  const [aberto, setAberto] = useState(false)
  const email = sessao?.user.email || ''
  const sm = Number(config.salario_minimo).toLocaleString('pt-BR', { minimumFractionDigits: 2 })

  return (
    <div className="min-h-screen lg:flex">
      {aberto && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setAberto(false)} />}
      <aside className={`print:hidden fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-gradient-to-b from-[#16244a] to-[#1b2d57] text-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${aberto ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="px-6 pb-5 pt-6">
          <span className="block rounded-lg bg-white px-3 py-2"><img src="/logo.png" alt="Orgacon Consultoria Contábil" className="w-40" /></span>
          <p className="mt-3 inline-block rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-semibold tracking-[.18em] text-white/80">SISCON · HONORÁRIOS</p>
        </div>
        <nav className="flex-1 overflow-y-auto px-3">
          {secoes.map(s => (
            <div key={s.titulo} className="mb-5">
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[.14em] text-white/40">{s.titulo}</p>
              {s.itens.map(([to, nome, icone]) => (
                <NavLink key={to} to={to} end={to === '/'} onClick={() => setAberto(false)}
                  className={({ isActive }) => `group mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${isActive
                    ? 'bg-blue-600 font-medium text-white shadow-sm shadow-black/20'
                    : 'text-white/75 hover:bg-white/10 hover:text-white'}`}>
                  {({ isActive }) => <><Icone nome={icone} className={`h-[18px] w-[18px] ${isActive ? 'text-white' : 'text-white/60 group-hover:text-white'}`} />{nome}</>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="flex items-center gap-3 border-t border-white/10 px-4 py-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-semibold uppercase text-white">{email[0] || '?'}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-white/90">{email}</p>
            <p className="text-[11px] text-white/50">Orgacon © {new Date().getFullYear()}</p>
          </div>
          <button onClick={() => supabase.auth.signOut()} title="Sair" className="rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-red-300">
            <Icone nome="sair" />
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200/80 bg-white/85 px-4 py-3 backdrop-blur print:hidden lg:px-8">
          <button onClick={() => setAberto(true)} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Abrir menu"><Icone nome="menu" className="h-5 w-5" /></button>
          <img src="/logo.png" alt="Orgacon" className="h-7 lg:hidden" />
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-marca-700 px-3 py-1 text-xs text-marca-100 shadow-sm">
              <Icone nome="calendario" className="h-3.5 w-3.5" /> Competência <b className="font-semibold text-white">{config.competencia_atual || '—'}</b>
            </span>
            <span className="hidden sm:inline-flex"><Chip rotulo="Salário mínimo" valor={`R$ ${sm}`} /></span>
            <span className="hidden md:inline-flex"><Chip rotulo="Juros" valor="1,55% a.m." /></span>
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] p-4 md:p-6 lg:p-8"><Outlet /></main>
      </div>
    </div>
  )
}
