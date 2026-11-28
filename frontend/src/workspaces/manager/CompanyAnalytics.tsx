import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, CalendarDays, Clock3, Headset, Hourglass, Phone, PhoneMissed, type LucideIcon } from 'lucide-react'
import { api } from '../../api/client'
import { PageHeading } from '../../components/PageHeading'
import { PageState } from '../../components/PageState'
import { MetricCard } from '../../components/ui/MetricCard'
import { departments } from '../../features/operations/labels'
import { formatDuration, formatNumber } from '../../lib/format'
import type { Employee } from '../../types/operations'
import { moscowDay } from '../operator/data'
import { CallLegend, CallTrend, OutcomeChart, Sparkline } from './AnalyticsCharts'
import {
  employeeActivity, formatReportDay, previousRange, useCompanyReport, useEmployeeActivity, useTicketProcessing, validRange,
  type CompanyReport, type EmployeeActivity, type ReportFilters,
} from './analytics-data'
import './analytics.css'

const percent = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 1 })

function AnalyticsMetric({ label, value, previous, duration = false, lowerIsBetter = false, icon, series, comparison }: {
  label: string
  value: number | null
  previous?: number | null
  duration?: boolean
  lowerIsBetter?: boolean
  icon: LucideIcon
  series?: number[]
  comparison: string
}) {
  const formatted = value === null ? '—' : duration ? formatDuration(value) : formatNumber(value)
  const delta = previous != null && previous > 0 && value !== null ? (value - previous) / previous : null
  const direction = delta === null || Math.abs(delta) < .0005 ? 0 : Math.sign(delta)
  const tone = !direction ? 'neutral' : (direction < 0) === lowerIsBetter ? 'success' : 'danger'
  const Arrow = direction < 0 ? ArrowDown : ArrowUp
  const change = (direction > 0 ? '+' : direction < 0 ? '−' : '') + percent.format(Math.abs(delta ?? 0))
  const trend = delta !== null
    ? <span className={'badge badge-' + tone} title={comparison} aria-label={change + ' ' + comparison}>
        {direction !== 0 && <Arrow size={13} aria-hidden="true" />}{change}
      </span>
    : null

  return <MetricCard label={label} icon={icon} value={<><span>{formatted}</span>
    {(trend || series) && <span className="analytics-metric-detail">{trend}{series && <Sparkline values={series} />}</span>}
  </>} />
}

function AnalyticsPanel({ title, header, children }: { title: string; header?: ReactNode; children: ReactNode }) {
  return <section className="panel content-panel analytics-panel">
    <div className="analytics-panel-heading"><h2>{title}</h2>{header}</div>
    {children}
  </section>
}

function EmployeeTable({ rows, report }: { rows: EmployeeActivity[]; report: CompanyReport }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? rows : rows.slice(0, 5)
  if (!rows.length) return <PageState empty="За выбранный период нет активности сотрудников" />

  return <>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Эффективность сотрудников">
      <table className="data-table analytics-employee-table">
        <colgroup><col /><col /><col /><col /><col /></colgroup>
        <thead><tr>
          <th scope="col">Сотрудник</th><th scope="col">Отдел</th><th scope="col" title="Звонки, принятые сотрудником">Звонки</th>
          <th scope="col">Ср. длительность</th><th scope="col">Решено</th>
        </tr></thead>
        <tbody>{visible.map(({ person, calls, duration, resolved }) => {
          const initials = person.full_name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase()
          const department = report.departments.find(item => item.code === person.department)?.name ?? departments[person.department] ?? person.department
          return <tr key={person.id}>
            <th scope="row"><span className="analytics-person"><span className="avatar" aria-hidden="true">{initials}</span>{person.full_name}</span></th>
            <td>{department}</td><td>{formatNumber(calls)}</td><td>{formatDuration(duration)}</td><td>{formatNumber(resolved)}</td>
          </tr>
        })}</tbody>
      </table>
    </div>
    {rows.length > 5 && <button className="text-link analytics-show-all" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      {expanded ? 'Свернуть список' : 'Все сотрудники (' + formatNumber(rows.length) + ')'}
    </button>}
  </>
}

