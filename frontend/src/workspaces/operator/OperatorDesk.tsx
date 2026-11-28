import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, Clock3, FileText, Gauge, Headset,
  History, Layers3, Phone, PhoneOff, Search, Sparkles, UserRound, VolumeX, Wallet, Wifi,
} from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { api } from '../../api/client'
import { usePreferences } from '../../app/session'
import { PageState } from '../../components/PageState'
import { StatusBadge } from '../../components/StatusBadge'
import { Button } from '../../components/ui/button'
import { initials, formatMoney, serviceStatuses } from '../../features/crm/CrmElements'
import type { CustomerDetail } from '../../features/crm/types'
import { Transcript } from '../../features/operations/CallContext'
import { callStatuses, departments, outcomes } from '../../features/operations/labels'
import { formatDate, formatDuration, formatNumber } from '../../lib/format'
import type { Call } from '../../types/operations'
import { useOperatorWorkspace, type OperatorCall, type OperatorWorkspace } from './data'
import styles from './OperatorDesk.module.css'

const tabs = [
  ['context', 'Контекст', Sparkles], ['history', 'История', History], ['notes', 'Заметки', FileText],
] as const

type Action = { path: string; body?: object }
type Assignment = OperatorWorkspace['assignment']

function callerName(call?: Call) {
  return call?.customer_name || call?.caller_phone_masked || 'Абонент'
}

function timerLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return String(minutes).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0')
}

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000))
  return Number.isFinite(seconds) ? timerLabel(seconds) : '—'
}

function CallBanner({ call, assignment, voiceAvailable, wrapUp, pending, error, transfer, changeTransfer, departmentOptions, runAction, openCurrent }: {
  call?: Call
  assignment: Assignment
  voiceAvailable: boolean
  wrapUp: boolean
  pending: boolean
  error: Error | null
  transfer: string
  changeTransfer: (value: string) => void
  departmentOptions: { code: string; name: string }[]
  runAction: (action: Action) => void
  openCurrent?: () => void
}) {
  const offered = assignment?.state === 'offered'
  const connecting = assignment?.state === 'accepted'
  const connected = assignment?.state === 'connected'
  const path = 'assignments/' + encodeURIComponent(assignment?.id ?? '')
  const disabled = pending || !voiceAvailable
  const department = call?.department ? departments[call.department] || call.department : 'Отдел уточняется'
  const status = offered ? 'Входящий звонок' : connecting ? 'Подключение к звонку' : connected ? 'Активный разговор'
    : wrapUp ? 'Постобработка' : call ? callStatuses[call.status] : 'Ожидание'
  const title = call ? callerName(call) : wrapUp ? 'Завершите работу со звонком' : 'Готовность к звонку'
  const description = call ? [department, call.account_number && 'Счёт ' + call.account_number].filter(Boolean).join(' · ')
    : wrapUp ? undefined : 'Назначенный системой звонок появится здесь'
  const otherDepartments = departmentOptions.filter(row => row.code !== call?.department)

  function control(action: 'hold' | 'resume' | 'end') {
    runAction({ path: path + '/control', body: { action, event_id: crypto.randomUUID() } })
  }

  return <section className={'panel ' + styles.banner} aria-label="Текущий звонок">
    <div className={styles.bannerMain}>
      <span className={'icon-chip ' + styles.phoneIcon} aria-hidden="true"><Phone size={23} /></span>
      <div className={styles.bannerCopy}>
        <span role="status">{status}</span>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
    </div>
    <div className={styles.bannerTools}>
      {assignment && <span className={styles.elapsed}>
        <Clock3 size={15} aria-hidden="true" />{connected ? 'Разговор' : connecting ? 'Подключение' : 'Ожидание'}
        <strong><Elapsed since={assignment.connected_at || assignment.offered_at} /></strong>
      </span>}
      {!assignment && call?.ended_at && call.duration_seconds != null && <span className={styles.elapsed}>
        <Clock3 size={15} aria-hidden="true" />Длительность <strong>{formatDuration(call.duration_seconds)}</strong>
      </span>}
      {offered && <div className={styles.controls}>
        <Button onClick={() => runAction({ path: path + '/decline' })} disabled={disabled}>Пропустить</Button>
        <Button variant="primary" onClick={() => runAction({ path: path + '/accept' })} disabled={disabled}>
          <Phone size={16} aria-hidden="true" />Принять звонок
        </Button>
      </div>}
      {connected && <div className={styles.controls}>
        <Button disabled={disabled} onClick={() => control('hold')}>Удержание</Button>
        <Button disabled={disabled} onClick={() => control('resume')}>Возобновить</Button>
        {otherDepartments.length > 0 && <>
          <select className="field" aria-label="Отдел для перевода звонка" value={transfer} onChange={event => changeTransfer(event.target.value)}>
            <option value="">Отдел для перевода</option>
            {otherDepartments.map(row => <option key={row.code} value={row.code}>{row.name}</option>)}
          </select>
          <Button disabled={!transfer || disabled} onClick={() => runAction({
            path: path + '/control', body: { action: 'transfer', department: transfer, event_id: crypto.randomUUID() },
          })}>Перевести</Button>
        </>}
        <Button className={styles.endCall} disabled={disabled} onClick={() => control('end')}>
          <PhoneOff size={16} aria-hidden="true" />Завершить
        </Button>
      </div>}
      {openCurrent && <Button onClick={openCurrent}>Открыть текущий звонок</Button>}
      {wrapUp && <Button variant="primary" onClick={() => runAction({ path: 'profile/complete-wrap-up' })} disabled={pending}>
        <Headset size={16} aria-hidden="true" />Завершить постобработку
      </Button>}
      {!voiceAvailable && <p className={styles.voiceStatus}><VolumeX size={15} aria-hidden="true" />Голосовые функции недоступны</p>}
      {connecting && <p className="inline-empty" role="status">Ожидаем подтверждение Voice</p>}
    </div>
    {error && <p className={'alert ' + styles.bannerError} role="alert">{error.message}</p>}
  </section>
}

