import { useQuery } from '@tanstack/react-query'
import { Clock3, UsersRound } from 'lucide-react'
import { api } from '../api/client'
import { PageHeading } from '../components/PageHeading'
import { PageState } from '../components/PageState'
import { departments } from '../features/operations/labels'
import { formatDuration, formatNumber } from '../lib/format'
import type { Department } from '../types/operations'

interface Analytics {
  employees_online: number
  average_wait_seconds: number | null
  departments: { department: Department; queued: number; in_progress: number; online: number }[]
}

export function useAnalytics() {
  return useQuery({ queryKey: ['analytics'], queryFn: ({ signal }) => api<Analytics>('/api/v1/analytics', { signal }) })
}

export function AnalyticsPage({ departmentView = false, embedded = false }: { departmentView?: boolean; embedded?: boolean }) {
  const query = useAnalytics()
  const data = query.data
  return <>
    {!embedded && <PageHeading title={departmentView ? 'Отделы' : 'Аналитика'} subtitle="Текущая нагрузка контактного центра" />}
    {!data ? <PageState loading={query.isPending} error={query.error} retry={() => void query.refetch()} /> : <>
      {!departmentView && <div className="metrics">
        <div className="panel metric"><div className="metric-label">Сотрудники онлайн<UsersRound size={16} className="metric-icon" /></div><strong className="metric-value">{formatNumber(data.employees_online)}</strong></div>
        <div className="panel metric"><div className="metric-label">Среднее ожидание<Clock3 size={16} className="metric-icon" /></div><strong className="metric-value">{formatDuration(data.average_wait_seconds)}</strong></div>
      </div>}
      <section className="panel">
        <header className="panel-heading"><h2>Нагрузка по отделам</h2></header>
        {data.departments.length === 0 ? <PageState empty="Данных пока нет" /> : <div className="table-scroll" tabIndex={0} role="region" aria-label="Нагрузка по отделам">
          <table className="data-table"><thead><tr><th scope="col">Отдел</th><th scope="col">В очереди</th><th scope="col">В работе</th><th scope="col">Сотрудники онлайн</th></tr></thead>
          <tbody>{data.departments.map(row => <tr key={row.department}><th scope="row">{departments[row.department]}</th><td>{formatNumber(row.queued)}</td><td>{formatNumber(row.in_progress)}</td><td>{formatNumber(row.online)}</td></tr>)}</tbody></table>
        </div>}
      </section>
    </>}
  </>
}
