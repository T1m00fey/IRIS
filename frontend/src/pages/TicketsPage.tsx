import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRightLeft, Check, Play, Sparkles, X } from 'lucide-react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'
import { useState } from 'react'
import { api, ApiError } from '../api/client'
import { PageHeading } from '../components/PageHeading'
import { PageState } from '../components/PageState'
import { Pagination } from '../components/Pagination'
import { StatusBadge } from '../components/StatusBadge'
import { Button } from '../components/ui/button'
import { departments, priorities, ticketStatuses, ticketTones } from '../features/operations/labels'
import { formatDate, formatDuration } from '../lib/format'
import type { CallDetail, Collection, Department, Ticket, TicketStatus } from '../types/operations'
import { TicketManagement } from '../features/tickets/TicketManagement'
import '../features/tickets/tickets.css'

const limit = 12

export function TicketsPage({ queue = false }: { queue?: boolean }) {
  return queue ? <QueuePage queue /> : <TicketManagement />
}

function QueuePage({ queue }: { queue: boolean }) {
  const { ticketId } = useParams()
  const [filters, setFilters] = useSearchParams()
  const status = filters.get('status') ?? (queue ? 'queued' : '')
  const department = filters.get('department') || ''
  const priority = filters.get('priority') || ''
  const offset = Math.max(0, Math.trunc(Number(filters.get('offset'))) || 0)
  const sort = filters.get('sort') === 'queue' ? 'queue' : queue ? 'queue' : 'newest'
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset), sort })
  for (const [key, value] of Object.entries({ status, department, priority })) if (value) params.set(key, value)
  const query = useQuery({ queryKey: ['tickets', 'list', params.toString()], queryFn: ({ signal }) => api<Collection<Ticket>>('/api/v1/tickets?' + params, { signal }), refetchInterval: status === 'closed' ? false : 30000 })
  function change(key: string, value: string) {
    const next = new URLSearchParams(filters)
    next.delete('offset')
    if (value || key === 'status') next.set(key, value)
    else next.delete(key)
    setFilters(next)
  }
  const isFiltered = Boolean(department || priority || filters.has('sort') || status !== (queue ? 'queued' : ''))
  return <div className="ticket-screen">
    <PageHeading title={queue ? 'Очередь обращений' : 'Обращения'} subtitle={queue ? 'Распределение обращений и начало обработки' : 'Текущие и закрытые обращения клиентов'} />
    <div className={'ticket-workbench' + (ticketId ? ' ticket-workbench-selected' : '')}>
    <section className="panel ticket-list" aria-label="Список обращений" aria-busy={query.isFetching}>
    <div className="ticket-filters filters">
      <label className="filter-label">Отдел<select className="field" value={department} onChange={event => change('department', event.target.value)}><option value="">Все отделы</option>{Object.entries(departments).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="filter-label">Статус<select className="field" value={status} onChange={event => change('status', event.target.value)}><option value="">Все статусы</option>{Object.entries(ticketStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="filter-label">Приоритет<select className="field" value={priority} onChange={event => change('priority', event.target.value)}><option value="">Все приоритеты</option>{Object.entries(priorities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {!queue && <label className="filter-label">Сортировка<select className="field" value={sort} onChange={event => change('sort', event.target.value === 'queue' ? 'queue' : '')}><option value="newest">Сначала новые</option><option value="queue">По приоритету очереди</option></select></label>}
      {isFiltered && <Button variant="ghost" onClick={() => setFilters({})}>Сбросить</Button>}
    </div>
    {query.isPending || query.isError || !query.data.items.length ? <PageState loading={query.isPending} error={query.error} retry={() => void query.refetch()} empty={offset ? 'На этой странице обращений нет' : isFiltered ? 'По этим фильтрам обращений нет' : queue ? 'Очередь пуста' : 'Обращений пока нет'} /> : <>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Таблица обращений"><table className="data-table"><thead><tr>
        <th scope="col">Обращение</th><th scope="col">Отдел</th><th scope="col">Статус</th><th scope="col">Приоритет</th><th scope="col" className="ticket-list-extra">Ожидание</th><th scope="col" className="ticket-list-extra">Сотрудник</th><th scope="col" className="ticket-list-extra">Создано</th>
      </tr></thead><tbody>{query.data.items.map(ticket => <tr key={ticket.id} className={ticket.id === ticketId ? 'ticket-list-active' : undefined}>
        <td className="ticket-title"><Link className="table-primary" aria-current={ticket.id === ticketId ? 'page' : undefined} to={{ pathname: '/tickets/' + encodeURIComponent(ticket.id), search: filters.toString() }} state={{ fromQueue: queue }}>{ticket.title}</Link><span className="table-secondary">{ticket.id}{ticket.customer_name ? ' · ' + ticket.customer_name : ''}</span></td>
        <td>{departments[ticket.department]}</td><td><StatusBadge tone={ticketTones[ticket.status]}>{ticketStatuses[ticket.status]}</StatusBadge></td>
        <td><StatusBadge tone={ticket.priority === 'high' ? 'danger' : 'neutral'}>{priorities[ticket.priority]}</StatusBadge></td><td className="numeric ticket-list-extra">{formatDuration(ticket.waiting_seconds)}</td><td className="ticket-list-extra">{ticket.assigned_employee_name || '—'}</td><td className="numeric ticket-list-extra">{formatDate(ticket.created_at)}</td>
      </tr>)}</tbody></table></div>
    </>}
    {query.data && query.data.total > 0 && <Pagination total={query.data.total} offset={offset} limit={limit} setOffset={value => { const next = new URLSearchParams(filters); next.set('offset', String(value)); setFilters(next) }} />}
    </section>
    {ticketId && <TicketDrawer key={ticketId} ticketId={ticketId} />}
    </div>
  </div>
}

function TicketDetails({ ticket }: { ticket: Ticket }) {
  const client = useQueryClient()
  const [department, setDepartment] = useState<Department | ''>('')
  const [feedback, setFeedback] = useState('')
  const update = useMutation({
    mutationFn: (patch: { status?: TicketStatus; department?: Department }) => api<Ticket>('/api/v1/tickets/' + encodeURIComponent(ticket.id), { method: 'PATCH', body: JSON.stringify(patch) }),
    onMutate: () => setFeedback(''),
    onSuccess: (updated, patch) => {
      client.setQueryData(['tickets', ticket.id], updated)
      for (const key of ['tickets', 'dashboard', 'calls', 'customers']) void client.invalidateQueries({ queryKey: [key] })
      setDepartment('')
      setFeedback(patch.department ? 'Обращение перенаправлено' : patch.status === 'closed' ? 'Обращение закрыто' : 'Обращение принято в работу')
    },
  })
  return <div className="ticket-drawer-content">
      {ticket.call_id && <TicketCallContext callId={ticket.call_id} />}
      <section className="ticket-block"><h3>Содержание обращения</h3><p className="summary-main">{ticket.summary || ticket.title}</p>
        <div className="actions">
          {ticket.status === 'queued' && <Button variant="primary" disabled={update.isPending} onClick={() => update.mutate({ status: 'in_progress' })}><Play size={14} /> Начать обработку</Button>}
          {ticket.status === 'in_progress' && <Button variant="primary" disabled={update.isPending} onClick={() => update.mutate({ status: 'closed' })}><Check size={14} /> Закрыть обращение</Button>}
          {ticket.call_id && <Button asChild><Link to={'/calls/' + ticket.call_id}>Открыть звонок</Link></Button>}
        </div>
      </section>
      {ticket.status !== 'closed' && <section className="ticket-block"><h3>Перенаправление</h3><div className="actions">
        <select aria-label="Новый отдел" className="field" value={department} onChange={event => setDepartment(event.target.value as Department | '')}>
          <option value="">Выберите отдел</option>{Object.entries(departments).filter(([key]) => key !== ticket.department).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <Button disabled={!department || update.isPending} onClick={() => { if (department) update.mutate({ department }) }}><ArrowRightLeft size={14} /> Перенаправить</Button>
      </div></section>}
      {update.isError && <p className="alert" role="alert">{update.error.message}</p>}
      {feedback && <p className="success" role="status">{feedback}</p>}
    <section className="ticket-block"><h3>Клиент и обработка</h3><dl className="key-values ticket-context-grid">
      <div><dt>Клиент</dt><dd>{ticket.customer_id ? <Link className="text-link" to={'/customers/' + ticket.customer_id}>{ticket.customer_name || 'Карточка клиента'}</Link> : ticket.customer_name || '—'}</dd></div>
      <div><dt>Лицевой счёт</dt><dd>{ticket.account_number || '—'}</dd></div>
      <div><dt>Статус</dt><dd><StatusBadge tone={ticketTones[ticket.status]}>{ticketStatuses[ticket.status]}</StatusBadge></dd></div>
      <div><dt>Отдел · Приоритет</dt><dd>{departments[ticket.department]} · {priorities[ticket.priority]}</dd></div>
      <div><dt>Сотрудник</dt><dd>{ticket.assigned_employee_name || 'Ожидает назначения'}</dd></div>
      <div><dt>Ожидание</dt><dd>{formatDuration(ticket.waiting_seconds)}</dd></div>
    </dl></section>
    <section className="ticket-block"><h3>История обработки</h3>
      <ol className="timeline">
        <li><strong>Обращение создано</strong><small>{formatDate(ticket.created_at)}</small></li>
        {ticket.started_at && <li><strong>Обработка началась</strong><small>{formatDate(ticket.started_at)}</small></li>}
        {ticket.closed_at && <li><strong>Обращение закрыто</strong><small>{formatDate(ticket.closed_at)}</small></li>}
      </ol>
    </section>
  </div>
}

function TicketCallContext({ callId }: { callId: string }) {
  const { data: call } = useQuery({ queryKey: ['calls', callId], queryFn: ({ signal }) => api<CallDetail>('/api/v1/calls/' + encodeURIComponent(callId), { signal }), retry: false })
  const summary = call?.handoff?.summary ?? call?.summary
  if (!summary) return null
  const handoff = call?.handoff
  return <section className="ticket-block ticket-ai">
    <h3><Sparkles size={16} /> Сводка ИИ</h3>
    <p>{summary}</p>
    {handoff?.customer_request && <p><strong>Основная проблема</strong><br />{handoff.customer_request}</p>}
    {handoff?.open_question && <p><strong>Открытый вопрос</strong><br />{handoff.open_question}</p>}
    {handoff?.secondary_questions.length ? <ul>{handoff.secondary_questions.map((question, index) => <li key={index}>{question}</li>)}</ul> : null}
    {!!call?.ai_actions.length && <details className="disclosure">
      <summary>Выполненные действия</summary>
      <ul>{call.ai_actions.map((item, index) => <li key={index}>{item.action}{item.result && ' · ' + item.result}</li>)}</ul>
    </details>}
  </section>
}

function TicketDrawer({ ticketId }: { ticketId: string }) {
  const { search, state } = useLocation()
  const query = useQuery({
    queryKey: ['tickets', ticketId],
    queryFn: ({ signal }) => api<Ticket>('/api/v1/tickets/' + encodeURIComponent(ticketId), { signal }),
    retry: (attempt, error) => !(error instanceof ApiError && error.status === 404) && attempt < 1,
  })
  const notFound = query.error instanceof ApiError && query.error.status === 404
  return <aside className="panel ticket-drawer" aria-labelledby="ticket-drawer-title">
    <header className="ticket-drawer-header">
      <div><small className="muted">{ticketId}</small><h2 id="ticket-drawer-title">{query.data?.title ?? 'Карточка обращения'}</h2></div>
      <Button variant="ghost" asChild><Link aria-label="Закрыть карточку обращения" to={{ pathname: state?.fromQueue ? '/queues' : '/tickets', search }}><X size={17} /></Link></Button>
    </header>
    {!query.data ? <PageState loading={query.isPending} error={notFound ? null : query.error} retry={() => void query.refetch()} empty="Обращение не найдено" /> : <TicketDetails key={query.data.id} ticket={query.data} />}
  </aside>
}

export function TicketPage() {
  const { ticketId = '' } = useParams()
  const { state, search } = useLocation()
  if (!state?.fromQueue) return <TicketsPage />
  return <div className="ticket-queue-detail">
    <Button asChild variant="ghost"><Link to={{ pathname: '/queues', search }}><ArrowLeft size={16} /> Очередь</Link></Button>
    <TicketDrawer ticketId={ticketId} />
  </div>
}
