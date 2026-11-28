import { lazy, Suspense, useState } from 'react'
import { Clock3, Headset, PhoneIncoming, TicketCheck, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'
import { PageHeading } from '../../components/PageHeading'
import { PageState } from '../../components/PageState'
import { Button } from '../../components/ui/button'
import { outcomes as callOutcomes } from '../../features/operations/labels'
import { formatDate, formatDuration, formatNumber } from '../../lib/format'
import type { Call, Ticket } from '../../types/operations'
import { moscowDay, useOperatorWorkspace, usePersonalAnalytics, type PersonalAnalytics } from './data'
import type { Outcome } from './PersonalAnalyticsCharts'
import styles from './PersonalAnalytics.module.css'

const ActivityChart = lazy(() => import('./PersonalAnalyticsCharts').then(charts => ({ default: charts.ActivityChart })))
const OutcomeChart = lazy(() => import('./PersonalAnalyticsCharts').then(charts => ({ default: charts.OutcomeChart })))

const missing = 'Недостаточно данных'
const dayMs = 86_400_000
const signedCount = new Intl.NumberFormat('ru-RU', { signDisplay: 'always' })
const periodFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeZone: 'UTC' })

function shiftDate(day: string, offset: number) {
  return new Date(Date.parse(day) + offset * dayMs).toISOString().slice(0, 10)
}

function formatChange(value: number | null, previous: number | null | undefined, duration = false) {
  if (value == null || previous == null || value === previous) return undefined
  const difference = value - previous
  return duration ? (difference > 0 ? '+' : '−') + formatDuration(Math.abs(difference)) : signedCount.format(difference)
}

function Metric({ name, value, change, icon: Icon }: { name: string; value?: string; change?: string; icon: LucideIcon }) {
  return <div className={'panel v3-metric ' + styles.metric}>
    <span className="icon-chip" aria-hidden="true"><Icon size={22} /></span>
    <div className="metric-copy">
      <div className="metric-caption">{name}</div>
      <strong className={value === undefined ? styles.unavailable : undefined}>{value ?? missing}</strong>
      {change && <small className={styles.change}>{change} к предыдущему периоду</small>}
    </div>
  </div>
}

function Activity({ days }: { days: PersonalAnalytics['daily'] }) {
  const hasActivity = days.some(day => day.accepted_calls > 0 || day.resolved_tickets > 0)
  return <section className="panel content-panel" aria-labelledby="personal-activity">
    <h2 id="personal-activity">Динамика звонков и решённых обращений</h2>
    {hasActivity ? <Suspense fallback={<p className={styles.empty} role="status">График загружается…</p>}>
      <ActivityChart days={days} />
    </Suspense> : <p className={styles.empty}>За выбранный период нет принятых звонков и решённых обращений.</p>}
  </section>
}

function Results({ calls, closedCallIds, limited }: { calls: Call[]; closedCallIds: Set<string>; limited: boolean }) {
  const open = calls.filter(call => !closedCallIds.has(call.id))
  const groups: Outcome[] = [
    { label: 'Решено', count: calls.length - open.length, color: '--primary' },
    { label: 'Создано обращение', count: open.filter(call => call.outcome === 'ticket_created').length, color: '--success' },
    { label: 'Требуется дальнейшая работа', count: open.filter(call => call.outcome === 'unresolved' || call.outcome === 'no_confirmation').length, color: '--warning' },
  ]
  const consultations = open.filter(call => call.outcome === 'answered').length
  const unknown = open.filter(call => call.outcome === 'unknown').length
  if (consultations) groups.push({ label: 'Консультация', count: consultations, color: '--muted-foreground' })
  if (unknown) groups.push({ label: 'Без указанного результата', count: unknown, color: '--foreground' })
  return <section className="panel content-panel" aria-labelledby="personal-outcomes">
    <h2 id="personal-outcomes">Результаты обслуживания</h2>
    {calls.length > 0 ? <>
      <Suspense fallback={<p className={styles.empty} role="status">Диаграмма загружается…</p>}>
        <OutcomeChart outcomes={groups} />
      </Suspense>
      <small className={styles.scope}>«Решено» означает, что связанное обращение закрыто к концу периода.</small>
      {limited && <small className={styles.scope}>По доступной истории, до 30 звонков и 20 обращений.</small>}
    </> : <p className={styles.empty}>За выбранный период в доступной истории нет завершённых звонков.</p>}
  </section>
}

