import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Search, SlidersHorizontal, X } from 'lucide-react'
import { useDeferredValue, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { api } from '../../api/client'
import { PageHeading } from '../../components/PageHeading'
import { PageState } from '../../components/PageState'
import { Pagination } from '../../components/Pagination'
import { StatusBadge } from '../../components/StatusBadge'
import { Button } from '../../components/ui/button'
import { departments, priorities, ticketStatuses, ticketTones } from '../operations/labels'
import { formatDate, formatDuration, formatNumber } from '../../lib/format'
import type { Employee, Ticket } from '../../types/operations'
import { countTickets, filterTickets, getMatchingTickets, getTicketCounts, getTicketPage, ticketTabs, unassigned } from './data'
import { TicketDrawer } from './TicketDrawer'
import './management.css'

const pageSize = 12
const syncInterval = 30000
const sortOptions = { newest: 'Сначала новые', queue: 'Приоритет очереди' }
const collator = new Intl.Collator('ru')

function FilterSelect({ label, placeholder, value, options, onChange }: {
  label: string
  placeholder?: string
  value: string
  options: Record<string, string>
  onChange: (value: string) => void
}) {
  return <label className="ticket-control">
    <span>{label}</span>
    <select className="field" value={value} onChange={event => onChange(event.target.value)}>
      {placeholder && <option value="">{placeholder}</option>}
      {Object.entries(options).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
    </select>
  </label>
}

function TicketTable({ tickets, selected, search, onSelect }: {
  tickets: Ticket[]
  selected?: string
  search: string
  onSelect: (id: string) => void
}) {
  return <div className="table-scroll ticket-table-scroll" tabIndex={0} role="region" aria-label="Таблица обращений">
    <table className="data-table ticket-table">
      <thead><tr>
        <th scope="col">Номер</th>
        <th scope="col">Тема</th>
        <th scope="col">Клиент</th>
        <th scope="col">Отдел</th>
        <th scope="col">Приоритет</th>
        <th scope="col">Статус</th>
        <th scope="col">Ответственный</th>
        <th scope="col">Ожидание / обновление</th>
        <th scope="col" className="ticket-row-arrow" />
      </tr></thead>
      <tbody>{tickets.map(ticket => <tr key={ticket.id} data-selected={ticket.id === selected || undefined} onClick={event => {
        if (!(event.target as HTMLElement).closest('a') && !window.getSelection()?.toString()) onSelect(ticket.id)
      }}>
        <td className="ticket-number numeric">{ticket.id}</td>
        <td className="ticket-subject"><Link id={'ticket-link-' + ticket.id} className="table-primary" aria-current={ticket.id === selected ? 'page' : undefined}
          to={{ pathname: '/tickets/' + encodeURIComponent(ticket.id), search }}>{ticket.title}</Link></td>
        <td>{ticket.customer_name || '—'}{ticket.account_number && <span className="table-secondary numeric ticket-account">{ticket.account_number}</span>}</td>
        <td className="ticket-department">{departments[ticket.department]}</td>
        <td><StatusBadge tone={ticket.priority === 'high' ? 'danger' : 'neutral'}>{priorities[ticket.priority]}</StatusBadge></td>
        <td><StatusBadge tone={ticketTones[ticket.status]}>{ticketStatuses[ticket.status]}</StatusBadge></td>
        <td>{ticket.assigned_employee_name || '—'}</td>
        <td className="numeric ticket-time">{ticket.status === 'queued'
          ? formatDuration(ticket.waiting_seconds)
          : formatDate(ticket.closed_at ?? ticket.started_at ?? ticket.created_at)}</td>
        <td className="ticket-row-arrow"><ChevronRight size={15} aria-hidden="true" /></td>
      </tr>)}</tbody>
    </table>
  </div>
}

export function TicketManagement() {
  const { ticketId } = useParams()
  const { search, state } = useLocation()
  const [filters, setFilters] = useSearchParams()
  const navigate = useNavigate()
  const [showAdditional, setShowAdditional] = useState(() => filters.has('account_number') || filters.has('customer_id'))
  const searchInput = useRef<HTMLInputElement>(null)
  const status = ticketTabs.find(tab => tab.status === filters.get('status'))?.status ?? ''
  const department = filters.get('department') ?? ''
  const priority = filters.get('priority') ?? ''
  const assignee = filters.get('assignee') ?? ''
  const account = filters.get('account_number') ?? ''
  const customer = filters.get('customer_id') ?? ''
  const sort = filters.get('sort') === 'queue' ? 'queue' : 'newest'
  const term = filters.get('q') ?? ''
  const deferredTerm = useDeferredValue(term.trim())
  const needsFullList = Boolean(deferredTerm || assignee)
  const requestedOffset = Number(filters.get('offset'))
  const offset = Number.isSafeInteger(requestedOffset) && requestedOffset > 0 ? requestedOffset : 0

  const scope = new URLSearchParams()
  for (const [key, value] of Object.entries({ department, priority, account_number: account, customer_id: customer })) {
    if (value) scope.set(key, value)
  }
  const scopeKey = scope.toString()
  const listFilters = new URLSearchParams(scope)
  listFilters.set('sort', sort)
  const searchKey = listFilters.toString()
  if (status) listFilters.set('status', status)
  const listKey = listFilters.toString()

  const page = useQuery({
    queryKey: ['tickets', 'list', listKey, offset],
    queryFn: ({ signal }) => getTicketPage(listKey, pageSize, offset, signal),
    enabled: !needsFullList,
    refetchInterval: syncInterval,
  })
  const matching = useQuery({
    queryKey: ['tickets', 'search-source', searchKey],
    queryFn: ({ signal }) => getMatchingTickets(searchKey, signal),
    enabled: needsFullList,
    refetchInterval: syncInterval,
  })
  const countsQuery = useQuery({
    queryKey: ['tickets', 'counts', scopeKey],
    queryFn: ({ signal }) => getTicketCounts(scopeKey, signal),
    enabled: !needsFullList,
    refetchInterval: syncInterval,
  })
  const employees = useQuery({
    queryKey: ['employees'],
    queryFn: ({ signal }) => api<Employee[]>('/api/v1/employees', { signal }),
  })
  const results = needsFullList && matching.data ? filterTickets(matching.data, deferredTerm, assignee) : undefined
  const inStatus = results?.filter(ticket => !status || ticket.status === status)
  const counts = needsFullList ? results && countTickets(results) : countsQuery.data
  const total = needsFullList ? inStatus?.length : page.data?.total
  const tickets = needsFullList ? inStatus?.slice(offset, offset + pageSize) : page.data?.items
  const query = needsFullList ? matching : page
  const waiting = term.trim() !== deferredTerm
  const names = new Set(employees.data?.map(employee => employee.full_name))
  for (const ticket of matching.data ?? page.data?.items ?? []) {
    if (ticket.assigned_employee_name) names.add(ticket.assigned_employee_name)
  }
  if (assignee && assignee !== unassigned) names.add(assignee)
  const assignees = { [unassigned]: 'Без назначения', ...Object.fromEntries(
    [...names].sort(collator.compare).map(name => [name, name]),
  ) }

  const lastOffset = total ? Math.floor((total - 1) / pageSize) * pageSize : 0
  useEffect(() => {
    if (total === undefined || waiting || offset <= lastOffset) return
    setFilters(current => {
      const next = new URLSearchParams(current)
      if (lastOffset) next.set('offset', String(lastOffset))
      else next.delete('offset')
      return next
    }, { replace: true, preventScrollReset: true })
  }, [lastOffset, offset, setFilters, total, waiting])

  function change(key: string, value: string, replace = false) {
    const next = new URLSearchParams(filters)
    if (key !== 'offset') next.delete('offset')
    if (value) next.set(key, value)
    else next.delete(key)
    setFilters(next, { replace, preventScrollReset: true })
  }

  function selectTicket(id: string) {
    if (id !== ticketId) void navigate({ pathname: '/tickets/' + encodeURIComponent(id), search }, { preventScrollReset: true })
  }

  useEffect(() => {
    if (ticketId || !state?.returnToTicket || !tickets?.length) return
    const link = document.getElementById('ticket-link-' + state.returnToTicket)
    if (link && document.activeElement === document.body) link.focus({ preventScroll: true })
  }, [state, ticketId, tickets])

  const hasFilters = Boolean(department || priority || status || term || assignee || account || customer || sort !== 'newest')
  return <div className="ticket-management">
    <PageHeading title="Обращения" subtitle="Текущие и закрытые обращения клиентов" />
    <div className={'ticket-management-layout' + (ticketId ? ' has-ticket' : '')}>
      <section className="panel ticket-register" aria-label="Список обращений" aria-busy={waiting || query.isPending}>
        <div className="ticket-tabs" role="group" aria-label="Обращения по статусу">
          {ticketTabs.map(tab => <button type="button" key={tab.status} aria-pressed={status === tab.status}
            onClick={() => change('status', tab.status)}>
            {tab.label}{counts?.[tab.status] !== undefined && <span className="ticket-count">{formatNumber(counts[tab.status])}</span>}
          </button>)}
        </div>
        <div className="ticket-toolbar">
          <div className="ticket-toolbar-fields">
            <label className="ticket-control ticket-search">
              <span>Поиск</span>
              <span className="ticket-search-field">
                <Search aria-hidden="true" size={17} />
                <input ref={searchInput} type="search" className="field" placeholder="Номер, клиент или тема"
                  value={term} onChange={event => change('q', event.target.value, true)} maxLength={200} />
              </span>
            </label>
            <FilterSelect label="Отдел" placeholder="Все отделы" value={department} options={departments} onChange={value => change('department', value)} />
            <FilterSelect label="Статус" placeholder="Все статусы" value={status} options={ticketStatuses} onChange={value => change('status', value)} />
            <FilterSelect label="Приоритет" placeholder="Любой" value={priority} options={priorities} onChange={value => change('priority', value)} />
            <FilterSelect label="Ответственный" placeholder="Все" value={assignee} options={assignees} onChange={value => change('assignee', value)} />
            <FilterSelect label="Сортировка" value={sort} options={sortOptions} onChange={value => change('sort', value === 'newest' ? '' : value)} />
            <Button aria-label="Дополнительные фильтры" aria-expanded={showAdditional} aria-controls="ticket-additional" onClick={() => setShowAdditional(open => !open)} className="ticket-more-button"><SlidersHorizontal size={16} /> Фильтры{(account || customer) && <span className="ticket-more-indicator" />}</Button>
          </div>
          <div id="ticket-additional" className="ticket-additional" hidden={!showAdditional}>
            <div className="ticket-toolbar-fields">
              <label className="ticket-control">Лицевой счёт<input className="field" value={account} onChange={event => change('account_number', event.target.value, true)} /></label>
              <label className="ticket-control">ID клиента<input className="field" value={customer} onChange={event => change('customer_id', event.target.value, true)} /></label>
            </div>
          </div>
          {hasFilters && <Button variant="ghost" className="ticket-reset" onClick={() => {
            setFilters({}, { preventScrollReset: true })
            searchInput.current?.focus()
          }}><X size={14} /> Сбросить фильтры</Button>}
        </div>
        {tickets?.length ? <TicketTable tickets={tickets} selected={ticketId} search={search} onSelect={selectTicket} /> :
          <PageState loading={waiting || query.isPending || (total !== undefined && offset > lastOffset)} error={query.error}
            retry={() => void query.refetch()} empty={hasFilters ? 'По этим фильтрам обращений нет' : 'Обращений пока нет'} />}
        {total !== undefined && total > 0 && offset <= lastOffset && <Pagination total={total} offset={offset} limit={pageSize}
          setOffset={value => change('offset', value ? String(value) : '')} />}
      </section>
      {ticketId && <TicketDrawer key={ticketId} ticketId={ticketId} search={search} />}
    </div>
  </div>
}
