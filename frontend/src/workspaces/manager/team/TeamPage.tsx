import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ArrowDownUp, CalendarDays, ChevronRight, CircleOff, Headset, Layers3, MoreHorizontal, Pause, Phone, Search, ShieldCheck, SlidersHorizontal, UsersRound, Wifi, X } from 'lucide-react'
import { PageHeading } from '../../../components/PageHeading'
import { PageState } from '../../../components/PageState'
import { Pagination } from '../../../components/Pagination'
import { StatusBadge } from '../../../components/StatusBadge'
import { Button } from '../../../components/ui/button'
import { MetricCard } from '../../../components/ui/MetricCard'
import { employeeStatuses, employeeTones } from '../../../features/operations/labels'
import { formatDate, formatDuration, formatNumber } from '../../../lib/format'
import { useAnalytics } from '../../../pages/AnalyticsPage'
import type { Employee, EmployeeStatus } from '../../../types/operations'
import { teamDepartments, useTeam, useTeamCalls, type ConnectedCall } from './data'
import './team.css'

const tabs = [
  { id: 'employees', label: 'Сотрудники' }, { id: 'departments', label: 'Отделы' },
  { id: 'schedule', label: 'График смен' }, { id: 'roles', label: 'Роли и доступы' },
] as const

type Tab = typeof tabs[number]['id']
const metrics = [
  { id: 'total', label: 'Всего сотрудников', icon: UsersRound },
  { id: 'available', label: 'На линии', icon: Headset },
  { id: 'busy', label: 'Заняты', icon: Phone },
  { id: 'paused', label: 'На паузе', icon: Pause },
  { id: 'offline', label: 'Офлайн', icon: CircleOff },
] as const
const statuses: EmployeeStatus[] = ['available', 'busy', 'paused', 'lunch', 'wrap_up', 'offline']
const departmentIcons = { technical_support: Headset, billing: Layers3, connection: Wifi }
const percent = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 0 })
const pageSize = 10
const noShifts = 'Расписание смен недоступно в текущей конфигурации'

function CallLink({ call, now }: { call: ConnectedCall; now: number }) {
  const since = call.assignment?.connected_at
  return <Link className="team-call" to={'/calls/' + encodeURIComponent(call.call_id)} aria-label={'Открыть звонок ' + call.call_id}>
    <Phone size={14} aria-hidden="true" />{since ? formatDuration((now - Date.parse(since)) / 1000) : 'Открыть'}
  </Link>
}

function EmployeeActions({ person, call, showDetails }: { person: Employee; call?: ConnectedCall; showDetails: () => void }) {
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()
  return <>
    <Button className="icon-button team-row-action" variant="ghost" popoverTarget={id}
      aria-label={'Действия для сотрудника ' + person.full_name} onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect()
        const popup = menu.current!
        popup.style.right = Math.max(8, window.innerWidth - rect.right) + 'px'
        const placeBelow = rect.bottom + 112 <= window.innerHeight
        popup.style.top = placeBelow ? rect.bottom + 4 + 'px' : 'auto'
        popup.style.bottom = placeBelow ? 'auto' : window.innerHeight - rect.top + 4 + 'px'
      }}><MoreHorizontal size={20} /></Button>
    <div popover="auto" ref={menu} id={id} className="panel team-row-popover">
      <Button variant="ghost" aria-haspopup="dialog" onClick={() => {
        menu.current?.hidePopover()
        showDetails()
      }}>Сведения о сотруднике</Button>
      {call && <Button asChild variant="ghost"><Link to={'/calls/' + encodeURIComponent(call.call_id)}>Открыть текущий звонок</Link></Button>}
    </div>
  </>
}

