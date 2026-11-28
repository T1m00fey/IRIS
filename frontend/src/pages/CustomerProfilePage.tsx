import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronDown, CreditCard, FileText, Phone } from 'lucide-react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { api, ApiError } from '../api/client'
import { PageState } from '../components/PageState'
import { StatusBadge } from '../components/StatusBadge'
import { Button } from '../components/ui/button'
import { CrmBadge, CrmPagination, CrmState, customerStatuses, formatMoney, initials, paymentStatuses, serviceStatuses } from '../features/crm/CrmElements'
import { CustomerNotes } from '../features/crm/CustomerNotes'
import { CustomerOverview } from '../features/crm/CustomerOverview'
import { useCustomerHistory } from '../features/crm/useCustomerHistory'
import type { Account, CustomerDetail } from '../features/crm/types'
import { callDepartments, callStatuses, callTones, departments, ticketStatuses, ticketTones } from '../features/operations/labels'
import { formatDate, formatDuration } from '../lib/format'
import type { Call, Ticket } from '../types/operations'
import '../features/crm/crm.css'

const tabs = {
  overview: 'Обзор',
  accounts: 'Лицевые счета',
  calls: 'История звонков',
  tickets: 'Обращения',
  payments: 'Платежи',
  notes: 'Заметки',
}

type Tab = keyof typeof tabs

export function CustomerProfilePage({ customerId: selectedId }: { customerId?: string } = {}) {
  const { customerId: routeId } = useParams<'customerId'>()
  const customerId = selectedId ?? routeId ?? ''
  const { state } = useLocation()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const customer = useQuery({
    queryKey: ['customers', customerId],
    queryFn: ({ signal }) => api<CustomerDetail>('/api/v1/customers/' + encodeURIComponent(customerId), { signal }),
    retry: (attempt, error) => !(error instanceof ApiError && error.status === 404) && attempt < 1,
  })
  const listParams = new URLSearchParams(params)
  for (const key of ['tab', 'account', 'history_offset']) listParams.delete(key)
  const back = (!selectedId || routeId) && <Button asChild variant="ghost" className="crm-back">
    <Link to={{ pathname: '/customers', search: state?.customerSearch ?? listParams.toString() }}><ArrowLeft size={16} />Клиенты</Link>
  </Button>

  if (customer.isPending) return <div className="crm-profile">{back}<PageState loading /></div>
  if (customer.isError) {
    const notFound = customer.error instanceof ApiError && customer.error.status === 404
    return <div className="crm-profile">{back}{notFound
      ? <PageState empty="Клиент не найден" />
      : <PageState error={customer.error} retry={() => void customer.refetch()} />}
    </div>
  }

  const profile = customer.data
  const ProfileHeading = selectedId ? 'h2' : 'h1'
  const selectedNumber = params.get('account')
  const account = profile.accounts.find((item) => item.number === selectedNumber)
    ?? profile.accounts.find((item) => item.number === profile.primary_account?.number)
    ?? profile.accounts[0]
  const tabParam = params.get('tab') ?? ''
  const tab = Object.hasOwn(tabs, tabParam) ? tabParam as Tab : 'overview'
  const offsetParam = Number(params.get('history_offset'))
  const offset = Number.isSafeInteger(offsetParam) && offsetParam >= 0 ? offsetParam : 0

  function selectAccount(number: string) {
    if (number === account?.number && routeId) return
    const next = new URLSearchParams(params)
    if (number) next.set('account', number)
    else next.delete('account')
    next.delete('history_offset')
    if (selectedId && !routeId) return navigateToCustomer(next)
    setParams(next, { state, preventScrollReset: true })
  }

  function navigateToCustomer(next: URLSearchParams) {
    void navigate({ pathname: '/customers/' + encodeURIComponent(customerId), search: next.toString() }, { state, preventScrollReset: true })
  }

  function tabHref(nextTab: Tab) {
    const next = new URLSearchParams(params)
    if (nextTab === 'overview') next.delete('tab')
    else next.set('tab', nextTab)
    next.delete('history_offset')
    return { pathname: '/customers/' + encodeURIComponent(customerId), search: next.toString() }
  }

  return (
    <div className="crm-profile">
      {back}
      <header className="panel crm-profile-header">
        <div className="crm-profile-identity">
          <span className="crm-avatar crm-profile-avatar" aria-hidden="true">{initials(profile.full_name)}</span>
          <div>
            <div className="crm-profile-title">
              <ProfileHeading>{profile.full_name}</ProfileHeading>
              <CrmBadge status={profile.status}>{customerStatuses[profile.status]}</CrmBadge>
            </div>
            <div className="crm-profile-meta muted">
              {profile.phone && <a href={'tel:' + profile.phone}><Phone size={14} aria-hidden="true" />{profile.phone}</a>}
              {profile.primary_account && <span><CreditCard size={14} aria-hidden="true" />Основной счёт {profile.primary_account.number}</span>}
            </div>
          </div>
        </div>
        <div className="crm-profile-actions">
          {profile.accounts.length > 1 && (
            <label className="crm-account-switch">
              <span className="sr-only">Активный лицевой счёт</span>
              <select className="field" value={account?.number ?? ''} onChange={(event) => selectAccount(event.target.value)}>
                {profile.accounts.map((item) => <option key={item.number} value={item.number}>Счёт {item.number}</option>)}
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </label>
          )}
          <Button asChild><Link to={tabHref('notes')} state={state} preventScrollReset><FileText size={16} aria-hidden="true" />Открыть заметки</Link></Button>
        </div>
        <nav className="crm-tabs" aria-label="Разделы карточки клиента">
          {(Object.entries(tabs) as [Tab, string][]).map(([key, label]) => (
            <Link key={key} aria-current={tab === key ? 'page' : undefined} to={tabHref(key)} state={state} preventScrollReset>{label}</Link>
          ))}
        </nav>
      </header>

      {tab === 'overview' && <CustomerOverview customer={profile} account={account} onSelectAccount={selectAccount}
        tickets={tabHref('tickets')} payments={tabHref('payments')} />}
      {tab === 'accounts' && <Accounts accounts={profile.accounts} selected={account?.number} onSelect={selectAccount} />}
      {tab === 'payments' && <Payments account={account} />}
      {tab === 'notes' && <CustomerNotes key={profile.id} customerId={profile.id} />}
      {(tab === 'calls' || tab === 'tickets') && (
        <CustomerHistory kind={tab} customerId={profile.id} accountNumber={account?.number} offset={offset}
          onPageChange={(nextOffset) => {
            const next = new URLSearchParams(params)
            if (nextOffset > 0) next.set('history_offset', String(nextOffset))
            else next.delete('history_offset')
            setParams(next, { state, preventScrollReset: true })
          }} />
      )}
    </div>
  )
}

