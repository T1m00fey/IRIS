import { useEffect, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Activity, ArrowUpRight, Bot, Clock3, Headset, History, ListOrdered, PhoneOff, UsersRound, X } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { api } from '../../api/client'
import { PageHeading } from '../../components/PageHeading'
import { Pagination } from '../../components/Pagination'
import { StatusBadge } from '../../components/StatusBadge'
import { Button } from '../../components/ui/button'
import { CallSummary, Transcript } from '../../features/operations/CallContext'
import { callDepartments, employeeStatuses, employeeTones, priorities, specializationDepartments, ticketStatuses, ticketTones } from '../../features/operations/labels'
import { formatDate, formatDuration, formatNumber } from '../../lib/format'
import { useCall } from '../../pages/CallsPage'
import type { Collection, Employee } from '../../types/operations'
import { callState, elapsed, queueStates, teamDepartments, useContactCenterData, type LiveCall, type QueueEntry } from './contact-center-data'
import './contact-center.css'

const views = [ ['live', 'В реальном времени', Activity], ['queue', 'Очереди', ListOrdered], ['history', 'История звонков', History] ] as const
const callEvents: Record<string, string> = {
  'call.started': 'Начало звонка', 'call.connected': 'Соединение установлено', 'call.queued': 'Звонок поставлен в очередь',
  'assignment.offered': 'Звонок предложен сотруднику', 'assignment.accepted': 'Сотрудник принял назначение',
  'assignment.connected': 'Оператор подключился', 'assignment.expired': 'Время ожидания ответа истекло',
  'assignment.declined': 'Сотрудник отклонил назначение', 'assignment.failed': 'Подключение не удалось',
  'assignment.ended': 'Назначение завершено', 'call.ended': 'Звонок завершён',
  'call.handoff': 'Сводка согласована', 'call.summary_reviewed': 'Сводка проверена',
  'ticket.created': 'Обращение создано', 'ticket.updated': 'Обращение обновлено',
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase()
}

function PanelMessage({ text, retry }: { text: string; retry?: () => void }) {
  return <div className="cc-message" role={retry ? 'alert' : 'status'}>
    <span>{text}</span>{retry && <Button onClick={retry}>Повторить</Button>}
  </div>
}

type DepartmentName = (code?: string | null) => string
type OpenCall = (id: string) => void

function CallIdentity({ call, id }: { call?: LiveCall; id: string }) {
  return <><strong>{call?.customer_name || 'Клиент не определён'}</strong><small>{call?.caller_phone_masked || id}</small></>
}

function CallRows({ calls, entries, departmentName, openCall, now, history = false }: {
  calls: LiveCall[]; entries: Map<string, QueueEntry>; departmentName: DepartmentName; openCall: OpenCall; now: number; history?: boolean
}) {
  return <div className="table-scroll cc-table-scroll" role="region" tabIndex={0} aria-label={history ? 'Таблица истории звонков' : 'Таблица активных звонков'}>
    <table className="data-table cc-table cc-calls-table" role="table">
      <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Клиент / причина</th><th role="columnheader" scope="col">Отдел / фаза</th>
        {history && <th role="columnheader" scope="col">Начало</th>}<th role="columnheader" scope="col">Длительность</th>{!history && <th role="columnheader" scope="col">Ответственный</th>}
        <th role="columnheader" scope="col" aria-label="Действия" /></tr></thead>
      <tbody role="rowgroup">{calls.map(call => {
        const entry = entries.get(call.id)
        const state = callState(call, entry)
        const duration = history || call.ended_at ? call.duration_seconds : elapsed(call.connected_at || call.started_at, now)
        const reason = call.summary || entry?.category
        return <tr key={call.id} role="row">
          <td role="cell" className="cc-customer"><button type="button" className="cc-call-link" aria-haspopup="dialog" onClick={() => openCall(call.id)}>
            <CallIdentity call={call} id={call.id} />
          </button>{reason && <span className="cc-reason" title={reason}>{reason}</span>}</td>
          <td role="cell" className="cc-call-state"><span className="cc-cell-line">{departmentName(entry?.department || call.department)}</span><StatusBadge tone={state.tone}>{state.label}</StatusBadge></td>
          {history && <td role="cell" className="numeric"><span className="cc-mobile-label" aria-hidden="true">Начало</span>{formatDate(call.started_at)}</td>}
          <td role="cell" className="numeric cc-nowrap"><span className="cc-mobile-label" aria-hidden="true">Длительность</span>{formatDuration(duration)}</td>
          {!history && <td role="cell"><span className="cc-mobile-label" aria-hidden="true">Ответственный</span>{entry?.assignment?.employee_name || (call.phase === 'ai_active' ? 'ИИ' : '—')}</td>}
          <td role="cell" className="cc-actions-cell"><Button variant="ghost" className="cc-row-action" aria-haspopup="dialog" aria-label={'Открыть звонок ' + call.id} onClick={() => openCall(call.id)}><ArrowUpRight size={16} aria-hidden="true" /></Button></td>
        </tr>
      })}</tbody>
    </table>
  </div>
}

