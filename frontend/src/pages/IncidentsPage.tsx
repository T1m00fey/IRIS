import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { api } from '../api/client'
import { PageHeading } from '../components/PageHeading'
import { PageState } from '../components/PageState'
import { Pagination } from '../components/Pagination'
import { StatusBadge } from '../components/StatusBadge'
import { Button } from '../components/ui/button'
import { formatDate } from '../lib/format'

const statuses = {
  suspected: { label: 'Возможная авария', tone: 'warning' },
  open: { label: 'Подтверждён', tone: 'warning' },
  investigating: { label: 'Диагностика', tone: 'info' },
  resolved: { label: 'Закрыт', tone: 'success' },
  rejected: { label: 'Отклонён', tone: 'neutral' },
} as const

type Incident = {
  id: string
  title: string
  description: string
  address: string
  status: keyof typeof statuses
  started_at: string
  last_report_at: string | null
  estimated_resolution_at: string | null
  report_ids: string[]
}

type IncidentList = { items: Incident[]; total: number; limit: number; offset: number }
type IncidentAction = 'confirm' | 'reject' | 'close'

export function IncidentsPage() {
  const client = useQueryClient()
  const [offset, setOffset] = useState(0)
  const query = useQuery({
    queryKey: ['incident_alerts', offset],
    queryFn: ({ signal }) => api<IncidentList>('/api/v1/incidents?offset=' + offset, { signal }),
  })
  const change = useMutation({
    mutationFn: ({ id, action }: { id: string; action: IncidentAction }) =>
      api<Incident>('/api/v1/incidents/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ action }) }),
    onSettled: () => Promise.all([
      client.invalidateQueries({ queryKey: ['incident_alerts'] }),
      client.invalidateQueries({ queryKey: ['dashboard'] }),
      client.invalidateQueries({ queryKey: ['customers'] }),
    ]),
  })
  const data = query.data
  return <>
    <PageHeading title="Сетевые инциденты" subtitle="Предупреждения и аварии сети" />
    {change.error && <p role="alert">{change.error.message}</p>}
    {!data?.items.length ? <PageState loading={query.isPending} error={query.error} retry={() => void query.refetch()} empty="Сетевых инцидентов пока нет" /> : <section className="panel">
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Сетевые инциденты"><table className="data-table">
        <thead><tr><th scope="col">Инцидент</th><th scope="col">Адрес или район</th><th scope="col">Статус</th><th scope="col">Начало</th><th scope="col">Действия</th></tr></thead>
        <tbody>{data.items.map(incident => <tr key={incident.id}>
          <td><strong>{incident.title}</strong><span className="table-secondary">{incident.description}</span>
            {incident.report_ids.length > 0 && <details className="table-secondary">
              <summary>Обращения клиентов ({incident.report_ids.length})</summary>
              <ul>{incident.report_ids.map(id => <li key={id}><Link to={'/tickets/' + encodeURIComponent(id)}>{id}</Link></li>)}</ul>
            </details>}
          </td>
          <td>{incident.address}</td>
          <td><StatusBadge tone={statuses[incident.status].tone}>{statuses[incident.status].label}</StatusBadge></td>
          <td>{formatDate(incident.started_at)}
            {incident.last_report_at && <span className="table-secondary">Последнее обращение {formatDate(incident.last_report_at)}</span>}
            {incident.estimated_resolution_at && <span className="table-secondary">Ожидаемое восстановление {formatDate(incident.estimated_resolution_at)}</span>}
          </td>
          <td><div className="actions">
            {incident.status === 'suspected' && <>
              <Button variant="primary" disabled={change.isPending} onClick={() => change.mutate({ id: incident.id, action: 'confirm' })}>Подтвердить</Button>
              <Button disabled={change.isPending} onClick={() => change.mutate({ id: incident.id, action: 'reject' })}>Отклонить</Button>
            </>}
            {(incident.status === 'open' || incident.status === 'investigating') &&
              <Button disabled={change.isPending} onClick={() => change.mutate({ id: incident.id, action: 'close' })}>Закрыть</Button>}
          </div></td>
        </tr>)}</tbody>
      </table></div>
      {data.total > data.limit && <Pagination offset={data.offset} limit={data.limit} total={data.total} setOffset={setOffset} />}
    </section>}
  </>
}