function Accounts({ accounts, selected, onSelect }: {
  accounts: Account[]
  selected?: string
  onSelect: (number: string) => void
}) {
  if (!accounts.length) return <PageState empty="У клиента пока нет лицевых счетов" />

  return <section className="panel crm-section crm-table-section" aria-labelledby="crm-accounts-heading">
    <h2 id="crm-accounts-heading">Лицевые счета</h2>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Таблица лицевых счетов"><table className="data-table crm-history-table">
      <thead><tr><th scope="col">Счёт</th><th scope="col">Адрес</th><th scope="col">Тариф</th>
        <th scope="col">Баланс</th><th scope="col">Услуга</th><th scope="col">Выбор</th></tr></thead>
      <tbody>{accounts.map((account) => (
        <tr key={account.number} data-selected={account.number === selected}>
          <td className="crm-number">{account.number}</td><td>{account.address}</td><td>{account.tariff_name}</td>
          <td className="crm-number" data-negative={account.balance_kopecks < 0}>{formatMoney(account.balance_kopecks)}</td>
          <td><CrmBadge status={account.service_status}>{serviceStatuses[account.service_status]}</CrmBadge></td>
          <td><Button variant="ghost" aria-pressed={account.number === selected} onClick={() => onSelect(account.number)}>
            {account.number === selected ? 'Выбран' : 'Выбрать'}
          </Button></td>
        </tr>
      ))}</tbody>
    </table></div>
  </section>
}

