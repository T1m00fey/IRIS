import { UserRound } from 'lucide-react'
import { departments, employeeStatuses, employeeTones } from '../../features/operations/labels'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { PageHeading } from '../../components/PageHeading'
import { PageState } from '../../components/PageState'
import { StatusBadge } from '../../components/StatusBadge'
import { Button } from '../../components/ui/button'
import { useOperatorWorkspace } from './data'
import { CrmBadge, customerStatuses, formatMoney, serviceStatuses } from '../../features/crm/CrmElements'
import type { CustomerDetail } from '../../features/crm/types'

export { OperatorHome } from './OperatorHome'

export { PersonalAnalyticsPage as OperatorAnalytics } from './PersonalAnalytics'

export function OperatorCustomer() {
  const { customerId } = useParams()
  const query = useQuery({ queryKey: ['operator', 'customers', customerId], queryFn: ({signal}) => api<CustomerDetail>('/api/v1/operator/customers/' + encodeURIComponent(customerId!), {signal}), enabled: Boolean(customerId) })
  const customer = query.data
  return <><PageHeading title={customer?.full_name || 'Профиль клиента'} actions={<Button asChild><Link to="/workspace">Рабочее место</Link></Button>} />
  {!customer ? <PageState loading={query.isPending} error={query.error} retry={() => void query.refetch()} /> : <div className="layout-stack"><section className="panel content-panel"><h2>Контактные данные</h2><p>{customer.phone} <CrmBadge status={customer.status}>{customerStatuses[customer.status]}</CrmBadge></p></section>{customer.accounts.map(account => <section className="panel content-panel" key={account.number}><h2>Счёт {account.number}</h2><dl className="key-values"><div><dt>Подключение</dt><dd>{account.address}</dd></div><div><dt>Тариф · Скорость</dt><dd>{account.tariff_name} · {account.speed_mbps} Мбит/с</dd></div><div><dt>Баланс · Услуга</dt><dd>{formatMoney(account.balance_kopecks)} · {serviceStatuses[account.service_status]}</dd></div><div><dt>Оборудование</dt><dd>{account.equipment || '—'}</dd></div>{account.active_incidents.length > 0 && <div><dt>Сетевые инциденты</dt><dd>{account.active_incidents.map(incident => incident.title).join(' · ')}</dd></div>}</dl></section>)}</div>}
  </>
}

export function OperatorProfileDetails() {
  const workspace = useOperatorWorkspace()
  const employee = workspace.data?.employee
  if (!employee) return <PageState loading={workspace.isPending} error={workspace.error} retry={() => void workspace.refetch()} />
  return <section className="panel content-panel" id="shift"><h2><UserRound size={19} /> Рабочий профиль</h2><dl className="key-values"><div><dt>Отдел</dt><dd>{departments[employee.department] || employee.department}</dd></div><div><dt>Статус</dt><dd><StatusBadge tone={employeeTones[employee.status]}>{employeeStatuses[employee.status]}</StatusBadge></dd></div><div><dt>Специализация</dt><dd>{employee.skills?.join(' · ') || '—'}</dd></div><div><dt>Смена</dt><dd>{employee.on_shift === undefined ? 'Расписание пока недоступно' : employee.on_shift ? 'На смене' : 'Вне смены'}</dd></div></dl></section>
}
