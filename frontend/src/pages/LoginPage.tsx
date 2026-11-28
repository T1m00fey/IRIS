import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, LockKeyhole } from 'lucide-react'
import { Navigate, useLocation } from 'react-router'
import { api } from '../api/client'
import { home, sessionKey, useSession, type User } from '../app/session'
import { Button } from '../components/ui/button'

export function LoginPage() {
  const session = useSession()
  const client = useQueryClient()

  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const login = useMutation({ mutationFn: () => api<User>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }), onSuccess: user => {
    client.clear()
    client.setQueryData(sessionKey, user)

  } })
  if (session.data) {
    const from = location.state?.from
    const localPath = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && !from.includes(String.fromCharCode(92)) && !from.startsWith('/login')
    return <Navigate to={localPath ? from : home(session.data)} replace />
  }
  function submit(event: FormEvent) { event.preventDefault(); login.mutate() }
  return <main className="login-screen"><div className="login-wrap">
    <div className="login-brand"><img src="/iris.svg" alt="" /><div><strong>IRIS</strong><span>SkyNet</span></div></div>
    <section className="panel login-card"><div className="icon-chip"><LockKeyhole size={21} /></div><h1>Вход в IRIS</h1><p>Рабочий кабинет контакт-центра SkyNet</p>
      <form onSubmit={submit}>
        <label>Имя пользователя<input className="field" autoComplete="username" required value={username} onChange={event => setUsername(event.target.value)} /></label>
        <label>Пароль<input className="field" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
        {login.isError && <p className="alert" role="alert">{login.error.message}</p>}
        <Button type="submit" variant="primary" disabled={login.isPending}>{login.isPending ? 'Вход…' : 'Войти'}<ArrowRight size={17} /></Button>
      </form>
    </section>
  </div></main>
}
