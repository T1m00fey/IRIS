import { UserRound } from 'lucide-react'
import { useLogout, useUser } from '../app/session'
import { PageHeading } from '../components/PageHeading'
import { Button } from '../components/ui/button'
import { OperatorProfileDetails } from '../workspaces/operator/OperatorPages'

export { SettingsPage } from '../features/settings/SettingsPage'

export function ProfilePage() {
  const user = useUser()
  const logout = useLogout()
  return <><PageHeading title="Мой профиль" subtitle="Учётная запись IRIS" actions={<Button onClick={() => logout.mutate()} disabled={logout.isPending}>Выйти</Button>} />
    <div className="settings-grid"><section className="panel content-panel"><h2><UserRound size={21} /> {user.full_name}</h2><dl className="key-values"><div><dt>Имя пользователя</dt><dd>{user.username}</dd></div><div><dt>Компания</dt><dd>{user.company || '—'}</dd></div><div><dt>Роль</dt><dd>{user.role === 'manager' ? 'Руководитель' : 'Оператор'}</dd></div></dl></section>
    {user.role === 'operator' && <OperatorProfileDetails />}{logout.isError && <p className="alert" role="alert">{logout.error.message}</p>}</div>
  </>
}
