import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Headset, Sparkles, VolumeX } from 'lucide-react'
import { Link } from 'react-router'
import { api } from '../../api/client'
import { StatusBadge } from '../../components/StatusBadge'
import { Button } from '../../components/ui/button'
import { formatDate, formatDuration } from '../../lib/format'
import { formatMoney, serviceStatuses } from '../crm/CrmElements'
import type { CustomerDetail } from '../crm/types'
import type { CallDetail } from '../../types/operations'
import { callDepartments, callStatuses, callTones, outcomes, phases, ticketStatuses, ticketTones } from './labels'

const speakers: Record<string, string> = { customer: 'Клиент', caller: 'Клиент', ai: 'ИИ', assistant: 'ИИ', operator: 'Оператор', system: 'Система' }
const eventNames: Record<string, string> = {
  'call.started': 'Начало звонка', 'call.connected': 'Соединение', 'call.ended': 'Звонок завершён',
  'call.handoff': 'Сводка согласована', 'call.summary_reviewed': 'Сводка проверена оператором',
  'ticket.created': 'Создано обращение', 'ticket.updated': 'Обращение обновлено',
}

export function VoiceControls({ call }: { call?: CallDetail }) {
  return <section className="panel content-panel" aria-label="Управление звонком">
    <div className="actions">{['Принять звонок', 'Завершить', 'Перевести', 'Удержание', 'Выключить микрофон'].map((label, index) =>
      <Button key={label} variant={index === 0 ? 'primary' : 'default'} disabled aria-describedby="voice-availability">{index === 0 && <Headset size={14} />}{label}</Button>)}</div>
    <p className="voice-status" id="voice-availability"><VolumeX size={15} />{call?.ended_at ? 'Звонок завершён. ' : ''}Голосовые функции доступны после подключения Voice.</p>
  </section>
}

export function CallSummary({ call }: { call: CallDetail }) {
  const client = useQueryClient()
  const review = useMutation({
    mutationFn: () => api<CallDetail>('/api/v1/calls/' + call.id + '/confirm-summary', { method: 'POST' }),
    onSuccess: updated => {
      client.setQueryData(['calls', call.id], updated)
      void client.invalidateQueries({ queryKey: ['calls'] })
    },
  })
  const handoff = call.handoff
  return <section className="panel content-panel summary-panel" aria-label="Сводка ИИ">
    <h2><Sparkles size={17} /> Сводка ИИ</h2>
    <p className="summary-main">{handoff?.summary || call.summary || 'Сводки для этого звонка пока нет.'}</p>
    {handoff && <>
      <dl className="key-values">
        <div><dt>Причина звонка</dt><dd>{handoff.customer_request}</dd></div>
        <div><dt>Что сообщил клиент и что уже проверил</dt><dd>{handoff.customer_report}</dd></div>
        <div><dt>Следующий шаг</dt><dd>{handoff.open_question}</dd></div>
        {handoff.secondary_questions.length > 0 && <div><dt>Другие вопросы</dt><dd>{handoff.secondary_questions.join(' · ')}</dd></div>}
        <div><dt>Согласовано с абонентом</dt><dd>{formatDate(handoff.confirmed_at)}</dd></div>
      </dl>
    </>}
    {(handoff || call.summary) && <div className="summary-review">
        {call.summary_reviewed_at ? <span role="status"><StatusBadge tone="success">Подтверждено оператором · {formatDate(call.summary_reviewed_at)}</StatusBadge></span> : <Button disabled={review.isPending} onClick={() => review.mutate()}>{review.isPending ? 'Подтверждение…' : 'Подтвердить итоговую сводку'}</Button>}
        {review.isError && <p className="alert" role="alert">{review.error.message}</p>}
      </div>}
  </section>
}

export function Transcript({ call }: { call: CallDetail }) {
  return <details className="panel content-panel disclosure">
    <summary>Транскрипция · {call.transcript.length}</summary>
    {call.transcript.length === 0 ? <p className="inline-empty">Реплики отсутствуют</p> : <ol className="timeline">
      {call.transcript.map(message => <li key={message.id}>
        <strong>{speakers[message.speaker] || message.speaker}</strong> · <time className="muted" dateTime={message.created_at}>{formatDate(message.created_at)}</time>
        <p>{message.text}</p>
      </li>)}
    </ol>}
  </details>
}

