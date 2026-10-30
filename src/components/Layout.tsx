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
  ['/recibos', 'Recibos'],
  ['/relatorios', 'Relatórios'],
  ['/configuracoes', 'Configurações'],
] as const

export default function Layout() {
  const { sessao, config } = useApp()
  const [aberto, setAberto] = useState(false)
  return (
    <div className="min-h-screen md:flex">
      <aside className={`${aberto ? 'block' : 'hidden'} md:block md:w-56 md:shrink-0 bg-marca-900 text-marca-100 md:min-h-screen`}>
        <div className="hidden md:block px-5 py-5">
          <p className="text-lg font-bold text-white">Siscon</p>
          <p className="text-xs text-marca-100/70">Honorários · Orgacon</p>
        </div>
        <nav className="px-3 pb-4 md:pb-0">
          {menu.map(([to, nome]) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={() => setAberto(false)}
              className={({ isActive }) => `block rounded-md px-3 py-2 text-sm ${isActive ? 'bg-white/10 text-white font-medium' : 'hover:bg-white/5'}`}>
              {nome}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 text-xs text-marca-100/70 md:absolute md:bottom-0 md:w-56">
          <p className="truncate">{sessao?.user.email}</p>
          <button className="mt-1 underline hover:text-white" onClick={() => supabase.auth.signOut()}>Sair</button>
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between bg-marca-900 px-4 py-3 text-white md:hidden">
          <span className="font-bold">Siscon</span>
          <button onClick={() => setAberto(a => !a)} className="text-sm">{aberto ? 'Fechar' : 'Menu'}</button>
        </div>
        <div className="border-b border-slate-200 bg-white px-6 py-2 text-xs text-slate-500">
          Competência atual: <b className="text-slate-700">{config.competencia_atual || '—'}</b>
          <span className="mx-2">·</span>Salário mínimo: <b className="text-slate-700">R$ {Number(config.salario_minimo).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</b>
          <span className="mx-2">·</span>Juros: <b className="text-slate-700">{String(config.taxa_juros).replace('.', ',')}% a.m.</b>
        </div>
        <main className="mx-auto max-w-7xl p-4 md:p-6"><Outlet /></main>
      </div>
    </div>
  )
}