function Payments({ account }: { account?: Account }) {
  if (!account) return <PageState empty="У клиента пока нет лицевых счетов" />

  return <section className="panel crm-section crm-table-section" aria-labelledby="crm-payments-heading">
    <h2 id="crm-payments-heading">Платежи <span className="muted">· {account.number}</span></h2>
    {account.payments.length ? (
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Таблица платежей"><table className="data-table crm-history-table">
        <thead><tr><th scope="col">Дата платежа</th><th scope="col">Сумма</th><th scope="col">Статус</th>
          <th scope="col">Дата зачисления</th><th scope="col">Идентификатор</th></tr></thead>
        <tbody>{account.payments.map((payment) => (
          <tr key={payment.id}><td>{formatDate(payment.paid_at)}</td><td className="crm-number">{formatMoney(payment.amount_kopecks)}</td>
            <td><CrmBadge status={payment.status}>{paymentStatuses[payment.status]}</CrmBadge></td>
            <td>{formatDate(payment.credited_at)}</td><td className="muted crm-number">{payment.id}</td></tr>
        ))}</tbody>
      </table></div>
    ) : <CrmState title="Платежей по этому счёту пока нет" />}
  </section>
}

function CustomerHistory({ kind, customerId, accountNumber, offset, onPageChange }: {
  kind: 'calls' | 'tickets'
  customerId: string
  accountNumber?: string
  offset: number
  onPageChange: (offset: number) => void
}) {
  const history = useCustomerHistory(kind, customerId, accountNumber, offset, 10)

  return (
    <section className="panel crm-section crm-table-section" aria-labelledby="crm-history-heading" aria-busy={history.isFetching}>
      <h2 id="crm-history-heading">{tabs[kind]} {accountNumber && <span className="muted">· {accountNumber}</span>}</h2>
      {history.isPending && <CrmState title="Загрузка истории…" />}
      {history.isError && (
        <CrmState title="Не удалось загрузить историю" description={history.error.message} error>
          <Button onClick={() => void history.refetch()}>Повторить</Button>
        </CrmState>
      )}
      {!history.isError && history.data && (
        history.data.items.length ? (
          <>
            <div className="table-scroll" tabIndex={0} role="region" aria-label={tabs[kind]}><table className="data-table crm-history-table">
              <thead><tr><th scope="col">{kind === 'calls' ? 'Звонок' : 'Обращение'}</th><th scope="col">Дата</th>
                <th scope="col">Отдел</th><th scope="col">Статус</th>
                {kind === 'calls' && <th scope="col">Длительность</th>}</tr></thead>
              <tbody>{history.data.items.map((item) => <HistoryRow key={item.id} item={item} />)}</tbody>
            </table></div>
            <CrmPagination {...history.data} onChange={onPageChange} />
          </>
        ) : (
          <CrmState title={offset ? 'На этой странице нет записей' : kind === 'calls' ? 'Звонков пока нет' : 'Обращений пока нет'}>
            {offset > 0 && <Button onClick={() => onPageChange(0)}>К первой странице</Button>}
          </CrmState>
        )
      )}
    </section>
  )
}

function HistoryRow({ item }: { item: Call | Ticket }) {
  if ('title' in item) return (
    <tr>
      <td><Link className="crm-link" to={'/tickets/' + encodeURIComponent(item.id)}>{item.title}</Link>
        <span className="crm-secondary muted">{item.id}</span></td>
      <td>{formatDate(item.created_at)}</td><td>{departments[item.department]}</td>
      <td><StatusBadge tone={ticketTones[item.status]}>{ticketStatuses[item.status]}</StatusBadge></td>
    </tr>
  )
  return (
    <tr>
      <td><Link className="crm-link" to={'/calls/' + encodeURIComponent(item.id)}>{item.summary || 'Звонок ' + item.id}</Link>
        <span className="crm-secondary muted">{item.caller_phone_masked ?? item.id}</span></td>
      <td>{formatDate(item.started_at)}</td><td>{item.department ? callDepartments[item.department] ?? item.department : '—'}</td>
      <td><StatusBadge tone={callTones[item.status]}>{callStatuses[item.status]}</StatusBadge></td>
      <td className="crm-number">{formatDuration(item.duration_seconds)}</td>
    </tr>
  )
}
