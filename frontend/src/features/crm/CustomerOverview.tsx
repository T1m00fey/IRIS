import { ArrowUpRight, CircleAlert, CreditCard, FileText, MapPin, Receipt, UserRound, Wallet, Wifi } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useLocation, type To } from 'react-router'
import { StatusBadge } from '../../components/StatusBadge'
import { Button } from '../../components/ui/button'
import { formatDate, formatNumber } from '../../lib/format'
import { ticketStatuses, ticketTones } from '../operations/labels'
import { CrmBadge, formatMoney, paymentStatuses, serviceStatuses } from './CrmElements'
import type { Account, CustomerDetail } from './types'
import { useCustomerHistory } from './useCustomerHistory'

const previewLimit = 3

function OverviewCard({ title, icon, children, wide = false }: {
  title: string
  icon: ReactNode
  children: ReactNode
  wide?: boolean
}) {
  return <section className={'panel crm-overview-card' + (wide ? ' crm-overview-wide' : '')} aria-label={title}>
    <h3><span className="crm-overview-icon" aria-hidden="true">{icon}</span>{title}</h3>
    {children}
  </section>
}

function OverviewLink({ to, children }: { to: To; children: ReactNode }) {
  const { state } = useLocation()
  return <Link className="crm-overview-link" to={to} state={state} preventScrollReset>{children}<ArrowUpRight size={14} aria-hidden="true" /></Link>
}

function AccountPicker({ accounts, primaryNumber, selectedNumber, onSelect }: {
  accounts: Account[]
  primaryNumber?: string
  selectedNumber?: string
  onSelect: (number: string) => void
}) {
  if (!accounts.length) return <p className="crm-overview-empty">Лицевых счетов пока нет</p>

  return <ul className="crm-overview-accounts">
    {accounts.map(account => <li key={account.number}>
      <button type="button" className="crm-overview-account" aria-pressed={account.number === selectedNumber}
        onClick={() => onSelect(account.number)}>
        <span className="crm-overview-account-number">
          <strong>Счёт {account.number}</strong>
          {account.number === primaryNumber && <small>Основной</small>}
        </span>
        <span className="crm-overview-address"><MapPin size={13} aria-hidden="true" />{account.address}</span>
      </button>
    </li>)}
  </ul>
}

function RecentTickets({ customerId, accountNumber, history }: { customerId: string; accountNumber: string; history: To }) {
  const tickets = useCustomerHistory('tickets', customerId, accountNumber, 0, previewLimit)
  return <OverviewCard title="Последние обращения" icon={<FileText size={16} />}>
    {tickets.isPending && <p className="crm-overview-empty" role="status">Загрузка обращений…</p>}
    {tickets.isError && <div className="crm-overview-error" role="alert">
      <p>Не удалось загрузить обращения</p>
      <Button variant="ghost" onClick={() => void tickets.refetch()}>Повторить</Button>
    </div>}
    {!tickets.isError && tickets.data && (tickets.data.items.length ? <>
      <ul className="crm-overview-records">{tickets.data.items.map(ticket => <li key={ticket.id}>
        <div>
          <Link className="crm-overview-link" to={'/tickets/' + encodeURIComponent(ticket.id)}>{ticket.title}</Link>
          <time dateTime={ticket.created_at}>{formatDate(ticket.created_at)}</time>
        </div>
        <StatusBadge tone={ticketTones[ticket.status]}>{ticketStatuses[ticket.status]}</StatusBadge>
      </li>)}</ul>
      <OverviewLink to={history}>Все обращения</OverviewLink>
    </> : <p className="crm-overview-empty">По этому счёту обращений пока нет</p>)}
  </OverviewCard>
}

function RecentPayments({ account, history }: { account: Account; history: To }) {
  const payments = account.payments.slice(0, previewLimit)
  return <OverviewCard title="История платежей" icon={<Receipt size={16} />}>
    {payments.length ? <>
      <ul className="crm-overview-records">{payments.map(payment => <li key={payment.id}>
        <div>
          <strong className="crm-number">{formatMoney(payment.amount_kopecks)}</strong>
          <time dateTime={payment.paid_at}>{formatDate(payment.paid_at)}</time>
        </div>
        <CrmBadge status={payment.status}>{paymentStatuses[payment.status]}</CrmBadge>
      </li>)}</ul>
      <OverviewLink to={history}>Все платежи</OverviewLink>
    </> : <p className="crm-overview-empty">По этому счёту платежей пока нет</p>}
  </OverviewCard>
}

