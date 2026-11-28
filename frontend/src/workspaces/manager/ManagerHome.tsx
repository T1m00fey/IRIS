import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, Headset, Minus, Phone, Ticket as TicketIcon, X,
} from 'lucide-react'
import { Link } from 'react-router'
import { PageHeading } from '../../components/PageHeading'
import { PageState } from '../../components/PageState'
import { StatusBadge } from '../../components/StatusBadge'
import { Button } from '../../components/ui/button'
import { ticketStatuses, ticketTones } from '../../features/operations/labels'
import { formatDate, formatDuration, formatNumber } from '../../lib/format'
import type { Employee, Incident } from '../../types/operations'
import { summarizeVoiceQueue, useManagerDashboard } from './dashboard-data'
import './manager-home.css'

const ticketDate = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
})

function Delta({ change }: { change: number }) {
  const Icon = change > 0 ? ArrowUpRight : change < 0 ? ArrowDownRight : Minus
  const value = change > 0 ? '+' + formatNumber(change) : formatNumber(change)
  return <span className="manager-home-delta" title="Разница со вчерашним итогом">
    <Icon size={14} aria-hidden="true" />{value}<span className="sr-only"> к вчерашнему итогу</span>
  </span>
}

function EmployeeDistribution({ employees }: { employees: Employee[] }) {
  const states = [
    { label: 'На линии', color: 'var(--primary)', count: employees.filter(person => person.status === 'available').length },
    { label: 'Заняты разговором', color: 'var(--success)', count: employees.filter(person => person.status === 'busy').length },
    { label: 'На паузе', color: 'var(--warning)', count: employees.filter(person => person.status === 'paused' || person.status === 'lunch').length },
    { label: 'Офлайн', color: 'var(--border)', count: employees.filter(person => person.status === 'offline').length },
  ]
  const wrapUp = employees.filter(person => person.status === 'wrap_up').length
  if (wrapUp) states.push({ label: 'Постобработка', color: 'var(--muted-foreground)', count: wrapUp })

  let start = 0
  const stops = states.filter(state => state.count > 0).map(state => {
    const end = start + state.count
    const segment = state.color + ' ' + (100 * start / employees.length) + '% ' + (100 * end / employees.length) + '%'
    start = end
    return segment
  })
  const ring = stops.length ? 'conic-gradient(' + stops.join(', ') + ')' : undefined
  return <div className="manager-home-presence">
    <div className="manager-home-ring" style={{ backgroundImage: ring }}>
      <div className="manager-home-ring-center"><strong>{formatNumber(employees.length)}</strong><span>Сотрудники</span></div>
    </div>
    <dl className="manager-home-legend">
      {states.map(state => <div key={state.label}>
        <dt><span style={{ backgroundColor: state.color }} aria-hidden="true" />{state.label}</dt>
        <dd>{formatNumber(state.count)}</dd>
      </div>)}
    </dl>
  </div>
}

function HourlyCalls({ series }: { series: number[] }) {
  const [activeHour, setActiveHour] = useState<number | null>(null)
  const [focusedHour, setFocusedHour] = useState(() => Math.max(0, series.findIndex(Boolean)))
  const step = Math.max(1, Math.ceil(Math.max(...series) / 4))
  const ticks = [4, 3, 2, 1, 0].map(tick => tick * step)
  return <>
    <div className="manager-home-chart">
      <div className="manager-home-chart-scale" aria-hidden="true">{ticks.map(tick => <span key={tick}>{formatNumber(tick)}</span>)}</div>
      <div className="manager-home-chart-plot">
        <div className="manager-home-chart-grid" aria-hidden="true">{ticks.map(tick => <i key={tick} />)}</div>
        <div className="manager-home-chart-bars" onMouseLeave={() => setActiveHour(null)}>
          {series.map((count, hour) => {
            const time = String(hour).padStart(2, '0') + ':00'
            const label = hour === 23 ? time + '–00:00' : time + '–' + String(hour + 1).padStart(2, '0') + ':00'
            return <button key={time} type="button" tabIndex={hour === focusedHour ? 0 : -1} aria-label={label + ', звонков ' + formatNumber(count)}
              className="manager-home-chart-hour" data-empty={!count}
              onMouseEnter={() => setActiveHour(hour)} onFocus={() => { setFocusedHour(hour); setActiveHour(hour) }}
              onBlur={() => setActiveHour(null)} onClick={() => setActiveHour(hour)}
              onKeyDown={event => {
                if (event.key === 'Escape') setActiveHour(null)
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault()
                  const sibling = event.key === 'ArrowLeft' ? event.currentTarget.previousElementSibling : event.currentTarget.nextElementSibling
                  if (sibling instanceof HTMLButtonElement) sibling.focus()
                }
              }}>
              <span className="manager-home-chart-bar" style={{ height: (100 * count / ticks[0]) + '%' }} aria-hidden="true" />
              {hour === activeHour && <span className="manager-home-chart-tooltip" aria-hidden="true"
                data-edge={hour < 5 ? 'start' : hour > 18 ? 'end' : undefined}
                style={{ bottom: Math.min(75, 100 * count / ticks[0]) + '%' }}>
                <strong>{label}</strong><span>Звонков · {formatNumber(count)}</span>
              </span>}
            </button>
          })}
        </div>
        <div className="manager-home-chart-hours" aria-hidden="true">
          {['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00'].map(time => <span key={time}>{time}</span>)}
        </div>
      </div>
    </div>
    {!series.some(Boolean) && <p className="manager-home-chart-empty">Сегодня звонков пока нет</p>}
  </>
}

