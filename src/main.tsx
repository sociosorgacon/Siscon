import { StrictMode, lazy, Suspense, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import { AppProvider, useApp } from './lib/app'
import { AvisoProvider, Carregando } from './components/ui'
import Layout from './components/Layout'
import Login, { DefinirSenha } from './pages/Login'

const Painel = lazy(() => import('./pages/Painel'))
const Clientes = lazy(() => import('./pages/Clientes'))
const Honorarios = lazy(() => import('./pages/Honorarios'))
const Recebimentos = lazy(() => import('./pages/Recebimentos'))
const Despesas = lazy(() => import('./pages/Despesas'))
const Recibos = lazy(() => import('./pages/Recibos'))
const Relatorios = lazy(() => import('./pages/Relatorios'))
const Asaas = lazy(() => import('./pages/Asaas'))
const Configuracoes = lazy(() => import('./pages/Configuracoes'))

// Link de convite ou de "esqueci minha senha" chega com type=invite/recovery na URL
const veioDeLink = /type=(invite|recovery)/.test(window.location.hash + window.location.search)

function Raiz() {
  const { sessao } = useApp()
  const [definindoSenha, setDefinindoSenha] = useState(veioDeLink)
  if (!sessao) return <Login />
  if (definindoSenha) return <DefinirSenha concluir={() => { history.replaceState(null, '', '/'); setDefinindoSenha(false) }} />
  return (
    <Suspense fallback={<Carregando />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Painel />} />
          <Route path="clientes" element={<Clientes />} />
          <Route path="honorarios" element={<Honorarios />} />
          <Route path="recebimentos" element={<Recebimentos />} />
          <Route path="despesas" element={<Despesas />} />
          <Route path="recibos" element={<Recibos />} />
          <Route path="relatorios" element={<Relatorios />} />
          <Route path="asaas" element={<Asaas />} />
          <Route path="configuracoes" element={<Configuracoes />} />
          <Route path="*" element={<Painel />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AvisoProvider>
      <AppProvider>
        <BrowserRouter><Raiz /></BrowserRouter>
      </AppProvider>
    </AvisoProvider>
  </StrictMode>,
)