function TicketTopics({ tickets, limited }: { tickets: Ticket[]; limited: boolean }) {
  const topics = new Map<string, { title: string; count: number }>()
  for (const ticket of tickets) {
    const title = ticket.title.trim()
    if (!title) continue
    const key = title.toLocaleLowerCase('ru-RU')
    const topic = topics.get(key) ?? { title, count: 0 }
    topic.count++
    topics.set(key, topic)
  }
  const rows = [...topics.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, 'ru'))
  return <section className="panel content-panel" aria-labelledby="personal-topics">
    <h2 id="personal-topics">Причины обращений</h2>
    <p className={styles.scope}>{limited ? 'Темы из доступной выборки, до 20 обращений.' : 'По темам обращений, созданных за выбранный период.'}</p>
    {rows.length > 0 ? <ul className={styles.topics + ' work-items'}>
      {rows.slice(0, 5).map(topic => <li key={topic.title}>
        <div>
          <span>{topic.title}</span>
          <meter min={0} max={rows[0].count} value={topic.count} aria-hidden="true" />
        </div>
        <strong>{formatNumber(topic.count)}</strong>
      </li>)}
    </ul> : <p className={styles.empty}>За выбранный период в доступной выборке нет обращений.</p>}
  </section>
}

function CallHistory({ calls }: { calls: Call[] }) {
  return <section className="panel content-panel" aria-labelledby="personal-history">
    <h2 id="personal-history">Последние звонки</h2>
    {calls.length > 0 ? <ul className={styles.history + ' work-items'}>
      {calls.slice(0, 5).map(call => <li key={call.id}>
        <div>
          <Link className="text-link" to={'/workspace?call=' + encodeURIComponent(call.id)}>{call.customer_name || call.caller_phone_masked || 'Звонок ' + call.id}</Link>
          <small>{call.outcome === 'unknown' ? 'Без указанного результата' : callOutcomes[call.outcome]} · {formatDate(call.ended_at)}</small>
        </div>
      </li>)}
    </ul> : <p className={styles.empty}>Здесь появятся звонки, которые вы обслужили за выбранный период.</p>}
  </section>
}