export function CallRecord({ call }: { call: CallDetail }) {
  const customer = useQuery({
    queryKey: ['customers', call.customer_id],
    queryFn: ({ signal }) => api<CustomerDetail>('/api/v1/customers/' + encodeURIComponent(call.customer_id!), { signal }),
    enabled: Boolean(call.customer_id && call.account_number),
  })
  const account = customer.data?.accounts.find(item => item.number === call.account_number)
  const profilePath = '/customers/' + call.customer_id + (call.account_number ? '?account=' + encodeURIComponent(call.account_number) : '')
  return <div className="detail-stack">
    <section className="panel content-panel">
      <h2>Клиент и звонок</h2>
      <dl className="key-values">
        <div><dt>Абонент</dt><dd>{call.customer_id ? <Link className="text-link" to={profilePath}>{call.customer_name || 'Карточка клиента'}</Link> : call.customer_name || 'Клиент не определён'}</dd></div>
        <div><dt>Телефон · Лицевой счёт</dt><dd>{call.caller_phone_masked || '—'} · {call.account_number || '—'}</dd></div>
        <div><dt>Отдел</dt><dd>{call.department ? callDepartments[call.department] ?? call.department : '—'}</dd></div>
        <div><dt>Технический статус</dt><dd><StatusBadge tone={callTones[call.status]}>{callStatuses[call.status]}</StatusBadge></dd></div>
        <div><dt>Фаза · Результат</dt><dd>{call.phase ? phases[call.phase] : '—'} · {outcomes[call.outcome]}</dd></div>
        <div><dt>Начало · Длительность</dt><dd>{formatDate(call.started_at)} · {formatDuration(call.duration_seconds)}</dd></div>
      </dl>
    </section>
    {call.customer_id && call.account_number && <section className="panel content-panel"><h2>Подключение</h2>
      {account ? <dl className="key-values">
        <div><dt>Адрес</dt><dd>{account.address}</dd></div>
        <div><dt>Тариф · Скорость</dt><dd>{account.tariff_name} · {account.speed_mbps} Мбит/с</dd></div>
        <div><dt>Баланс · Услуга</dt><dd>{formatMoney(account.balance_kopecks)} · {serviceStatuses[account.service_status]}</dd></div>
        {account.active_incidents.length > 0 && <div><dt>Активные инциденты</dt><dd>{account.active_incidents.map(incident => incident.title).join(' · ')}</dd></div>}
      </dl> : customer.isPending ? <p className="inline-empty" role="status">Загрузка подключения…</p> : customer.isError ? <div className="actions"><p className="alert" role="alert">{customer.error.message}</p><Button onClick={() => void customer.refetch()}>Повторить</Button></div> : <p className="inline-empty">Данные подключения отсутствуют</p>}
    </section>}
    <section className="panel content-panel"><h2>Связанные обращения</h2>
      {call.tickets.length === 0 ? <p className="inline-empty">Список пуст</p> : <ul className="fact-list">{call.tickets.map(ticket => <li key={ticket.id}>
        <Link className="text-link" to={'/tickets/' + ticket.id}>{ticket.title}</Link><small><StatusBadge tone={ticketTones[ticket.status]}>{ticketStatuses[ticket.status]}</StatusBadge></small>
      </li>)}</ul>}
    </section>
  </div>
}

export function CallChecks({ call }: { call: CallDetail }) {
  const checks = call.crm_checks.length ? call.crm_checks : call.handoff?.verified_facts || []
  return <section className="panel content-panel"><h2>Проверки CRM</h2>
    {checks.length === 0 ? <p className="inline-empty">Проверки отсутствуют</p> : <ul className="fact-list">{checks.map((fact, index) => <li key={index}>
      {fact.text}<small>{fact.source} · {formatDate(fact.checked_at)}</small>
    </li>)}</ul>}
  </section>
}

export function CallActivity({ call }: { call: CallDetail }) {
  return <>
    <section className="panel content-panel"><h2>Действия ИИ</h2>
      {call.ai_actions.length === 0 ? <p className="inline-empty">Действия отсутствуют</p> : <ul className="timeline">{call.ai_actions.map((action, index) => <li key={index}>
        <strong>{action.action}</strong>{action.result && <p>{action.result}</p>}<small>{formatDate(action.created_at)}</small>
      </li>)}</ul>}
    </section>
    <section className="panel content-panel"><h2>История событий</h2>
      {call.events.length === 0 ? <p className="inline-empty">События отсутствуют</p> : <ol className="timeline">{call.events.map((event, index) => <li key={index}>
        <strong>{eventNames[event.type] || event.type}</strong><small>{formatDate(event.created_at)}</small>{typeof event.details === 'string' && <p>{event.details}</p>}
      </li>)}</ol>}
    </section>
  </>
}
