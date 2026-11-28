import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { PageHeading } from '../components/PageHeading'
import { PageState } from '../components/PageState'
import { StatusBadge } from '../components/StatusBadge'
import { formatDate } from '../lib/format'
import type { Dashboard } from '../types/operations'

export function IncidentsPage() {
  const query = useQuery({ queryKey: ['dashboard'], queryFn: ({ signal }) => api<Dashboard>('/api/v1/dashboard', { signal }) })
  const incidents = query.data?.active_incidents
  return <>
    <PageHeading title="Сетевые инциденты" subtitle="Открытые аварии и диагностика сети" />
    {!incidents?.length ? <PageState loading={query.isPending} error={query.error} retry={() => void query.refetch()} empty="Активных инцидентов нет" /> : <section className="panel">
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Активные инциденты"><table className="data-table">
        <thead><tr><th scope="col">Инцидент</th><th scope="col">Адрес</th><th scope="col">Статус</th><th scope="col">Начало</th><th scope="col">Ожидаемое восстановление</th></tr></thead>
        <tbody>{incidents.map(incident => <tr key={incident.id}><td><strong>{incident.title}</strong>{incident.description && <span className="table-secondary">{incident.description}</span>}</td><td>{incident.address || '—'}</td><td><StatusBadge tone="warning">{incident.status === 'investigating' ? 'Диагностика' : 'Открыт'}</StatusBadge></td><td>{formatDate(incident.started_at)}</td><td>{formatDate(incident.estimated_resolution_at)}</td></tr>)}</tbody>
      </table></div>
    </section>}
  </>
}
