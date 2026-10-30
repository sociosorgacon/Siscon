import { useState } from 'react'
import { supabase, traduzErro } from '../lib/supabase'
import { Botao, Campo } from '../components/ui'

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-marca-900 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-7 shadow-2xl">
        <p className="text-2xl font-bold text-marca-800">Siscon</p>
        <p className="mb-6 text-sm text-slate-500">Sistema de honorários · Orgacon Contabilidade</p>
        {children}
      </div>
    </div>
  )
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function entrar(e: React.FormEvent) {
    e.preventDefault(); setEnviando(true); setMsg(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    if (error) setMsg({ t: traduzErro(error.message), erro: true })
    setEnviando(false)
  }

  async function esqueci() {
    if (!email) return setMsg({ t: 'Digite seu e-mail primeiro.', erro: true })
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
    setMsg(error ? { t: traduzErro(error.message), erro: true } : { t: 'Enviamos um link para redefinir a senha.' })
  }

  return (
    <Moldura>
      <form onSubmit={entrar} className="space-y-4">
        <Campo rotulo="E-mail"><input className="campo" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></Campo>
        <Campo rotulo="Senha"><input className="campo" type="password" autoComplete="current-password" value={senha} onChange={e => setSenha(e.target.value)} required /></Campo>
        {msg && <p className={`text-sm ${msg.erro ? 'text-red-600' : 'text-emerald-700'}`}>{msg.t}</p>}
        <Botao className="w-full" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</Botao>
        <button type="button" onClick={esqueci} className="w-full text-center text-xs text-slate-500 hover:underline">Esqueci minha senha</button>
      </form>
    </Moldura>
  )
}

export function DefinirSenha({ concluir }: { concluir: () => void }) {
  const [senha, setSenha] = useState('')
  const [conf, setConf] = useState('')
  const [erro, setErro] = useState('')
  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (senha.length < 8) return setErro('Use pelo menos 8 caracteres.')
    if (senha !== conf) return setErro('As senhas não conferem.')
    const { error } = await supabase.auth.updateUser({ password: senha })
    if (error) return setErro(traduzErro(error.message))
    concluir()
  }
  return (
    <Moldura>
      <form onSubmit={salvar} className="space-y-4">
        <p className="text-sm text-slate-600">Defina sua senha de acesso.</p>
        <Campo rotulo="Nova senha"><input className="campo" type="password" autoComplete="new-password" value={senha} onChange={e => setSenha(e.target.value)} /></Campo>
        <Campo rotulo="Confirmar senha"><input className="campo" type="password" autoComplete="new-password" value={conf} onChange={e => setConf(e.target.value)} /></Campo>
        {erro && <p className="text-sm text-red-600">{erro}</p>}
        <Botao className="w-full">Salvar senha</Botao>
      </form>
    </Moldura>
  )
}