function AccountIncidents({ account }: { account: Account }) {
  return <OverviewCard title="Сетевые инциденты" icon={<CircleAlert size={16} />} wide>
    {account.active_incidents.length ? <ul className="crm-incidents">
      {account.active_incidents.map(incident => <li key={incident.id} className="crm-incident">
        <CircleAlert size={17} aria-hidden="true" />
        <div>
          <strong>{incident.title}</strong>
          <p>{incident.description}</p>
          <small className="muted">{incident.id} · с {formatDate(incident.started_at)}</small>
          {incident.estimated_resolution_at && <small className="muted">Ожидаемое восстановление {formatDate(incident.estimated_resolution_at)}</small>}
        </div>
        <StatusBadge tone="warning">{incident.status === 'investigating' ? 'В работе' : 'Открыт'}</StatusBadge>
      </li>)}
    </ul> : <p className="crm-overview-empty">По этому адресу активных инцидентов нет</p>}
  </OverviewCard>
}

export function CustomerOverview({ customer, account, onSelectAccount, tickets, payments }: {
  customer: CustomerDetail
  account?: Account
  onSelectAccount: (number: string) => void
  tickets: To
  payments: To
}) {
  return <div className="crm-overview-grid" aria-label="Обзор клиента">
    <OverviewCard title="Контактные данные" icon={<UserRound size={16} />}>
      <dl className="crm-overview-fields">
        <div><dt>Телефон</dt><dd>{customer.phone ? <a href={'tel:' + customer.phone} className="crm-overview-link">{customer.phone}</a> : 'Нет данных'}</dd></div>
        <div><dt>Электронная почта</dt><dd className="muted">Нет данных</dd></div>
        <div><dt>Адрес подключения</dt><dd>{account?.address || 'Нет данных'}</dd></div>
      </dl>
    </OverviewCard>
    <OverviewCard title="Баланс" icon={<Wallet size={16} />}>
      {account ? <>
        <div className="crm-overview-balance crm-number" data-negative={account.balance_kopecks < 0}>{formatMoney(account.balance_kopecks)}</div>
        <StatusBadge tone={account.balance_kopecks < 0 ? 'danger' : 'success'}>
          {account.balance_kopecks < 0 ? 'Есть задолженность' : 'Без задолженности'}
        </StatusBadge>
        <p className="crm-overview-balance-account muted">Лицевой счёт {account.number}</p>
      </> : <p className="crm-overview-empty">Лицевой счёт не подключён</p>}
    </OverviewCard>
    <OverviewCard title="Лицевые счета" icon={<CreditCard size={16} />}>
      <AccountPicker accounts={customer.accounts} primaryNumber={customer.primary_account?.number}
        selectedNumber={account?.number} onSelect={onSelectAccount} />
    </OverviewCard>
    <OverviewCard title="Тариф и услуги" icon={<Wifi size={16} />}>
      {account ? <>
        <div className="crm-overview-service">
          <strong>{account.tariff_name}</strong>
          <CrmBadge status={account.service_status}>{serviceStatuses[account.service_status]}</CrmBadge>
        </div>
        <dl className="crm-overview-fields">
          <div><dt>Скорость</dt><dd>{formatNumber(account.speed_mbps)} Мбит/с</dd></div>
          <div><dt>Абонентская плата</dt><dd>{formatMoney(account.monthly_fee_kopecks)} в месяц</dd></div>
          <div><dt>Оборудование</dt><dd>{account.equipment || 'Нет данных'}</dd></div>
        </dl>
      </> : <p className="crm-overview-empty">Нет данных о подключении</p>}
    </OverviewCard>
    {account && <>
      <RecentTickets customerId={customer.id} accountNumber={account.number} history={tickets} />
      <RecentPayments account={account} history={payments} />
      <AccountIncidents account={account} />
    </>}
  </div>
}
