import { useEffect, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { ArrowUpRight, Bell, CalendarDays, CircleAlert, Clock3, Headset, ListChecks, ListOrdered, PhoneIncoming, TicketCheck, Wifi, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'
import { api } from '../../api/client'
import { useUser } from '../../app/session'
import { PageHeading } from '../../components/PageHeading'
import { PageState } from '../../components/PageState'
import { StatusBadge } from '../../components/StatusBadge'
import { Button } from '../../components/ui/button'
import { departments, employeeStatuses, employeeTones, outcomes, priorities, ticketStatuses, ticketTones } from '../../features/operations/labels'
import type { CustomerDetail, Incident } from '../../features/crm/types'
import { formatDate, formatDuration, formatNumber } from '../../lib/format'
import type { Call, Ticket } from '../../types/operations'
import { moscowDay, useOperatorWorkspace, usePersonalAnalytics, type OperatorWorkspace } from './data'
import styles from './OperatorHome.module.css'

type HomeTicket = Ticket & { queued_at?: string }
type FinishedCall = Call & { ended_at: string }

const dayFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'full', timeZone: 'Europe/Moscow' })
const countDelta = new Intl.NumberFormat('ru-RU', { signDisplay: 'exceptZero' })
const workspaceTicketLimit = 20
const ticketLimit = 6
const callLimit = 4

function useToday() {
  const [today, setToday] = useState(() => moscowDay())
  useEffect(() => {
    const update = () => setToday(moscowDay())
    const interval = window.setInterval(update, 30_000)
    window.addEventListener('focus', update)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', update)
    }
  }, [])
  return today
}

function ticketUpdatedAt(ticket: HomeTicket) {
  return ticket.closed_at ?? ticket.started_at ?? ticket.queued_at ?? ticket.created_at
}

function openTicketCount(total: number, open: number) {
  if (total < workspaceTicketLimit) return formatNumber(open)
  return open ? '≥ ' + formatNumber(open) : undefined
}

function Metric({ label, value, icon: Icon, change }: { label: string; value?: string; icon: LucideIcon; change?: string }) {
  return <div className="panel v3-metric">
    <span className="icon-chip" aria-hidden="true"><Icon size={22} /></span>
    <div className="metric-copy">
      <div className="metric-caption">{label}</div>
      <strong>{value ?? '—'}</strong>
      {change && <span className={styles.metricChange}>{change} к вчерашнему дню</span>}
    </div>
  </div>
}

function countChange(current?: number, previous?: number) {
  return current !== undefined && previous !== undefined && previous > 0
    ? countDelta.format(current - previous) : undefined
}

function durationChange(current?: number | null, previous?: number | null) {
  if (current == null || previous == null || previous <= 0) return undefined
  const delta = current - previous
  const sign = delta === 0 ? '' : delta > 0 ? '+' : '−'
  return sign + formatDuration(Math.abs(delta))
}

function WorkStatus({ employee }: { employee: OperatorWorkspace['employee'] }) {
  return <StatusBadge tone={employeeTones[employee.status]}>{employeeStatuses[employee.status]}</StatusBadge>
}

function Empty({ icon: Icon, children }: { icon: LucideIcon; children: string }) {
  return <p className={styles.empty}><Icon size={18} aria-hidden="true" />{children}</p>
}