type DashboardIncident = Incident & { affected_customers?: number | null }

function IncidentStatus({ incident }: { incident: Incident }) {
  if (!incident.status) return null
  return <StatusBadge tone="warning">{incident.status === 'investigating' ? 'Диагностика' : 'Открыт'}</StatusBadge>
}

export function ManagerHome() {
  const { activity, dashboard, tickets, employees, hours, queue, today, yesterday } = useManagerDashboard()
  const [selectedIncident, setSelectedIncident] = useState<DashboardIncident>()
  const incidentDialog = useRef<HTMLDialogElement>(null)
  const incidents: DashboardIncident[] | undefined = dashboard.data?.active_incidents
  const queueRows = queue.data?.enabled ? summarizeVoiceQueue(queue.data, employees.data) : []
  const metrics = [
    { Icon: Phone, title: 'Звонки сегодня', value: today?.total_calls, context: today ? 'Принято · ' + formatNumber(today.accepted_calls) : 'Сегодня, МСК', change: today && yesterday ? today.total_calls - yesterday.total_calls : undefined },
    { Icon: TicketIcon, title: 'Обращения', value: today?.total_tickets, context: 'Создано сегодня', change: today && yesterday ? today.total_tickets - yesterday.total_tickets : undefined },
    { Icon: Headset, title: 'Активные звонки', value: dashboard.data?.active_calls, context: 'В процессе сейчас' },
    { Icon: AlertTriangle, title: 'Сетевые инциденты', value: incidents?.length, context: incidents ? 'На диагностике · ' + formatNumber(incidents.filter(incident => incident.status === 'investigating').length) : 'Активные инциденты', warning: true },
  ]

  useEffect(() => {
    if (selectedIncident) incidentDialog.current?.showModal()
  }, [selectedIncident])

  return <>
    <PageHeading title="Главная" subtitle="Общая ситуация в контакт-центре" />
    <div className="manager-home layout-stack">
      <div className="manager-home-metrics">
        {metrics.map(({ Icon, title, value, context, change, warning }) => <article className="panel manager-home-metric" key={title}>
          <span className="icon-chip" data-warning={warning} aria-hidden="true"><Icon size={22} /></span>
          <div className="manager-home-metric-copy">
            <h2>{title}</h2>
            <strong className="metric-value">{value === undefined ? '—' : formatNumber(value)}</strong>
            <div className="manager-home-metric-context"><span>{context}</span>{change !== undefined && <Delta change={change} />}</div>
          </div>
        </article>)}
      </div>
      {!today && activity.isError && <PageState error={activity.error} retry={() => void activity.refetch()} />}

      <div className="manager-home-overview">
        <section className="panel content-panel manager-home-panel" aria-labelledby="manager-presence-title">
          <header className="manager-home-section-heading"><h2 id="manager-presence-title">Текущая ситуация</h2></header>
          {employees.data ? <EmployeeDistribution employees={employees.data} /> : <PageState loading={employees.isPending} error={employees.error} retry={() => void employees.refetch()} />}
        </section>
        <section className="panel content-panel manager-home-panel" aria-labelledby="manager-hourly-title">
          <header className="manager-home-section-heading"><h2 id="manager-hourly-title">Звонки по часам</h2><small>Сегодня, МСК</small></header>
          {hours.data ? <HourlyCalls series={hours.data} /> : <PageState loading={hours.isPending} error={hours.error} retry={() => void hours.refetch()} />}
        </section>
        <section className="panel content-panel manager-home-panel" aria-labelledby="manager-queues-title">
          <header className="manager-home-section-heading">
            <h2 id="manager-queues-title">Очереди</h2>
            <Link className="text-link manager-home-link" to="/manager/contact-center">Все очереди <ArrowUpRight size={14} aria-hidden="true" /></Link>
          </header>
          {queueRows.length ? <ul className="manager-home-queues">
            {queueRows.map(row => <li key={row.code}>
              <div className="manager-home-queue-title"><h3>{row.name}</h3><strong>{formatNumber(row.waiting)} <small>ожидают</small></strong></div>
              {row.available !== undefined && <progress aria-label={'Загрузка, ' + row.name} title="Доля ожидающих среди звонков и свободных операторов" max={Math.max(1, row.waiting + row.available)} value={row.waiting} />}
              <div className="manager-home-queue-meta">
                <span>Доступно · <strong>{row.available === undefined ? '—' : formatNumber(row.available)}</strong></span>
                {row.averageWait !== null && <span>Ср. ожидание · <strong>{formatDuration(row.averageWait)}</strong></span>}
              </div>
            </li>)}
          </ul> : <PageState loading={queue.isPending} error={queue.error} retry={() => void queue.refetch()}
            empty={queue.data?.enabled ? 'Нет отделов с голосовой очередью' : 'Распределение звонков отключено'} />}
        </section>
      </div>

      <div className="manager-home-lists">
        <section className="panel content-panel manager-home-panel" aria-labelledby="manager-tickets-title">
          <header className="manager-home-section-heading">
            <h2 id="manager-tickets-title">Последние обращения</h2>
            <Link className="text-link manager-home-link" to="/tickets">Все обращения <ArrowUpRight size={14} aria-hidden="true" /></Link>
          </header>
          {tickets.data?.items.length ? <div className="table-scroll" role="region" aria-label="Список последних обращений" tabIndex={0}>
            <table className="data-table manager-home-ticket-table" role="table">
              <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Номер и тема</th><th role="columnheader" scope="col">Клиент</th><th role="columnheader" scope="col">Время</th><th role="columnheader" scope="col">Статус</th></tr></thead>
              <tbody role="rowgroup">{tickets.data.items.map(ticket => <tr key={ticket.id} role="row">
                <td role="cell"><Link to={'/tickets/' + ticket.id}><span>{ticket.id}</span><strong>{ticket.title}</strong></Link></td>
                <td role="cell">{ticket.customer_name || '—'}</td>
                <td role="cell"><time dateTime={ticket.created_at}>{ticketDate.format(new Date(ticket.created_at))}</time></td>
                <td role="cell"><StatusBadge tone={ticketTones[ticket.status]}>{ticketStatuses[ticket.status]}</StatusBadge></td>
              </tr>)}</tbody>
            </table>
          </div> : <PageState loading={tickets.isPending} error={tickets.error} retry={() => void tickets.refetch()} empty="Обращений пока нет" />}
        </section>

        <section className="panel content-panel manager-home-panel" aria-labelledby="manager-incidents-title">
          <header className="manager-home-section-heading">
            <h2 id="manager-incidents-title">Сетевые инциденты</h2>
            <Link to="/incidents" className="text-link manager-home-link">Все инциденты <ArrowUpRight size={14} aria-hidden="true" /></Link>
          </header>
          {incidents?.length ? <ul className="manager-home-incidents">
            {incidents.slice(0, 5).map(incident => <li key={incident.id}>
              <button type="button" className="manager-home-incident" onClick={() => setSelectedIncident(incident)} aria-haspopup="dialog">
                <span className="icon-chip" data-warning="true"><AlertTriangle size={18} aria-hidden="true" /></span>
                <span className="manager-home-incident-copy">
                  <strong>{incident.title}</strong>
                  {incident.address && <span>{incident.address}</span>}
                  {incident.started_at && <time dateTime={incident.started_at}>Обнаружен · {formatDate(incident.started_at)}</time>}
                  {incident.affected_customers != null && <span>Затронуто клиентов · {formatNumber(incident.affected_customers)}</span>}
                </span>
                <span className="manager-home-incident-end"><IncidentStatus incident={incident} /><ArrowRight size={16} aria-hidden="true" /></span>
              </button>
            </li>)}
          </ul> : <PageState loading={dashboard.isPending} error={dashboard.error} retry={() => void dashboard.refetch()} empty="Активных инцидентов нет" />}
        </section>
      </div>

      <dialog ref={incidentDialog} className="panel manager-home-dialog" aria-labelledby="manager-incident-detail-title" onClose={() => setSelectedIncident(undefined)}>
        {selectedIncident && <>
          <header className="manager-home-section-heading"><h2 id="manager-incident-detail-title">{selectedIncident.title}</h2>
            <form method="dialog"><Button type="submit" className="icon-button" variant="ghost" aria-label="Закрыть"><X size={20} aria-hidden="true" /></Button></form>
          </header>
          <IncidentStatus incident={selectedIncident} />
          {selectedIncident.description && <p>{selectedIncident.description}</p>}
          <dl>
            {selectedIncident.address && <div><dt>Адрес</dt><dd>{selectedIncident.address}</dd></div>}
            {selectedIncident.started_at && <div><dt>Время обнаружения</dt><dd>{formatDate(selectedIncident.started_at)}</dd></div>}
            {selectedIncident.estimated_resolution_at && <div><dt>Ожидаемое восстановление</dt><dd>{formatDate(selectedIncident.estimated_resolution_at)}</dd></div>}
            {selectedIncident.affected_customers != null && <div><dt>Затронуто клиентов</dt><dd>{formatNumber(selectedIncident.affected_customers)}</dd></div>}
          </dl>
        </>}
      </dialog>
    </div>
  </>
}
