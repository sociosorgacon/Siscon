import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/app'

const menu = [
  ['/', 'Painel'],
  ['/clientes', 'Clientes'],
  ['/honorarios', 'Honorários'],
  ['/recebimentos', 'Receber'],
  ['/despesas', 'Despesas Extras'],
  ['/recibos', 'Baixas e Recibos'],
  ['/relatorios', 'Relatórios'],
  ['/configuracoes', 'Configurações'],
] as const

export default function Layout() {
  const { sessao, config } = useApp()
  const [aberto, setAberto] = useState(false)
  return (
    <div className="min-h-screen md:flex">
      <aside className={`print:hidden ${aberto ? 'block' : 'hidden'} md:block md:w-56 md:shrink-0 border-r border-slate-200 bg-white text-slate-600 md:min-h-screen md:relative`}>
        <div className="hidden md:block px-5 pt-6 pb-5">
          <img src="/logo.png" alt="Orgacon Consultoria Contábil" className="w-40" />
          <p className="mt-2 text-xs font-medium tracking-wide text-cinza">SISCON · HONORÁRIOS</p>
        </div>
        <nav className="px-3 pb-4 md:pb-0">
          {menu.map(([to, nome]) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={() => setAberto(false)}
              className={({ isActive }) => `block rounded-md px-3 py-2 text-sm ${isActive ? 'bg-marca-700 text-white font-medium' : 'hover:bg-marca-50 hover:text-marca-800'}`}>
              {nome}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-100 px-5 py-4 text-xs text-slate-500 md:absolute md:bottom-0 md:w-56">
          <p className="truncate">{sessao?.user.email}</p>
          <button className="mt-1 underline hover:text-marca-700" onClick={() => supabase.auth.signOut()}>Sair</button>
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden print:hidden">
          <img src="/logo.png" alt="Orgacon" className="h-8" />
          <button onClick={() => setAberto(a => !a)} className="text-sm font-medium text-marca-700">{aberto ? 'Fechar' : 'Menu'}</button>
        </div>
        <div className="bg-marca-700 px-6 py-2 text-xs text-marca-100 print:hidden">
          Competência atual: <b className="text-white">{config.competencia_atual || '—'}</b>
          <span className="mx-2">·</span>Salário mínimo: <b className="text-white">R$ {Number(config.salario_minimo).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</b>
          <span className="mx-2">·</span>Juros: <b className="text-white">1,55% a.m.</b>
        </div>
        <main className="mx-auto max-w-7xl p-4 md:p-6"><Outlet /></main>
      </div>
    </div>
  )
}