function TicketList({ tickets }: { tickets: HomeTicket[] }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? tickets : tickets.slice(0, ticketLimit)
  return <section className={styles.tablePanel + ' panel'} aria-labelledby="home-tickets">
    <div className="panel-heading"><h2 id="home-tickets">Мои обращения</h2></div>
    {tickets.length === 0 ? <Empty icon={ListChecks}>У вас пока нет обращений.</Empty> : <div className={styles.tableScroll + ' table-scroll'}>
      <table className={styles.tickets + ' data-table'} aria-labelledby="home-tickets" role="table">
        <thead role="rowgroup"><tr role="row">
          <th scope="col" role="columnheader">Тема</th>
          <th scope="col" role="columnheader">Клиент</th>
          <th scope="col" role="columnheader">Статус</th>
          <th scope="col" role="columnheader">Приоритет</th>
          <th scope="col" role="columnheader">Обновлено</th>
        </tr></thead>
        <tbody id="home-ticket-rows" role="rowgroup">{visible.map(ticket => {
          const updated = ticketUpdatedAt(ticket)
          return <tr key={ticket.id} role="row">
            <th scope="row" role="rowheader">
              <Link to={'/operator/tickets/' + encodeURIComponent(ticket.id)}>
                <span>{ticket.title}</span><ArrowUpRight size={14} aria-hidden="true" />
              </Link>
              <small>{ticket.id}</small>
            </th>
            <td role="cell"><span className={styles.mobileLabel} aria-hidden="true">Клиент</span>{ticket.customer_name ?? '—'}</td>
            <td role="cell"><span className={styles.mobileLabel} aria-hidden="true">Статус</span><StatusBadge tone={ticketTones[ticket.status]}>{ticketStatuses[ticket.status]}</StatusBadge></td>
            <td role="cell"><span className={styles.mobileLabel} aria-hidden="true">Приоритет</span><span className={ticket.priority === 'high' ? styles.highPriority : undefined}>{priorities[ticket.priority]}</span></td>
            <td role="cell"><span className={styles.mobileLabel} aria-hidden="true">Обновлено</span><time dateTime={updated}>{formatDate(updated)}</time></td>
          </tr>
        })}</tbody>
      </table>
    </div>}
    {tickets.length > ticketLimit && <div className={styles.tableFooter}>
      <Button aria-expanded={expanded} aria-controls="home-ticket-rows" onClick={() => setExpanded(!expanded)}>
        {expanded ? 'Свернуть список' : 'Показать все доступные обращения'}
      </Button>
    </div>}
  </section>
}

function Queue({ data, department }: { data: OperatorWorkspace; department: string }) {
  const { employee } = data
  return <section className="panel content-panel" aria-labelledby="home-queue">
    <h2 id="home-queue"><ListOrdered size={18} aria-hidden="true" />Очередь моего отдела</h2>
    <dl className={styles.details}>
      <div><dt>Отдел</dt><dd>{department}</dd></div>
      <div><dt>Ожидающие звонки</dt><dd className={styles.queueCount}>{formatNumber(data.waiting_calls)}</dd></div>
      <div><dt>Рабочий статус</dt><dd><WorkStatus employee={employee} /></dd></div>
      {employee.on_shift !== undefined && <div><dt>Смена</dt><dd>{employee.on_shift ? 'На смене' : 'Вне смены'}</dd></div>}
    </dl>
  </section>
}

function Notifications({ data, urgentTickets }: { data: OperatorWorkspace; urgentTickets: Ticket[] }) {
  const offered = data.assignment?.state === 'offered' ? data.assignment : null
  const hasAlerts = offered || !data.voice_available || urgentTickets.length > 0
  return <section className="panel content-panel" aria-labelledby="home-notifications">
    <h2 id="home-notifications"><Bell size={18} aria-hidden="true" />Важные уведомления</h2>
    {hasAlerts ? <ul className={styles.notifications + ' work-items'}>
      {offered && <li><PhoneIncoming size={17} aria-hidden="true" /><Link className="text-link" to={'/workspace?call=' + encodeURIComponent(offered.call_id)}>Вам предложен входящий звонок</Link></li>}
      {!data.voice_available && <li><CircleAlert size={17} aria-hidden="true" /><span>Подключение Voice недоступно.</span></li>}
      {urgentTickets.map(ticket => <li key={ticket.id}>
        <CircleAlert size={17} aria-hidden="true" />
        <div><strong>Высокий приоритет</strong><Link className="text-link" to={'/operator/tickets/' + encodeURIComponent(ticket.id)}>{ticket.title}</Link></div>
      </li>)}
    </ul> : <Empty icon={Bell}>Новых важных уведомлений нет.</Empty>}
  </section>
}

