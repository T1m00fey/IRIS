import { createContext, useContext } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router'
import { api, ApiError } from '../api/client'
import { PageState } from '../components/PageState'

export interface User {
  id: string
  username: string
  full_name: string
  role: 'operator' | 'manager'
  employee_id: string | null
  company: string | null
}
export interface Preferences {
  sidebar_collapsed: boolean
  density: 'comfortable' | 'compact'
  summary_expanded: boolean
  desktop_notifications: boolean
  sound_notifications: boolean
  notification_volume: number
}
export const sessionKey = ['auth', 'session']
const Session = createContext<User | null>(null)
export function useUser() { return useContext(Session)! }
export const home = (user: User) => user.role === 'operator' ? '/operator' : '/manager'

export function useSession() {
  return useQuery({ queryKey: sessionKey, queryFn: async ({ signal }) => {
    try { return await api<User>('/api/v1/auth/me', { signal }) }
    catch (error) { if (error instanceof ApiError && error.status === 401) return null; throw error }
  }, staleTime: 10000, refetchInterval: 60000, retry: false })
}

export function SessionGate({ role }: { role?: User['role'] }) {
  const session = useSession()
  const location = useLocation()
  if (session.isPending || session.isError) return <div className="auth-status"><PageState loading={session.isPending} error={session.error} retry={() => void session.refetch()} /></div>
  if (!session.data) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />
  if (role && session.data.role !== role) return <Navigate to={home(session.data)} replace />
  return <Session.Provider value={session.data}><Outlet /></Session.Provider>
}
export function HomeRedirect() { return <Navigate to={home(useUser())} replace /> }

export function usePreferences() {
  const user = useUser()
  const client = useQueryClient()
  const key = ['auth', 'preferences', user.id]
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => api<Preferences>('/api/v1/auth/preferences', { signal }) })
  const update = useMutation({ mutationFn: (patch: Partial<Preferences>) => api<Preferences>('/api/v1/auth/preferences', { method: 'PATCH', body: JSON.stringify(patch) }), onSuccess: data => client.setQueryData(key, data) })
  return { query, update }
}

export function useLogout() {
  const client = useQueryClient()
  const navigate = useNavigate()
  return useMutation({ mutationFn: () => api<void>('/api/v1/auth/logout', { method: 'POST' }), onSuccess: () => {
    client.clear()
    client.setQueryData(sessionKey, null)
    void navigate('/login', { replace: true })
  } })
}