function VoiceQueue({ rows, calls, departmentName, openCall }: {
  rows: QueueEntry[]; calls: Map<string, LiveCall>; departmentName: DepartmentName; openCall: OpenCall
}) {
  return <div className="table-scroll cc-table-scroll" role="region" tabIndex={0} aria-label="Таблица голосовой очереди">
    <table className="data-table cc-table cc-queue-table" role="table">
      <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Клиент</th><th role="columnheader" scope="col">Приоритет</th><th role="columnheader" scope="col">Ожидание</th><th role="columnheader" scope="col">Отдел</th><th role="columnheader" scope="col">Назначение</th></tr></thead>
      <tbody role="rowgroup">{rows.map(row => <tr key={row.call_id} role="row">
        <td role="cell" className="cc-customer"><button type="button" className="cc-call-link" aria-haspopup="dialog" onClick={() => openCall(row.call_id)}>
          <CallIdentity call={calls.get(row.call_id)} id={row.call_id} />
        </button></td>
        <td role="cell"><span className="cc-mobile-label" aria-hidden="true">Приоритет</span><StatusBadge tone={row.priority === 'high' ? 'warning' : 'neutral'}>{priorities[row.priority]}</StatusBadge></td>
        <td role="cell" className="numeric cc-nowrap"><span className="cc-mobile-label" aria-hidden="true">Ожидание</span>{formatDuration(row.waiting_seconds)}</td><td role="cell"><span className="cc-mobile-label" aria-hidden="true">Отдел</span>{departmentName(row.department)}</td>
        <td role="cell"><span className="cc-mobile-label" aria-hidden="true">Назначение</span><StatusBadge tone={queueStates[row.state].tone}>{queueStates[row.state].label}</StatusBadge>
          {row.assignment && <small className="cc-cell-line">{row.assignment.employee_name}</small>}</td>
      </tr>)}</tbody>
    </table>
  </div>
}

function HistoryCalls({ departmentName, openCall, entries, now }: {
  departmentName: DepartmentName; openCall: OpenCall; entries: Map<string, QueueEntry>; now: number
}) {
  const limit = 12
  const [offset, setOffset] = useState(0)
  const query = useQuery({
    queryKey: ['calls', 'contact-center-history', offset],
    queryFn: ({ signal }) => api<Collection<LiveCall>>('/api/v1/calls?limit=' + limit + '&offset=' + offset, { signal }),
    placeholderData: keepPreviousData,
  })
  return <section className="panel cc-panel" aria-labelledby="cc-history-title">
    <header className="cc-heading"><h2 id="cc-history-title">История звонков</h2><Link className="text-link cc-end-link" to="/calls">Полная история <ArrowUpRight size={14} aria-hidden="true" /></Link></header>
    {query.isError ? <PanelMessage text="Не удалось загрузить историю звонков" retry={() => void query.refetch()} /> : query.data?.items.length ? <>
      <CallRows calls={query.data.items} entries={entries} departmentName={departmentName} openCall={openCall} now={now} history />
      {query.data.total > limit && <Pagination offset={query.data.offset} limit={limit} total={query.data.total} setOffset={setOffset} />}
    </> : <PanelMessage text={query.isPending ? 'Загрузка истории…' : 'История звонков пуста'} />}
  </section>
}

