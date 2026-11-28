import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock3, Hourglass, Phone, Radio, Ticket, UsersRound } from 'lucide-react'
import { Link } from 'react-router'
import { api } from '../api/client'
import { PageHeading } from '../components/PageHeading'
import { PageState } from '../components/PageState'
import { Button } from '../components/ui/button'
import { CallsTable } from '../features/operations/CallsTable'
import { departments } from '../features/operations/labels'
import { formatDuration, formatNumber } from '../lib/format'
import type { Dashboard } from '../types/operations'
import { useAnalytics } from './AnalyticsPage'

export function DashboardPage() {
  const query = useQuery({ queryKey: ['dashboard'], queryFn: ({ signal }) => api<Dashboard>('/api/v1/dashboard', { signal }) })
  const data = query.data
  const analytics = useAnalytics().data
  const metrics = data ? [
    { label: 'Всего звонков', value: formatNumber(data.total_calls), icon: Phone },
    { label: 'Активные звонки', value: formatNumber(data.active_calls), icon: Radio },
    { label: 'Завершённые звонки', value: formatNumber(data.completed_calls), icon: CheckCircle2 },
    { label: 'Обращения', value: formatNumber(data.total_tickets), icon: Ticket },
    { label: 'Средний разговор', value: formatDuration(data.average_duration_seconds), icon: Clock3 },
    ...(analytics ? [
      { label: 'Сотрудники онлайн', value: formatNumber(analytics.employees_online), icon: UsersRound },
      { label: 'Среднее ожидание', value: formatDuration(analytics.average_wait_seconds), icon: Hourglass },
    ] : []),
  ] : []
  return <>
    <PageHeading title="Обзор контактного центра" subtitle="Звонки, обращения и состояние сети" actions={<Button asChild variant="primary"><Link to="/workspace">Рабочее место <ArrowUpRight size={14} /></Link></Button>} />
    {!data ? <PageState loading={query.isPending} error={query.error} retry={() => void query.refetch()} /> : <>
      <div className="metrics">{metrics.map(metric => <div className="panel metric" key={metric.label}>
        <div className="metric-label">{metric.label}<metric.icon size={15} className="metric-icon" aria-hidden="true" /></div><strong className="metric-value">{metric.value}</strong>
      </div>)}</div>
      <div className="dashboard-grid">
        <section className="panel"><header className="panel-heading"><h2>Последние звонки</h2><Link className="text-link" to="/calls">Вся история</Link></header>
          {data.recent_calls.length > 0 ? <CallsTable calls={data.recent_calls} compact /> : <PageState empty="Звонков пока нет" />}
        </section>
        <div className="dashboard-side">
          <section className="panel"><header className="panel-heading"><h2>Обращения по отделам</h2></header>
            {data.total_tickets === 0 ? <PageState empty="Обращений пока нет" /> : <ul className="department-breakdown">
              {data.tickets_by_department.map(item => <li key={item.department}><div className="department-line"><span>{departments[item.department]}</span><strong>{item.count}</strong></div><progress aria-label={departments[item.department]} max={Math.max(1, data.total_tickets)} value={item.count} /></li>)}
            </ul>}
          </section>
          <section className="panel"><header className="panel-heading"><h2>Активные инциденты</h2><Link className="text-link" to="/incidents">К инцидентам</Link></header>
            {data.active_incidents.length === 0 ? <PageState empty="Активных инцидентов нет" /> : <ul className="incident-list">{data.active_incidents.map(incident => <li key={incident.id}><AlertTriangle size={15} /><div><strong>{incident.title}</strong>{(incident.address) && <small>{incident.address}</small>}</div></li>)}</ul>}
          </section>
        </div>
      </div>
    </>}
  </>
}