export function TeamPage({ initialTab = 'employees' }: { initialTab?: Tab }) {
  const [localTab, setLocalTab] = useState(initialTab)
  const [search, setSearch] = useState('')
  const [department, setDepartment] = useState('')
  const [status, setStatus] = useState('')
  const [callFilter, setCallFilter] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [sort, setSort] = useState<'default' | 'asc' | 'desc'>('default')
  const [offset, setOffset] = useState(0)
  const [detailsId, setDetailsId] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now)
  const dialog = useRef<HTMLDialogElement>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()
  const employeeQuery = useTeam()
  const contact = useTeamCalls()
  const analytics = useAnalytics()
  const people = employeeQuery.data ?? []
  const calls = contact.data?.enabled && !contact.isError ? contact.data.calls : undefined
  const hasCalls = Boolean(calls?.size)
  const configuredDepartments = contact.data?.departments ?? []
  const legacyDepartments = configuredDepartments.length ? [] : analytics.data?.departments.map(row => row.department) ?? []
  const configured = teamDepartments(configuredDepartments, people, legacyDepartments)
  const labels = new Map(configured.map(item => [item.code, item.name]))
  const statusCounts = new Map<EmployeeStatus, number>()
  for (const person of people) statusCounts.set(person.status, (statusCounts.get(person.status) ?? 0) + 1)
  const connected = people.filter(person => calls?.has(person.id)).length
  const occupation = people.length ? connected / people.length : 0
  const needle = search.trim().toLocaleLowerCase('ru')
  const filtered = people.filter(person =>
    (!needle || person.full_name.toLocaleLowerCase('ru').includes(needle)) &&
    (!department || person.department === department) && (!status || person.status === status) &&
    (!calls || !callFilter || calls.has(person.id) === (callFilter === 'connected')),
  )
  if (sort !== 'default') filtered.sort((a, b) => (sort === 'asc' ? 1 : -1) * a.full_name.localeCompare(b.full_name, 'ru'))
  const currentOffset = Math.min(offset, Math.max(0, Math.ceil(filtered.length / pageSize) - 1) * pageSize)
  const details = people.find(person => person.id === detailsId)
  const detailsCall = details && calls?.get(details.id)
  const departmentRows = configured.map(item => {
    const members = people.filter(person => person.department === item.code)
    return { ...item, count: members.length, available: members.filter(person => person.status === 'available').length }
  })

  useEffect(() => {
    if (!hasCalls) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [hasCalls])
  useEffect(() => {
    if (detailsId && dialog.current && !dialog.current.open) dialog.current.showModal()
  }, [detailsId])
  useEffect(() => setLocalTab(initialTab), [initialTab])

  function updateFilter(set: (value: string) => void, value: string) {
    set(value)
    setOffset(0)
  }

  function clearFilters() {
    setSearch('')
    setDepartment('')
    setStatus('')
    setCallFilter('')
    setOffset(0)
  }

  return <>
    <PageHeading title="Команда" subtitle="Сотрудники, отделы и рабочие статусы" />
    <div className="team-page">
      <div className="team-page-left layout-stack">
        <div className="team-kpis">
          {metrics.map(metric => <div key={metric.id} data-status={metric.id}>
            <MetricCard label={metric.label} icon={metric.icon} value={employeeQuery.data && formatNumber(metric.id === 'total' ? people.length : statusCounts.get(metric.id) ?? 0)} />
          </div>)}
        </div>
        <section className="panel team-directory">
          <div className="team-tabs" role="tablist" aria-label="Разделы команды">
            {tabs.map((tab, index) => <button key={tab.id} role="tab" type="button" ref={element => { tabRefs.current[index] = element }}
              id={id + '-' + tab.id} aria-controls={id + '-panel'} aria-selected={localTab === tab.id}
              tabIndex={localTab === tab.id ? 0 : -1} onClick={() => setLocalTab(tab.id)} onKeyDown={event => {
                const positions: Record<string, number> = { ArrowLeft: (index + tabs.length - 1) % tabs.length, ArrowRight: (index + 1) % tabs.length, Home: 0, End: tabs.length - 1 }
                const next = positions[event.key]
                if (next === undefined) return
                event.preventDefault()
                setLocalTab(tabs[next].id)
                tabRefs.current[next]?.focus()
              }}>{tab.label}</button>)}
          </div>
          <div className="team-tab-body" role="tabpanel" id={id + '-panel'} aria-labelledby={id + '-' + localTab}>
            {localTab === 'employees' && <>
              <div className="team-toolbar">
                <label className="team-search">
                  <Search size={17} aria-hidden="true" />
                  <input className="field" type="search" aria-label="Поиск сотрудника" placeholder="Поиск сотрудника…" value={search} onChange={event => updateFilter(setSearch, event.target.value)} />
                </label>
                <select className="field" aria-label="Отдел" value={department} onChange={event => updateFilter(setDepartment, event.target.value)}>
                  <option value="">Все отделы</option>{configured.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
                </select>
                <select className="field" aria-label="Статус" value={status} onChange={event => updateFilter(setStatus, event.target.value)}>
                  <option value="">Все статусы</option>{statuses.map(value => <option key={value} value={value}>{employeeStatuses[value]}</option>)}
                </select>
                {calls && <Button className="icon-button team-filter-toggle" aria-label="Дополнительные фильтры" aria-expanded={showFilters}
                  aria-controls={id + '-filters'} onClick={() => setShowFilters(value => !value)}><SlidersHorizontal size={17} /></Button>}
                {(search || department || status || (calls && callFilter)) && <Button variant="ghost" onClick={clearFilters}>Сбросить</Button>}
              </div>
              {calls && <div className="team-extra-filters" id={id + '-filters'} hidden={!showFilters}>
                <label>Текущий звонок <select className="field" value={callFilter} onChange={event => updateFilter(setCallFilter, event.target.value)}>
                  <option value="">Все сотрудники</option><option value="connected">В разговоре</option><option value="idle">Без звонка</option>
                </select></label>
              </div>}
              {employeeQuery.isError || !employeeQuery.data ? <PageState loading={employeeQuery.isPending} error={employeeQuery.error} retry={() => void employeeQuery.refetch()} /> :
                !filtered.length ? <PageState empty={people.length ? 'Сотрудники по фильтрам не найдены' : 'Список сотрудников пуст'} /> : <>
                  <p className="team-scroll-hint" id={id + '-employee-scroll'}>Прокрутите таблицу, чтобы увидеть звонки и действия</p>
                  <div className="table-scroll" tabIndex={0} role="region" aria-label="Таблица сотрудников" aria-describedby={id + '-employee-scroll'}>
                    <table className="data-table team-employees">
                      <thead><tr>
                        <th scope="col" aria-sort={sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : 'none'}>
                          <button type="button" className="team-sort" onClick={() => { setSort(sort === 'asc' ? 'desc' : 'asc'); setOffset(0) }}>
                            Сотрудник <ArrowDownUp size={13} aria-hidden="true" />
                          </button>
                        </th>
                        <th scope="col">Отдел</th><th scope="col">Статус</th><th scope="col">Текущий звонок</th><th scope="col" aria-label="Действия" />
                      </tr></thead>
                      <tbody>{filtered.slice(currentOffset, currentOffset + pageSize).map(person => {
                        const call = calls?.get(person.id)
                        const initials = person.full_name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase()
                        return <tr key={person.id}>
                          <th scope="row"><span className="team-person"><span className="avatar" aria-hidden="true">{initials}</span><span>{person.full_name}</span></span></th>
                          <td><span className="team-department-tag">{labels.get(person.department) ?? person.department}</span></td>
                          <td><StatusBadge tone={employeeTones[person.status]}>{employeeStatuses[person.status]}</StatusBadge></td>
                          <td>{call ? <CallLink call={call} now={now} /> : <span className="muted">—</span>}</td>
                          <td><EmployeeActions person={person} call={call} showDetails={() => setDetailsId(person.id)} /></td>
                        </tr>
                      })}</tbody>
                    </table>
                  </div>
                  {filtered.length > pageSize && <Pagination limit={pageSize} offset={currentOffset} total={filtered.length} setOffset={setOffset} />}
                </>}
            </>}
            {localTab === 'departments' && <>
              {analytics.isError && <PageState error={analytics.error} retry={() => void analytics.refetch()} />}
              {!configured.length && !analytics.isError ? <PageState loading={analytics.isPending || contact.isPending} empty="Отделы пока не настроены" /> :
                configured.length > 0 && <div className="table-scroll" tabIndex={0} role="region" aria-label="Нагрузка по отделам">
                  <table className="data-table team-departments-table">
                    <thead><tr><th scope="col">Отдел</th><th scope="col">На линии</th><th scope="col">Сотрудники</th><th scope="col">В очереди</th><th scope="col">В работе</th></tr></thead>
                    <tbody>{departmentRows.map(item => {
                      const workload = analytics.data?.departments.find(row => row.department === item.code)
                      return <tr key={item.code}><th scope="row">{item.name}</th><td>{employeeQuery.data ? item.available : '—'}</td>
                        <td>{employeeQuery.data ? item.count : '—'}</td><td>{workload?.queued ?? '—'}</td><td>{workload?.in_progress ?? '—'}</td></tr>
                    })}</tbody>
                  </table>
                </div>}
            </>}
            {localTab === 'schedule' && <PageState empty={noShifts} />}
            {localTab === 'roles' && <dl className="team-roles">
              <div><dt><Headset size={18} /> Оператор <code>OPERATOR</code></dt><dd>Назначенные звонки, доступные обращения и личные настройки.</dd></div>
              <div><dt><ShieldCheck size={18} /> Руководитель <code>MANAGER</code></dt><dd>Общие данные CRM, звонков, обращений, команды и аналитики.</dd></div>
              <div><dt>Специализация</dt><dd>Contact Center использует настроенные навыки при назначении звонков. В списке руководителя доступны отдел и рабочий статус сотрудника.</dd></div>
            </dl>}
          </div>
        </section>
      </div>
      <aside className="team-overview layout-stack" aria-label="Сводка по команде">
        <section className="panel content-panel team-panel">
          <div className="team-panel-title"><h2>Отделы</h2><Button className="icon-button" variant="ghost" aria-label="Открыть вкладку «Отделы»" onClick={() => {
            setLocalTab('departments')
            tabRefs.current[1]?.focus()
          }}><ChevronRight size={19} /></Button></div>
          {employeeQuery.data && departmentRows.length ? <ul className="team-department-list">
            {departmentRows.map(item => {
              const Icon = departmentIcons[item.code as keyof typeof departmentIcons] ?? UsersRound
              return <li key={item.code}><span className="icon-chip" aria-hidden="true"><Icon size={17} /></span><div>
                <div className="team-department-label"><strong>{item.name}</strong><span>{item.available} / {item.count}</span></div>
                <meter min={0} max={Math.max(item.count, 1)} value={item.available} aria-label={item.name + ', сотрудников со статусом «На линии»'} />
              </div></li>
            })}
          </ul> : <PageState loading={employeeQuery.isPending || contact.isPending} error={employeeQuery.error} retry={() => void employeeQuery.refetch()} empty="Данных по отделам пока нет" />}
          {employeeQuery.data && departmentRows.length > 0 && <p className="team-note">На линии / всего сотрудников</p>}
        </section>
        <section className="panel content-panel team-panel">
          <h2>Нагрузка на команду</h2>
          {employeeQuery.data ? <div className="team-load">
            <div className="team-occupancy" title="Доля сотрудников с подключённым звонком от всей команды">
              <div className="team-gauge" aria-hidden="true" style={{ background: 'conic-gradient(from 270deg at 50% 100%, var(--primary) ' + occupation * 180 + 'deg, var(--primary-light) 0 180deg, transparent 0)' }} />
              <strong>{calls && people.length ? percent.format(occupation) : '—'}</strong>
              <span>На звонке</span>
            </div>
            <ul className="team-status-list">{statuses.filter(value => (statusCounts.get(value) ?? 0) > 0).map(value => <li key={value}>
              <i data-status={value} aria-hidden="true" /><span>{employeeStatuses[value]}</span><strong>{statusCounts.get(value)}</strong>
            </li>)}</ul>
          </div> : <PageState loading={employeeQuery.isPending} error={employeeQuery.error} retry={() => void employeeQuery.refetch()} />}
          {contact.isError ? <p className="team-note" role="status">Данные по текущим звонкам недоступны. <button type="button" className="text-link" onClick={() => void contact.refetch()}>Повторить</button></p> :
            contact.isPending ? <p className="team-note" role="status">Загрузка текущих звонков…</p> :
              contact.data && !contact.data.enabled && <p className="team-note">Распределение звонков отключено</p>}
        </section>
        <section className="panel content-panel team-panel">
          <h2><CalendarDays size={19} /> Ближайшие смены</h2>
          <p className="team-schedule-empty">{noShifts}</p>
        </section>
      </aside>
      <dialog className="panel team-dialog" ref={dialog} aria-labelledby={id + '-details'} onClose={() => setDetailsId(null)}>
        <div className="team-panel-title">
          <h2 id={id + '-details'}>{details?.full_name ?? 'Сотрудник'}</h2>
          <form method="dialog"><Button type="submit" className="icon-button" variant="ghost" aria-label="Закрыть сведения"><X size={20} /></Button></form>
        </div>
        {details && <dl className="team-detail-list">
          <div><dt>Отдел</dt><dd>{labels.get(details.department) ?? details.department}</dd></div>
          <div><dt>Статус</dt><dd><StatusBadge tone={employeeTones[details.status]}>{employeeStatuses[details.status]}</StatusBadge></dd></div>
          <div><dt>Статус обновлён</dt><dd>{formatDate(details.updated_at)}</dd></div>
          {detailsCall && <div><dt>Текущий звонок</dt><dd><CallLink call={detailsCall} now={now} /></dd></div>}
        </dl>}
      </dialog>
    </div>
  </>
}