function EmployeesPanel({ employees, assigned, departmentName, now }: {
  employees: Employee[]; assigned: Map<string, QueueEntry>; departmentName: DepartmentName; now: number
}) {
  return <ul className="cc-people">
    {employees.map(person => {
      const assignment = assigned.get(person.id)
      const duration = assignment?.state === 'connected' ? elapsed(assignment.assignment?.connected_at, now) : null
      return <li key={person.id}>
        <span className="avatar cc-avatar" aria-hidden="true">{initials(person.full_name)}</span>
        <div className="cc-person"><strong>{person.full_name}</strong><small>{departmentName(person.department)}</small></div>
        <div className="cc-person-status"><StatusBadge tone={employeeTones[person.status]}>{employeeStatuses[person.status]}</StatusBadge>
          {duration !== null && <small className="numeric">{formatDuration(duration)} в разговоре</small>}</div>
      </li>
    })}
  </ul>
}

function CallDrawer({ id, entry, departmentName, onClose }: {
  id: string; entry?: QueueEntry; departmentName: DepartmentName; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const call = useCall(id)
  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])
  const detail = call.data
  const state = detail ? callState(detail, entry) : undefined
  return <dialog ref={dialog} className="cc-drawer" aria-labelledby="cc-drawer-title" onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close() }}>
    <div className="cc-drawer-layout">
      <header className="cc-drawer-heading"><div><h2 id="cc-drawer-title">Карточка звонка</h2><small>{id}</small></div>
        <form method="dialog"><Button type="submit" variant="ghost" className="icon-button" aria-label="Закрыть карточку"><X size={20} aria-hidden="true" /></Button></form>
      </header>
      {detail ? <div className="cc-drawer-body">
        <section className="panel content-panel"><h2>Клиент и звонок</h2><dl className="key-values">
          <div><dt>Клиент</dt><dd>{detail.customer_id ? <Link className="text-link" to={'/customers/' + encodeURIComponent(detail.customer_id) + (detail.account_number ? '?account=' + encodeURIComponent(detail.account_number) : '')}>{detail.customer_name || 'Карточка клиента'}</Link> : detail.customer_name || 'Клиент не определён'}</dd></div>
          <div><dt>Телефон · Лицевой счёт</dt><dd>{detail.caller_phone_masked || '—'} · {detail.account_number || '—'}</dd></div>
          <div><dt>Отдел</dt><dd>{departmentName(entry?.department || detail.department)}</dd></div>
          <div><dt>Текущий сотрудник</dt><dd>{entry?.assignment?.employee_name || '—'}</dd></div>
          <div><dt>Состояние</dt><dd>{state && <StatusBadge tone={state.tone}>{state.label}</StatusBadge>}</dd></div>
        </dl></section>
        <CallSummary call={detail} />
        <section className="panel content-panel"><h2>История состояний</h2>
          {detail.events.length ? <ol className="timeline">{detail.events.map((event, index) => <li key={index}>
            <strong>{callEvents[event.type] || event.type}</strong><small>{formatDate(event.created_at)}</small>
            {typeof event.details === 'string' && <p>{event.details}</p>}
          </li>)}</ol> : <p className="muted">История пуста</p>}
        </section>
        <Transcript call={detail} />
        <section className="panel content-panel"><h2>Связанные обращения</h2>
          {detail.tickets.length ? <ul className="fact-list">{detail.tickets.map(ticket => <li key={ticket.id}>
            <Link className="text-link" to={'/tickets/' + encodeURIComponent(ticket.id)}>{ticket.id} · {ticket.title}</Link>
            <small><StatusBadge tone={ticketTones[ticket.status]}>{ticketStatuses[ticket.status]}</StatusBadge></small>
          </li>)}</ul> : <p className="muted">Связанных обращений нет</p>}
        </section>
      </div> : <PanelMessage text={call.isError ? 'Не удалось загрузить карточку звонка' : 'Загрузка карточки…'} retry={call.isError ? () => void call.refetch() : undefined} />}
    </div>
  </dialog>
}