export function PersonalAnalyticsPage() {
  const [period, setPeriod] = useState('7')
  const [customStart, setCustomStart] = useState(() => moscowDay(6))
  const [customEnd, setCustomEnd] = useState(() => moscowDay())
  const today = moscowDay()
  const custom = period === 'custom'
  const from = custom ? customStart : moscowDay(Number(period) - 1)
  const to = custom ? customEnd : today
  const length = (Date.parse(to) - Date.parse(from)) / dayMs + 1
  const valid = from >= '0002-01-01' && to <= today && length >= 1 && length <= 366
  const current = usePersonalAnalytics(valid ? from : '', valid ? to : '')
  const compareFrom = valid && to < today ? shiftDate(from, -length) : ''
  const canCompare = compareFrom >= '0002-01-01'
  const comparison = usePersonalAnalytics(canCompare ? compareFrom : '', canCompare ? shiftDate(from, -1) : '')
  const workspace = useOperatorWorkspace(valid)
  const data = current.data
  const previous = comparison.data
  const start = Date.parse(from + 'T00:00:00+03:00')
  const end = Date.parse(to + 'T00:00:00+03:00') + dayMs
  const inPeriod = (timestamp: string | null) => timestamp !== null && Date.parse(timestamp) >= start && Date.parse(timestamp) < end
  const calls = (workspace.data?.history ?? []).filter(call => inPeriod(call.ended_at))
    .sort((a, b) => Date.parse(b.ended_at ?? '') - Date.parse(a.ended_at ?? ''))
  const historyTickets = workspace.data?.tickets ?? []
  const tickets = historyTickets.filter(ticket => inPeriod(ticket.created_at))
  const closedCallIds = new Set<string>()
  for (const ticket of historyTickets) {
    if (ticket.call_id && ticket.status === 'closed' && ticket.closed_at && Date.parse(ticket.closed_at) < end) {
      closedCallIds.add(ticket.call_id)
    }
  }
  const limitedTickets = historyTickets.length >= 20
  const limitedHistory = (workspace.data?.history.length ?? 0) >= 30

  return <>
    <PageHeading title="Моя аналитика" subtitle="Личные показатели обслуживания" />
    <div className={styles.page}>
      <div className="layout-stack">
        <div className={'panel filters ' + styles.filters}>
          <label><span id="personal-period-label">Период</span><select aria-labelledby="personal-period-label" className="field" value={period} onChange={event => {
            const next = event.target.value
            if (next === 'custom') { setCustomStart(from); setCustomEnd(to) }
            setPeriod(next)
          }}>
            <option value="1">Сегодня</option>
            <option value="7">Последние 7 дней</option>
            <option value="30">Последние 30 дней</option>
            <option value="custom">Произвольный период</option>
          </select></label>
          {custom && <>
            <label>С <input className="field" type="date" min="0002-01-01" max={today} value={customStart} onChange={event => setCustomStart(event.target.value)} /></label>
            <label>По <input className="field" type="date" min={customStart || '0002-01-01'} max={today} value={customEnd} onChange={event => setCustomEnd(event.target.value)} /></label>
          </>}
          {valid && <span className={styles.period}>{periodFormat.formatRange(new Date(from), new Date(to))} · МСК</span>}
        </div>
        {!valid ? <p className={'panel ' + styles.feedback} role="status">Выберите период от 1 до 366 дней с датой окончания не позднее сегодняшней.</p>
          : !data ? <PageState loading={current.isPending} error={current.error} retry={() => void current.refetch()} />
          : <>
            <section className={'metrics ' + styles.metrics} aria-label="Личные показатели">
              <Metric name="Принятые звонки" icon={PhoneIncoming} value={formatNumber(data.accepted_calls)} change={formatChange(data.accepted_calls, previous?.accepted_calls)} />
              <Metric name="Решённые обращения" icon={TicketCheck} value={formatNumber(data.resolved_tickets)} change={formatChange(data.resolved_tickets, previous?.resolved_tickets)} />
              <Metric name="Средняя длительность разговора" icon={Clock3} value={data.average_duration_seconds == null ? undefined : formatDuration(data.average_duration_seconds)} change={formatChange(data.average_duration_seconds, previous?.average_duration_seconds, true)} />
              <Metric name="Время на линии" icon={Headset} />
            </section>
            <div className={styles.grid}>
              <Activity days={data.daily} />
              {workspace.data && <Results calls={calls} closedCallIds={closedCallIds} limited={limitedHistory || limitedTickets} />}
              {workspace.data && <TicketTopics tickets={tickets} limited={limitedTickets} />}
              <div className="layout-stack">
                {workspace.data && <CallHistory calls={calls} />}
                <section className="panel content-panel" aria-labelledby="personal-efficiency">
                  <h2 id="personal-efficiency">Эффективность</h2>
                  <dl className={styles.detailList}>
                    <div><dt>Суммарное время соединений</dt><dd>{data.line_seconds == null ? missing : formatDuration(data.line_seconds)}</dd></div>
                  </dl>
                  <p className={styles.scope}>По времени подключения к разговорам.</p>
                </section>
              </div>
            </div>
            {!workspace.data && <div className={'panel ' + styles.feedback} role="status">
              {workspace.isError ? <>Не удалось загрузить личную историю. <Button onClick={() => void workspace.refetch()}>Повторить</Button></> : 'Личная история загружается…'}
            </div>}
          </>}
      </div>
    </div>
  </>
}