function CallSummary({ call, detail, expanded, pending, runAction }: {
  call: Call; detail?: OperatorCall; expanded: boolean; pending: boolean; runAction: (action: Action) => void
}) {
  const handoff = detail?.handoff
  const summary = handoff?.summary || call.summary || 'Сводки пока нет'
  const facts = detail?.crm_checks.length ? detail.crm_checks : handoff?.verified_facts ?? []
  const extra = [
    ['Выполненные действия', handoff?.actions_taken?.join(' · ')],
    ['Возможные причины', handoff?.assumptions?.join(' · ')],
    ['Следующий шаг', handoff?.open_question],
    ['Дополнительные вопросы', handoff?.secondary_questions.join(' · ')],
  ]
  const summaryBody = <>
    <p>{summary}</p>
    {handoff?.customer_report && handoff.customer_report !== summary && <small>{handoff.customer_report}</small>}
  </>

  return <>
    <section className={styles.summary} aria-labelledby="desk-ai-summary">
      <h2 id="desk-ai-summary"><Sparkles size={18} aria-hidden="true" />Сводка ИИ</h2>
      {expanded ? summaryBody : <details><summary>Показать сводку</summary>{summaryBody}</details>}
    </section>
    {facts.length > 0 && <section className={styles.facts} aria-labelledby="desk-verified-facts">
      <h3 id="desk-verified-facts">Уже проверено</h3>
      <ul>{facts.map((fact, index) => <li key={index}>
        <CheckCircle2 size={16} aria-hidden="true" />{fact.text}
      </li>)}</ul>
    </section>}
    {extra.some(([, value]) => value) && <dl className={styles.extra}>
      {extra.map(([label, value]) => value && <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>}
    {detail && <div className={styles.footer}>
      {call.ended_at && <p className={styles.result}><strong>Результат</strong> · {outcomes[call.outcome]}</p>}
      <div className={styles.footerActions}>
        {detail.tickets.map(ticket => <Button asChild key={ticket.id}>
          <Link to={'/operator/tickets/' + encodeURIComponent(ticket.id)}><FileText size={16} aria-hidden="true" />Открыть обращение</Link>
        </Button>)}
        <Transcript call={detail} />
      </div>
      {call.ended_at && call.summary && (detail.summary_reviewed_at
        ? <StatusBadge tone="success">Сводка подтверждена</StatusBadge>
        : <Button disabled={pending} onClick={() => runAction({ path: 'calls/' + encodeURIComponent(call.id) + '/confirm-summary' })}>Подтвердить сводку</Button>)}
    </div>}
  </>
}

export function OperatorDesk() {
  const [params, setParams] = useSearchParams()
  const [listChoice, setListTab] = useState<'queue' | 'history'>()
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'context' | 'history' | 'notes'>('context')
  const [accountNumber, chooseAccount] = useState('')
  const [text, setText] = useState('')
  const [transfer, setTransfer] = useState<{ callId?: string; department: string }>({ department: '' })
  const workspace = useOperatorWorkspace()
  const { query: prefs } = usePreferences()
  const client = useQueryClient()
  const data = workspace.data
  const selected = params.get('call') || data?.call_id
  const currentAssignment = data?.assignment ?? null
  const currentCall = data?.calls.find(call => call.id === data.call_id)
  const offered = currentAssignment?.state === 'offered' && currentAssignment.call_id === selected
  const preview = [...(data?.calls ?? []), ...(data?.history ?? [])].find(call => call.id === selected)
  const detail = useQuery({
    queryKey: ['operator', 'calls', selected],
    queryFn: ({ signal }) => api<OperatorCall>('/api/v1/operator/calls/' + encodeURIComponent(selected!), { signal }),
    enabled: Boolean(data && selected && !offered),
  })
  const call = offered ? preview : detail.data ?? preview
  const customer = useQuery({
    queryKey: ['operator', 'customers', call?.customer_id],
    queryFn: ({ signal }) => api<CustomerDetail>('/api/v1/operator/customers/' + encodeURIComponent(call!.customer_id!), { signal }),
    enabled: Boolean(call?.customer_id && !offered),
  })
  const voiceDepartments = useQuery({
    queryKey: ['operator', 'departments'],
    queryFn: ({ signal }) => api<{ code: string; name: string }[]>('/api/v1/operator/departments', { signal }),
    enabled: currentAssignment?.state === 'connected' && data?.voice_available === true,
  })
  const refresh = () => client.invalidateQueries({ queryKey: ['operator'] })
  const action = useMutation({
    mutationFn: ({ path, body }: Action) => api('/api/v1/operator/' + path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
    onSuccess: refresh,
  })
  const note = useMutation({
    mutationFn: (message: string) => api('/api/v1/operator/calls/' + encodeURIComponent(selected!) + '/notes', {
      method: 'POST', body: JSON.stringify({ text: message, event_id: crypto.randomUUID() }),
    }),
    onSuccess: () => { setText(''); void refresh() },
  })

  const accounts = offered ? undefined : customer.data?.accounts
  const account = accounts?.find(item => item.number === (accountNumber || call?.account_number)) ?? accounts?.[0]
  const inHistory = data?.history.some(item => item.id === selected)
  const listTab = listChoice ?? (inHistory ? 'history' : 'queue')
  const items = (listTab === 'queue' ? data?.calls : data?.history) ?? []
  const term = search.trim().toLocaleLowerCase('ru')
  const visible = items.filter(item => !term || [item.customer_name, item.summary, item.account_number, item.caller_phone_masked]
    .some(value => value?.toLocaleLowerCase('ru').includes(term)))
  const history = data?.history.filter(item => item.id !== selected && item.customer_id && item.customer_id === call?.customer_id) ?? []

  function selectCall(id: string) {
    chooseAccount('')
    setTab('context')
    setText('')
    note.reset()
    setParams({ call: id }, { replace: true })
  }

  function saveNote(event: FormEvent) {
    event.preventDefault()
    if (text.trim()) note.mutate(text.trim())
  }

  if (!data) return <PageState loading={workspace.isPending} error={workspace.error} retry={() => void workspace.refetch()} />

  return <div className={styles.frame}>
    <div className={'desk-grid ' + styles.grid} data-idle={!currentCall && !selected ? 'true' : undefined}>
      <section className={'panel desk-list ' + styles.callsPanel} aria-labelledby="desk-calls-heading">
        <h2 id="desk-calls-heading">Звонки <span className={styles.count} aria-label={formatNumber(data.waiting_calls) + ' звонков в очереди отдела'}>{formatNumber(data.waiting_calls)}</span></h2>
        <div className={'segmented ' + styles.listTabs} role="group" aria-label="Списки звонков">
          <button aria-pressed={listTab === 'queue'} onClick={() => setListTab('queue')}>Очередь <span aria-hidden="true">· {formatNumber(data.waiting_calls)}</span></button>
          <button aria-pressed={listTab === 'history'} onClick={() => setListTab('history')}>История</button>
        </div>
        <label className="desk-search">
          <Search size={17} aria-hidden="true" />
          <input className="field" type="search" placeholder="Поиск по звонкам" aria-label="Поиск по звонкам" value={search} onChange={event => setSearch(event.target.value)} />
        </label>
        {visible.length > 0 ? <div className={'desk-calls ' + styles.calls}>
          {visible.map(item => <button key={item.id} aria-pressed={selected === item.id} onClick={() => selectCall(item.id)}>
            <span className="avatar" aria-hidden="true">{item.customer_name ? initials(item.customer_name) : <Phone size={16} />}</span>
            <span><strong>{callerName(item)}</strong><small className={styles.callSnippet}>{item.summary || callStatuses[item.status]}</small></span>
            <small className={styles.callTime}>{listTab === 'queue'
              ? <Elapsed since={currentAssignment?.offered_at || item.started_at} />
              : item.duration_seconds != null && <span aria-label={'Длительность ' + formatDuration(item.duration_seconds)}>{timerLabel(item.duration_seconds)}</span>}</small>
          </button>)}
        </div> : <p className={'inline-empty ' + styles.listEmpty}>
          {term ? 'Звонки не найдены' : listTab === 'queue' ? 'Назначенных звонков пока нет' : 'История звонков пуста'}
        </p>}
      </section>

      <CallBanner call={currentCall} assignment={currentAssignment} voiceAvailable={data.voice_available}
        wrapUp={data.employee.status === 'wrap_up'} pending={action.isPending} error={action.error}
        transfer={transfer.callId === currentCall?.id ? transfer.department : ''}
        changeTransfer={department => setTransfer({ callId: currentCall?.id, department })}
        departmentOptions={voiceDepartments.data ?? []} runAction={action.mutate}
        openCurrent={currentCall && currentCall.id !== selected ? () => {
          setListTab('queue')
          selectCall(currentCall.id)
        } : undefined} />

      <section className={'panel ' + styles.context} aria-label="Контекст звонка">
        <div className={'desk-tabs ' + styles.contextTabs} role="group" aria-label="Разделы звонка">
          {tabs.map(([key, title, Icon]) => <button key={key} onClick={() => setTab(key)} aria-pressed={tab === key}>
            <Icon size={17} aria-hidden="true" />{title}
          </button>)}
        </div>
        <div className={styles.contextBody}>
          {tab === 'context' && <>
            {call ? <CallSummary key={call.id} call={call} detail={offered ? undefined : detail.data}
              expanded={prefs.data?.summary_expanded !== false} pending={action.isPending} runAction={action.mutate} />
              : !selected && <p className="inline-empty">Контекст появится после выбора звонка</p>}
            {selected && !offered && detail.isPending && <p className="inline-empty" role="status">Загрузка контекста…</p>}
            {detail.isError && !offered && <p className="alert" role="alert">{detail.error.message}</p>}
          </>}
          {tab === 'history' && (history.length ? <ul className="work-items">
            {history.map(item => <li key={item.id}>
              <button className="text-link" onClick={() => selectCall(item.id)}>{item.summary || callStatuses[item.status]}</button>
              <small>{formatDate(item.started_at)}</small>
            </li>)}
          </ul> : <p className="inline-empty">Доступных предыдущих звонков нет</p>)}
          {tab === 'notes' && (!offered && detail.data ? <>
            {detail.data.notes.length > 0 && <ul className="timeline">
              {detail.data.notes.map(item => <li key={item.id}>{item.text}<small>{formatDate(item.created_at)}</small></li>)}
            </ul>}
            <form className={'note-form ' + styles.notes} onSubmit={saveNote}>
              <label>Рабочая заметка<textarea className="field" rows={3} maxLength={4000} value={text} onChange={event => setText(event.target.value)} /></label>
              <Button variant="primary" type="submit" disabled={note.isPending || !text.trim()}>Сохранить заметку</Button>
              {note.isError && <p role="alert" className="alert">{note.error.message}</p>}
            </form>
          </> : <p className="inline-empty">Выберите доступный звонок</p>)}
        </div>
      </section>

      <aside className={'panel content-panel ' + styles.customer} aria-labelledby="desk-customer-heading">
        <h2 id="desk-customer-heading"><UserRound size={20} aria-hidden="true" />Данные клиента</h2>
        {call ? <>
          <div className={'desk-identity ' + styles.identity}>
            <span className="avatar" aria-hidden="true">{call.customer_name ? initials(call.customer_name) : <UserRound size={19} />}</span>
            <div><strong>{callerName(call)}</strong><small>{call.account_number ? 'Лицевой счёт ' + call.account_number : 'Счёт не определён'}</small></div>
          </div>
          {accounts && accounts.length > 1 && <select className={'field ' + styles.accountSelect} aria-label="Лицевой счёт" value={account?.number} onChange={event => chooseAccount(event.target.value)}>
            {accounts.map(item => <option key={item.number} value={item.number}>{item.number}</option>)}
          </select>}
          {account && <>
            <dl className={styles.account}>
              <div><dt><Wallet size={17} aria-hidden="true" />Баланс</dt><dd className={account.balance_kopecks >= 0 ? styles.positive : undefined}>{formatMoney(account.balance_kopecks)}</dd></div>
              <div><dt><Layers3 size={17} aria-hidden="true" />Тариф</dt><dd>{account.tariff_name}</dd></div>
              <div><dt><Gauge size={17} aria-hidden="true" />Скорость</dt><dd>{account.speed_mbps} Мбит/с</dd></div>
              <div><dt><Wifi size={17} aria-hidden="true" />Услуга</dt><dd><StatusBadge tone={account.service_status === 'active' ? 'success' : 'warning'}>{serviceStatuses[account.service_status]}</StatusBadge></dd></div>
              <div><dt>Адрес</dt><dd>{account.address}</dd></div>
            </dl>
            {account.active_incidents.map(incident => <div className={'desk-incident ' + styles.incident} key={incident.id}>
              <AlertTriangle size={18} aria-hidden="true" />
              <div><strong>Сетевой инцидент</strong><p>{incident.title}</p></div>
            </div>)}
          </>}
          {!offered && customer.isFetching && !account && <p className="inline-empty" role="status">Загрузка счёта…</p>}
          {!offered && customer.isError && !customer.data && <p className="alert" role="alert">{customer.error.message}</p>}
          {offered && <p className="inline-empty">Данные счёта будут доступны после принятия звонка</p>}
          {!offered && customer.data && <Button className="customer-open" asChild>
            <Link to={'/operator/customers/' + encodeURIComponent(customer.data.id)}><UserRound size={16} aria-hidden="true" />Открыть профиль клиента <ArrowUpRight size={16} aria-hidden="true" /></Link>
          </Button>}
        </> : <p className="inline-empty">Выберите звонок, чтобы открыть клиентский контекст</p>}
      </aside>
    </div>
  </div>
}