export function ContactCenter() {
  const { calls, queue, employees } = useContactCenterData()
  const [params, setParams] = useSearchParams()
  const requestedView = params.get('view')
  const view = requestedView === 'queue' || requestedView === 'history' ? requestedView : 'live'
  const [selectedId, setSelectedId] = useState<string>()
  const [department, setDepartment] = useState('')
  const [state, setState] = useState('')
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const configured = queue.data?.departments.length ? queue.data.departments : teamDepartments
  const labels = new Map([...teamDepartments, ...configured].map(item => [item.code, item.name]))
  const departmentName: DepartmentName = code => code ? labels.get(code) ?? callDepartments[code] ?? code : '—'
  const entries = new Map(queue.data?.items.map(item => [item.call_id, item]))
  const assigned = new Map<string, QueueEntry>()
  for (const entry of entries.values()) {
    if (entry.assignment) assigned.set(entry.assignment.employee_id, entry)
  }
  const waiting = queue.data?.enabled ? Array.from(entries.values()).filter(row => row.state !== 'connected') : undefined
  const liveCalls = calls.data?.items
  const callsById = new Map(liveCalls?.map(call => [call.id, call]))
  const staff = employees.data
  const available = staff?.filter(person => person.status === 'available' && !assigned.has(person.id))
  const averageWait = waiting?.length ? waiting.reduce((sum, row) => sum + row.waiting_seconds, 0) / waiting.length : null
  const metrics = [
    [Bot, 'Звонки с ИИ', liveCalls?.filter(call => call.status === 'active' && call.phase === 'ai_active' && !entries.has(call.id)).length],
    [Headset, 'Звонки с операторами', liveCalls?.filter(call => call.status === 'active' && (entries.get(call.id)?.state === 'connected' || (!entries.has(call.id) && call.phase === 'with_operator'))).length],
    [ListOrdered, 'В очереди', waiting?.length],
    [UsersRound, 'Доступные операторы', available?.length],
    ...(averageWait === null ? [] : [[Clock3, 'Среднее ожидание', formatDuration(averageWait)]] as const),
  ] as const
  const filteredQueue = waiting?.filter(row => (!department || row.department === department) && (!state || row.state === state))

  return <>
    <PageHeading title="Контакт-центр" subtitle="Звонки, голосовые очереди и операторы" />
    <div className="cc layout-stack">
      <div className="cc-metrics" aria-label="Показатели контакт-центра">
        {metrics.map(([Icon, label, value]) => <div className="panel cc-metric" key={label}>
          <span className="icon-chip" aria-hidden="true"><Icon size={19} /></span>
          <div><span>{label}</span><strong className={typeof value === 'string' ? 'cc-duration' : undefined}>{typeof value === 'number' ? formatNumber(value) : value ?? '—'}</strong></div>
        </div>)}
      </div>
      <nav className="panel cc-nav" aria-label="Разделы контакт-центра">
        {views.map(([key, label, Icon]) => <Button key={key} variant="ghost" aria-current={view === key ? 'page' : undefined}
          onClick={() => setParams(key === 'live' ? {} : { view: key })}><Icon size={17} aria-hidden="true" />{label}</Button>)}
      </nav>
      <div className="cc-grid">
        <div className="cc-main layout-stack">
          {view === 'live' && <section className="panel cc-panel" aria-labelledby="cc-active-title">
            <header className="cc-heading"><h2 id="cc-active-title">Активные звонки</h2>{liveCalls && <span className="cc-count numeric">{formatNumber(liveCalls.length)}</span>}</header>
            {liveCalls?.length ? <CallRows calls={liveCalls} entries={entries} departmentName={departmentName} openCall={setSelectedId} now={now} />
              : <PanelMessage text={calls.isError ? 'Не удалось загрузить активные звонки' : calls.isPending ? 'Загрузка звонков…' : 'Входящих и активных звонков нет'} retry={calls.isError ? () => void calls.refetch() : undefined} />}
          </section>}
          {view !== 'history' && <section className="panel cc-panel" aria-labelledby="cc-queue-title">
            <header className="cc-heading"><h2 id="cc-queue-title">Очередь звонков</h2>{waiting && <span className="cc-count numeric">{formatNumber(waiting.length)}</span>}</header>
            {queue.isError ? <PanelMessage text="Не удалось загрузить голосовую очередь" retry={() => void queue.refetch()} />
              : queue.data && !queue.data.enabled ? <div className="cc-voice-notice" role="status"><PhoneOff size={17} aria-hidden="true" /><span>Распределение голосовых звонков отключено</span></div>
              : <>
                {view === 'queue' && waiting && <div className="cc-filters">
                  <select className="field" aria-label="Отдел очереди звонков" value={department} onChange={event => setDepartment(event.target.value)}>
                    <option value="">Все отделы</option>{configured.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
                  </select>
                  <select className="field" aria-label="Состояние очереди звонков" value={state} onChange={event => setState(event.target.value)}>
                    <option value="">Все состояния</option>{(['waiting', 'offered', 'connecting'] as const).map(key => <option key={key} value={key}>{queueStates[key].label}</option>)}
                  </select>
                </div>}
                {(view === 'queue' ? filteredQueue : waiting)?.length ? <VoiceQueue rows={(view === 'queue' ? filteredQueue : waiting) || []} calls={callsById} departmentName={departmentName} openCall={setSelectedId} />
                  : <PanelMessage text={queue.isPending ? 'Загрузка очереди…' : (view === 'queue' && (department || state)) ? 'Звонков по выбранным фильтрам нет' : 'Ожидающих звонков нет'} />}
              </>}
          </section>}
          {view === 'history' && <HistoryCalls departmentName={departmentName} entries={entries} openCall={setSelectedId} now={now} />}
        </div>
        <aside className="cc-side layout-stack" aria-label="Сотрудники и загрузка">
          <section className="panel cc-panel" aria-labelledby="cc-people-title">
            <header className="cc-heading"><h2 id="cc-people-title">Сотрудники</h2>{staff && <span className="cc-count numeric">{formatNumber(staff.length)}</span>}</header>
            {staff?.length ? <EmployeesPanel employees={staff} assigned={assigned} departmentName={departmentName} now={now} />
              : <PanelMessage text={employees.isError ? 'Не удалось загрузить сотрудников' : employees.isPending ? 'Загрузка сотрудников…' : 'Сотрудников пока нет'} retry={employees.isError ? () => void employees.refetch() : undefined} />}
          </section>
          <section className="panel cc-panel" aria-labelledby="cc-load-title">
            <header className="cc-heading"><h2 id="cc-load-title">Нагрузка отделов</h2></header>
            <ul className="cc-load">
              {configured.map(item => {
                const specialization = specializationDepartments.get(item.code)
                const matchesDirection = (person: Employee) => specialization
                  ? person.specializations?.includes(specialization)
                  : person.department === item.code
                const team = staff?.filter(matchesDirection)
                const free = available?.filter(person => matchesDirection(person) && (!specialization || person.on_shift)).length
                const count = waiting?.filter(row => row.department === item.code).length
                return <li key={item.code}>
                  <strong>{item.name}</strong>
                  {free !== undefined && count !== undefined && <progress aria-label={'Загрузка · ' + item.name} title="Ожидающие звонки относительно очереди и доступных операторов" max={Math.max(1, count + free)} value={count} />}
                  <dl><div><dt>Сотрудники</dt><dd>{team?.length ?? '—'}</dd></div><div><dt>Доступно</dt><dd>{free ?? '—'}</dd></div><div><dt>В очереди</dt><dd>{count ?? '—'}</dd></div></dl>
                </li>
              })}
            </ul>
          </section>
        </aside>
      </div>
    </div>
    {selectedId && <CallDrawer key={selectedId} id={selectedId} entry={entries.get(selectedId)} departmentName={departmentName} onClose={() => setSelectedId(undefined)} />}
  </>
}
