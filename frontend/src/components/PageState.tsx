import { AlertCircle, Inbox, LoaderCircle } from 'lucide-react'
import { Button } from './ui/button'

export function PageState({ loading, error, empty = 'Записей пока нет', retry }: {
  loading?: boolean; error?: Error | null; empty?: string; retry?: () => void
}) {
  const state = error ? 'error' : loading ? 'loading' : 'empty'
  const Icon = error ? AlertCircle : loading ? LoaderCircle : Inbox
  return <div className="panel page-state" data-state={state} role={error ? 'alert' : 'status'}>
    <span className="page-state-icon" aria-hidden="true"><Icon size={22} className={state === 'loading' ? 'animate-spin' : undefined} /></span>
    <strong>{error ? 'Не удалось загрузить данные' : loading ? 'Загрузка данных' : empty}</strong>
    {error && <p>{error.message}</p>}
    {error && retry && <Button onClick={retry}>Повторить</Button>}
  </div>
}