function TicketProcessing({ filters, report }: { filters: ReportFilters; report: CompanyReport }) {
  const query = useTicketProcessing(filters, report.total_tickets)
  const counts = report.total_tickets === 0 ? { in_progress: 0, closed: 0, queued: 0 } : query.data?.counts
  const rows = [
    { label: 'Создано', value: report.total_tickets, tone: 'neutral' },
    { label: 'В работе', value: counts?.in_progress, tone: 'info' },
    { label: 'Закрыто', value: counts?.closed, tone: 'success' },
    { label: 'Ожидает', value: counts?.queued, tone: 'warning' },
  ]
  return <>
    <p className="analytics-note">Текущие статусы обращений, созданных в выбранном периоде</p>
    <dl className="analytics-ticket-list">
      {rows.map(row => <div key={row.label}>
        <dt><i data-tone={row.tone} aria-hidden="true" />{row.label}</dt><dd>{row.value === undefined ? '—' : formatNumber(row.value)}</dd>
      </div>)}
      {query.data?.averageSeconds != null && <div><dt><Clock3 size={15} />Среднее время обработки</dt><dd>{formatDuration(query.data.averageSeconds)}</dd></div>}
    </dl>
    {report.total_tickets > 0 && query.isPending && <p className="analytics-note" role="status">Загрузка статусов…</p>}
    {query.isError && <PageState error={query.error} retry={() => void query.refetch()} />}
  </>
}

function DepartmentLoad({ report }: { report: CompanyReport }) {
  const rows = [...report.by_department].sort((a, b) => b.total_calls - a.total_calls || b.total_tickets - a.total_tickets)
  const scales = [Math.max(4, ...rows.map(row => row.total_calls)), Math.max(4, ...rows.map(row => row.total_tickets))]
  if (!rows.some(row => row.total_calls || row.total_tickets || row.resolved_tickets)) return <PageState empty="За выбранный период нагрузки нет" />

  return <div className="table-scroll" tabIndex={0} role="region" aria-label="Нагрузка по отделам">
    <table className="data-table analytics-load-table">
      <thead><tr><th scope="col">Отдел</th><th scope="col">Звонки</th><th scope="col">Создано обращений</th><th scope="col">Закрыто в периоде</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.department ?? 'unassigned'}>
        <th scope="row">{row.name}</th>
        {[row.total_calls, row.total_tickets].map((count, index) => <td key={index}>
          <span className="analytics-load-value">
            <svg viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
              <rect width="100" height="6" fill="var(--muted)" />
              <rect width={count * 100 / scales[index]} height="6" fill={index === 0 ? 'var(--primary)' : 'var(--analytics-secondary)'} />
            </svg>{formatNumber(count)}
          </span>
        </td>)}
        <td>{formatNumber(row.resolved_tickets)}</td>
      </tr>)}</tbody>
    </table>
  </div>
}