function RecentCalls({ calls }: { calls: FinishedCall[] }) {
  return <section className={styles.tablePanel + ' panel'} aria-labelledby="home-calls">
    <div className="panel-heading"><h2 id="home-calls"><PhoneIncoming size={18} aria-hidden="true" />Последние обслуженные звонки</h2></div>
    {calls.length ? <ul className={styles.callList + ' work-items'}>
      {calls.map(call => <li key={call.id}>
        <div>
          <Link className="text-link" to={'/workspace?call=' + encodeURIComponent(call.id)}>{call.customer_name || call.caller_phone_masked || 'Звонок ' + call.id}</Link>
          <small>{outcomes[call.outcome]}</small>
        </div>
        <div className={styles.callTime}>
          <time dateTime={call.ended_at}>{formatDate(call.ended_at)}</time>
          {call.duration_seconds !== null && <small>{formatDuration(call.duration_seconds)}</small>}
        </div>
      </li>)}
    </ul> : <Empty icon={PhoneIncoming}>Здесь появятся звонки, которые вы обслужили.</Empty>}
  </section>
}

function NetworkIncidents({ records }: { records: (Call | Ticket)[] }) {
  const accountsByCustomer = new Map<string, Set<string>>()
  for (const record of records) {
    if (!record.customer_id || !record.account_number) continue
    const accounts = accountsByCustomer.get(record.customer_id) ?? new Set<string>()
    accounts.add(record.account_number)
    accountsByCustomer.set(record.customer_id, accounts)
  }
  const customers = [...accountsByCustomer.keys()]
  const queries = useQueries({ queries: customers.map(customerId => ({
    queryKey: ['operator', 'customers', customerId],
    queryFn: ({ signal }: { signal: AbortSignal }) => api<CustomerDetail>('/api/v1/operator/customers/' + encodeURIComponent(customerId), { signal }),
  })) })
  const incidentsById = new Map<string, Incident & { addresses: Set<string> }>()
  queries.forEach(({ data }, index) => {
    const numbers = accountsByCustomer.get(customers[index])
    for (const account of data?.accounts ?? []) {
      if (!numbers?.has(account.number)) continue
      for (const incident of account.active_incidents) {
        if (incident.status === 'resolved') continue
        const item = incidentsById.get(incident.id) ?? { ...incident, addresses: new Set<string>() }
        item.addresses.add(account.address)
        incidentsById.set(incident.id, item)
      }
    }
  })
  const incidents = [...incidentsById.values()].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
  const loading = queries.some(query => query.isPending)
  const failed = queries.filter(query => query.isError)
  return <section className="panel content-panel" aria-labelledby="home-incidents">
    <h2 id="home-incidents"><Wifi size={18} aria-hidden="true" />Сетевые инциденты</h2>
    {incidents.length > 0 && <ul className={styles.incidents + ' work-items'}>
      {incidents.map(incident => <li key={incident.id}>
        <div>
          <strong>{incident.title}</strong>
          <small>{[...incident.addresses].join(' · ')}</small>
          {incident.estimated_resolution_at && <small>Плановое восстановление {formatDate(incident.estimated_resolution_at)}</small>}
        </div>
        <StatusBadge tone={incident.status === 'open' ? 'warning' : 'info'}>{incident.status === 'open' ? 'Открыт' : 'Диагностика'}</StatusBadge>
      </li>)}
    </ul>}
    {failed.length > 0 ? <div className={styles.feedback} role="status">
      <span>{incidents.length > 0 ? 'Часть данных об инцидентах недоступна.' : 'Не удалось проверить сетевые инциденты.'}</span>
      <Button onClick={() => failed.forEach(query => void query.refetch())}>Повторить</Button>
    </div> : loading ? <p className={styles.feedback} role="status">Проверяем сетевые инциденты…</p> : incidents.length === 0 && <Empty icon={Wifi}>
      {customers.length ? 'По вашим обращениям и звонкам активных инцидентов нет.' : 'Инциденты появятся, если затронут счета из ваших обращений или звонков.'}
    </Empty>}
  </section>
}

