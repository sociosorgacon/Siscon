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

// Depois de uma publicação, uma aba que ficou aberta procura arquivos da versão antiga (que deixam de existir) e dá
// "Failed to fetch dynamically imported module". Nesse caso recarrega a página uma vez para pegar a versão nova.
window.addEventListener('vite:preloadError', e => {
  let ultima = 0
  try { ultima = Number(sessionStorage.getItem('siscon_recarregou') || 0) } catch { /* sem sessionStorage */ }
  if (Date.now() - ultima < 30000) return   // já recarregou há pouco: deixa o erro aparecer (evita ficar recarregando)
  try { sessionStorage.setItem('siscon_recarregou', String(Date.now())) } catch { /* ignora */ }
  e.preventDefault()
  window.location.reload()
})

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