export function CompanyAnalytics() {
  const [period, setPeriod] = useState('7')
  const [filters, setFilters] = useState<ReportFilters>(() => ({ from: moscowDay(6), to: moscowDay(), department: '', employee: '' }))
  const valid = validRange(filters)
  const previous = valid ? previousRange(filters) : filters
  const comparison = validRange(previous)
    ? 'к предыдущему периоду (' + formatReportDay(previous.from, true) + ' — ' + formatReportDay(previous.to, true) + ')'
    : ''
  const query = useCompanyReport(filters)
  const comparisonQuery = useCompanyReport(previous)
  const employees = useQuery({ queryKey: ['employees'], queryFn: ({ signal }) => api<Employee[]>('/api/v1/employees', { signal }) })
  const data = query.data
  const previousData = comparisonQuery.data
  const [knownDepartments, setKnownDepartments] = useState<CompanyReport['departments']>([])
  const reportDepartments = data?.departments ?? previousData?.departments
  if (reportDepartments && reportDepartments !== knownDepartments) setKnownDepartments(reportDepartments)
  const hasComparison = Boolean(previousData?.total_calls)
  const employeeQuery = useEmployeeActivity(filters, employees.data ?? [])
  const selected = employees.data?.find(person => person.id === filters.employee)
  const rows = selected && data ? [employeeActivity(selected, data)] : employeeQuery.data ?? []
  const dateKey = filters.from + '/' + filters.to
  const patchFilters = (patch: Partial<ReportFilters>) => setFilters(current => ({ ...current, ...patch }))

  function changePeriod(value: string) {
    setPeriod(value)
    if (value !== 'custom') patchFilters({ from: moscowDay(Number(value) - 1), to: moscowDay() })
  }

  return <>
    <PageHeading title="Аналитика" subtitle="Показатели обслуживания, динамика звонков и результаты обращений" />
    <div className="company-analytics layout-stack">
      <div className="analytics-filters" role="group" aria-label="Фильтры аналитики">
        <label className="filter-label">Период<span className="analytics-period"><CalendarDays size={16} aria-hidden="true" />
          <select className="field" aria-label="Период" value={period} onChange={event => changePeriod(event.target.value)}>
            <option value="1">Сегодня</option><option value="7">Последние 7 дней</option>
            <option value="30">Последние 30 дней</option><option value="custom">Произвольный период</option>
          </select>
        </span></label>
        {period === 'custom' && <>
          <label className="filter-label">С<input className="field" type="date" value={filters.from} onChange={event => patchFilters({ from: event.target.value })} /></label>
          <label className="filter-label">По<input className="field" type="date" value={filters.to} onChange={event => patchFilters({ to: event.target.value })} /></label>
        </>}
        <label className="filter-label">Отдел<select className="field" aria-label="Отдел" value={filters.department} disabled={!knownDepartments.length} onChange={event => patchFilters({ department: event.target.value })}>
          <option value="">Все отделы</option>
          {knownDepartments.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
        </select></label>
        <label className="filter-label">Сотрудник<select className="field" aria-label="Сотрудник" value={filters.employee} disabled={!employees.data} onChange={event => patchFilters({ employee: event.target.value })}>
          <option value="">Все сотрудники</option>{employees.data?.map(person => <option key={person.id} value={person.id}>{person.full_name}</option>)}
        </select></label>
        {hasComparison && <span className="analytics-comparison muted" title={comparison}>Динамика к предыдущему периоду</span>}
      </div>
      {!valid ? <PageState empty="Укажите корректный период от 1 до 366 дней" /> : !data ?
        <PageState loading={query.isPending} error={query.error} retry={() => void query.refetch()} /> : <>
          {query.isError && <PageState error={query.error} retry={() => void query.refetch()} />}
          <div className="analytics-kpis">
            <AnalyticsMetric label="Всего звонков" value={data.total_calls} previous={previousData?.total_calls} icon={Phone} series={data.daily.map(day => day.total_calls)} comparison={comparison} />
            <AnalyticsMetric label="Принятые звонки" value={data.accepted_calls} previous={previousData?.accepted_calls} icon={Headset} series={data.daily.map(day => day.accepted_calls)} comparison={comparison} />
            <AnalyticsMetric label="Среднее время ответа" value={data.average_answer_seconds} previous={previousData?.average_answer_seconds} icon={Clock3} comparison={comparison} duration lowerIsBetter />
            <AnalyticsMetric label="Пропущенные звонки" value={data.abandoned_calls} previous={previousData?.abandoned_calls} icon={PhoneMissed} series={data.daily.map(day => day.abandoned_calls)} comparison={comparison} lowerIsBetter />
          </div>
          <div className="analytics-grid">
            <AnalyticsPanel title="Динамика звонков" header={data.total_calls > 0 && <CallLegend />}>
              {data.total_calls && data.daily.length ? <CallTrend key={dateKey} days={data.daily} /> : <PageState empty="За выбранный период звонков нет" />}
            </AnalyticsPanel>
            <AnalyticsPanel title="Результаты звонков">
              {data.outcomes.some(row => row.count > 0) ? <OutcomeChart values={data.outcomes} /> : <PageState empty="За выбранный период результатов нет" />}
            </AnalyticsPanel>
            <AnalyticsPanel title="Эффективность сотрудников">
              {employees.isError || employeeQuery.isError
                ? <PageState error={employees.error ?? employeeQuery.error} retry={() => void (employees.isError ? employees.refetch() : employeeQuery.refetch())} />
                : employees.isPending || employeeQuery.isLoading ? <PageState loading />
                : <EmployeeTable key={dateKey + filters.department + filters.employee} rows={rows} report={data} />}
            </AnalyticsPanel>
            <AnalyticsPanel title="Обработка обращений"><TicketProcessing filters={filters} report={data} /></AnalyticsPanel>
          </div>
          {(data.average_duration_seconds !== null || data.average_wait_seconds !== null) && <dl className="panel analytics-secondary-metrics">
            {data.average_duration_seconds !== null && <div><Phone size={16} /><dt>Средняя длительность разговора</dt><dd>{formatDuration(data.average_duration_seconds)}</dd></div>}
            {data.average_wait_seconds !== null && <div><Hourglass size={16} /><dt>Среднее ожидание обращения</dt><dd>{formatDuration(data.average_wait_seconds)}</dd></div>}
          </dl>}
          <AnalyticsPanel title="Нагрузка по отделам"><DepartmentLoad report={data} /></AnalyticsPanel>
        </>}
    </div>
  </>
}