export function OperatorHome() {
  const user = useUser()
  const today = useToday()
  const date = new Date(today + 'T00:00:00+03:00')
  const yesterday = new Date(date.getTime() - 1).toISOString().slice(0, 10)
  const workspace = useOperatorWorkspace()
  const analytics = usePersonalAnalytics(today, today)
  const previous = usePersonalAnalytics(yesterday, yesterday).data
  const data = workspace.data
  const employee = data?.employee
  const department = employee ? departments[employee.department] || employee.department : undefined
  const dateLabel = dayFormat.format(date)
  const tickets = [...(data?.tickets ?? [])].sort((a, b) => Date.parse(ticketUpdatedAt(b)) - Date.parse(ticketUpdatedAt(a)))
  const calls = (data?.history ?? []).filter((call): call is FinishedCall => Boolean(call.ended_at))
    .sort((a, b) => Date.parse(b.ended_at) - Date.parse(a.ended_at))
    .slice(0, callLimit)
  const activeTickets = tickets.filter(ticket => ticket.status !== 'closed')
  const urgentTickets = activeTickets.filter(ticket => ticket.priority === 'high')
  const unresolved = data ? openTicketCount(tickets.length, activeTickets.length) : undefined
  const { accepted_calls, resolved_tickets, line_seconds } = analytics.data ?? {}

  return <>
    <PageHeading title="Главная" subtitle={'Добро пожаловать, ' + user.full_name.trim().split(/\s+/)[0]} actions={
      <Button variant="primary" asChild><Link to="/workspace"><Headset size={18} aria-hidden="true" />Перейти на рабочее место</Link></Button>
    } />
    <div className={styles.home}>
      <div className="layout-stack">
        <div className={styles.profile}>
          <time dateTime={today}><CalendarDays size={17} aria-hidden="true" />{dateLabel}</time>
          {employee && <dl>
            <div><dt>Отдел</dt><dd>{department}</dd></div>
            <div><dt>Специализация</dt><dd>{employee.skills?.length ? employee.skills.map(skill => departments[skill as keyof typeof departments] ?? skill).join(', ') : 'Не указана'}</dd></div>
            <div><dt>Рабочий статус</dt><dd><WorkStatus employee={employee} /></dd></div>
          </dl>}
        </div>
        <section className={styles.metrics + ' metrics'} aria-label="Личные показатели">
          <Metric label="Принятые сегодня звонки" value={accepted_calls === undefined ? undefined : formatNumber(accepted_calls)} icon={PhoneIncoming} change={countChange(accepted_calls, previous?.accepted_calls)} />
          <Metric label="Решённые сегодня обращения" value={resolved_tickets === undefined ? undefined : formatNumber(resolved_tickets)} icon={TicketCheck} change={countChange(resolved_tickets, previous?.resolved_tickets)} />
          <Metric label="Незавершённые обращения" value={unresolved} icon={ListChecks} />
          <Metric label="Время в соединении сегодня" value={line_seconds == null ? undefined : formatDuration(line_seconds)} icon={Clock3} change={durationChange(line_seconds, previous?.line_seconds)} />
        </section>
        {analytics.isError && !analytics.data && <div className={styles.feedback + ' panel'} role="status">
          <span>Не удалось загрузить личную статистику.</span>
          <Button onClick={() => void analytics.refetch()}>Повторить</Button>
        </div>}
        {data && department ? <>
          <div className={styles.columns}>
            <div className="layout-stack">
              <TicketList tickets={tickets} />
              <RecentCalls calls={calls} />
            </div>
            <div className="layout-stack">
              <Queue data={data} department={department} />
              <Notifications data={data} urgentTickets={urgentTickets} />
              <NetworkIncidents records={[...activeTickets, ...data.calls.filter(call => call.id === data.call_id && data.assignment?.state !== 'offered'), ...calls]} />
            </div>
          </div>
        </> : <PageState loading={workspace.isPending} error={workspace.error} retry={() => void workspace.refetch()} />}
      </div>
    </div>
  </>
}
