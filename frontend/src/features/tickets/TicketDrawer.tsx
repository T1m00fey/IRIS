import { ApiError, api } from '../../api/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, CalendarDays, Check, CheckCircle2, Clock3, FileText, Phone, Play, Plus, Sparkles, UserRound, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { PageState } from '../../components/PageState'
import { StatusBadge } from '../../components/StatusBadge'
import { Button } from '../../components/ui/button'
import { formatDate, formatDuration } from '../../lib/format'
import type { CallDetail, Department, Ticket, TicketStatus } from '../../types/operations'
import { departments, priorities, ticketStatuses, ticketTones } from '../operations/labels'
import { ticketPath } from './data'

type TicketChange = { status?: TicketStatus; department?: Department }
type CustomerNote = { id: number; text: string; author_name: string; created_at: string }

function Block({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return <section className="ticket-detail-block">
    <h3>{icon}{title}</h3>
    {children}
  </section>
}

function TicketContext({ ticket }: { ticket: Ticket }) {
  const callId = ticket.call_id
  const call = useQuery({
    queryKey: ['calls', callId],
    queryFn: ({ signal }) => api<CallDetail>('/api/v1/calls/' + encodeURIComponent(callId!), { signal }),
    enabled: Boolean(callId),
    retry: false,
  })
  const handoff = call.data?.handoff?.ticket_id === ticket.id ? call.data.handoff : null
  const summary = handoff?.summary || call.data?.summary
  const description = handoff?.customer_request || (ticket.summary !== summary ? ticket.summary : null)
  const facts = handoff?.verified_facts.length ? handoff.verified_facts : call.data?.crm_checks
  const questions = [handoff?.open_question, ...(handoff?.secondary_questions ?? [])].filter(Boolean)
  const history = [
    { date: ticket.created_at, title: 'Обращение создано' },
    { date: ticket.started_at, title: 'Обработка началась' },
    { date: ticket.closed_at, title: 'Обращение закрыто' },
  ]
  return <>
    {summary && <section className="ticket-summary">
      <h3><Sparkles size={17} aria-hidden="true" /> Сводка ИИ</h3>
      <p>{summary}</p>
    </section>}
    <Block title="Содержание обращения">
      {description && description !== ticket.title && <p>{description}</p>}
      <dl className="ticket-detail-grid">
        <div><dt>Отдел и приоритет</dt><dd>{departments[ticket.department]} · {priorities[ticket.priority]}</dd></div>
        <div><dt>Время ожидания</dt><dd>{formatDuration(ticket.waiting_seconds)}</dd></div>
      </dl>
    </Block>
    <Block title="Клиент и ответственный" icon={<UserRound size={16} aria-hidden="true" />}>
      <dl className="ticket-detail-grid">
        <div><dt>Клиент</dt><dd>{ticket.customer_id
          ? <Link className="text-link" to={'/customers/' + encodeURIComponent(ticket.customer_id)}>{ticket.customer_name || 'Карточка клиента'}</Link>
          : ticket.customer_name || '—'}</dd></div>
        <div><dt>Лицевой счёт</dt><dd>{ticket.account_number || '—'}</dd></div>
        {call.data?.caller_phone_masked && <div><dt>Телефон</dt><dd>{call.data.caller_phone_masked}</dd></div>}
        <div><dt>Ответственный</dt><dd>{ticket.assigned_employee_name || 'Без назначения'}</dd></div>
      </dl>
    </Block>
    {Boolean(facts?.length) && <Block title="Проверенные факты" icon={<CheckCircle2 size={16} aria-hidden="true" />}>
      <ul className="ticket-facts">{facts?.map((fact, index) => <li key={fact.source + fact.checked_at + index}>
        {fact.text}<small>{[fact.source, fact.checked_at && formatDate(fact.checked_at)].filter(Boolean).join(' · ')}</small>
      </li>)}</ul>
    </Block>}
    {questions.length > 0 && <Block title="Открытые вопросы">
      <ul className="ticket-questions">{questions.map((question, index) => <li key={index}>{question}</li>)}</ul>
    </Block>}
    <Block title="История обработки" icon={<Clock3 size={16} aria-hidden="true" />}>
      <ol className="ticket-history">{history.map(({ title, date }) => date && <li key={title}>
        <strong>{title}</strong><time dateTime={date}>{formatDate(date)}</time>
      </li>)}</ol>
    </Block>
    <Block title="Связанные звонки" icon={<Phone size={16} aria-hidden="true" />}>
      {callId ? <Link className="ticket-call-link text-link" to={'/calls/' + encodeURIComponent(callId)}>
        <span>Открыть звонок</span><small>{call.data ? formatDate(call.data.started_at) : callId}</small>
      </Link> : <p className="muted">Связанных звонков нет</p>}
    </Block>
  </>
}

function TicketDrawerContent({ ticket }: { ticket: Ticket }) {
  const client = useQueryClient()
  const [department, setDepartment] = useState<Department | ''>('')
  const [feedback, setFeedback] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [noteText, setNoteText] = useState('')
  const notePath = '/api/v1/customers/' + encodeURIComponent(ticket.customer_id ?? '') + '/notes'
  const noteKey = ['customers', ticket.customer_id, 'notes']
  const notes = useQuery({
    queryKey: noteKey,
    queryFn: ({ signal }) => api<CustomerNote[]>(notePath, { signal }),
    enabled: Boolean(ticket.customer_id),
    retry: false,
  })
  const noteApiUnavailable = notes.error instanceof ApiError && [403, 404, 405].includes(notes.error.status)
  const saveNote = useMutation({
    mutationFn: (text: string) => api<CustomerNote>(notePath, { method: 'POST', body: JSON.stringify({ text }) }),
    onSuccess: saved => {
      client.setQueryData<CustomerNote[]>(noteKey, current => [saved, ...(current ?? [])])
      void client.invalidateQueries({ queryKey: noteKey })
      setNoteText('')
      setAddingNote(false)
      setFeedback('Заметка о клиенте сохранена')
    },
  })
  const update = useMutation({
    mutationFn: (patch: TicketChange) => api<Ticket>(ticketPath(ticket.id), { method: 'PATCH', body: JSON.stringify(patch) }),
    onMutate: () => setFeedback(''),
    onSuccess: (updated, patch) => {
      client.setQueryData(['tickets', ticket.id], updated)
      for (const key of ['tickets', 'dashboard', 'calls', 'customers']) void client.invalidateQueries({ queryKey: [key] })
      setDepartment('')
      setFeedback(patch.department ? 'Обращение перенаправлено' : patch.status === 'closed' ? 'Обращение закрыто' : 'Обращение принято в работу')
    },
    onError: () => void client.invalidateQueries({ queryKey: ['tickets', ticket.id] }),
  })

  function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (noteText.trim() && !saveNote.isPending) saveNote.mutate(noteText.trim())
  }

  const canAddNote = Boolean(notes.data) && !noteApiUnavailable
  const canUpdate = ticket.status !== 'closed'
  const currentDepartment = department === ticket.department ? '' : department
  return <>
    <div className="ticket-detail-content">
      <TicketContext ticket={ticket} />
      {ticket.customer_id && !noteApiUnavailable && <Block title="Заметки о клиенте" icon={<FileText size={16} aria-hidden="true" />}>
        {notes.isPending && <p className="muted" role="status">Загрузка заметок…</p>}
        {notes.isError && <div role="alert" className="ticket-inline-error">
          <p>Не удалось загрузить заметки</p><Button variant="ghost" onClick={() => void notes.refetch()}>Повторить</Button>
        </div>}
        {notes.data && (notes.data.length ? <ul className="ticket-note-list">{notes.data.map(note => <li key={note.id}>
          <p>{note.text}</p><small>{note.author_name} · {formatDate(note.created_at)}</small>
        </li>)}</ul> : <p className="muted">Заметок о клиенте пока нет</p>)}
      </Block>}
    </div>
    {(canUpdate || canAddNote || feedback || update.isError) && <footer className="ticket-detail-footer">
      {canUpdate && <div className="ticket-actions">
        <label className="ticket-control">
          <span>Перенаправление в отдел</span>
          <select aria-label="Новый отдел" className="field" value={currentDepartment} disabled={update.isPending}
            onChange={event => setDepartment(event.target.value as Department | '')}>
            <option value="">Выберите отдел</option>
            {Object.entries(departments).filter(([key]) => key !== ticket.department).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <Button disabled={!currentDepartment || update.isPending} onClick={() => {
          if (currentDepartment) update.mutate({ department: currentDepartment })
        }}><ArrowRightLeft size={15} aria-hidden="true" /> Перенаправить</Button>
      </div>}
      <div className="ticket-actions">
        {ticket.status === 'queued' && <Button variant="primary" disabled={update.isPending}
          onClick={() => update.mutate({ status: 'in_progress' })}><Play size={15} aria-hidden="true" /> Начать обработку</Button>}
        {ticket.status === 'in_progress' && <Button variant="primary" disabled={update.isPending}
          onClick={() => update.mutate({ status: 'closed' })}><Check size={16} aria-hidden="true" /> Закрыть обращение</Button>}
        {canAddNote && !addingNote && <Button onClick={() => { setFeedback(''); setAddingNote(true) }}>
          <Plus size={16} aria-hidden="true" /> Добавить заметку о клиенте
        </Button>}
      </div>
      {addingNote && <form className="ticket-note-form" onSubmit={submitNote}>
        <label className="ticket-control">Новая заметка о клиенте
          <textarea className="field" value={noteText} onChange={event => setNoteText(event.target.value)} rows={3} maxLength={4000} disabled={saveNote.isPending} autoFocus required />
        </label>
        <div className="ticket-actions">
          <Button variant="primary" type="submit" disabled={saveNote.isPending || !noteText.trim()}>Сохранить заметку</Button>
          <Button variant="ghost" disabled={saveNote.isPending} onClick={() => { saveNote.reset(); setAddingNote(false) }}>Отмена</Button>
        </div>
        {saveNote.isError && <p className="alert" role="alert">{saveNote.error.message}</p>}
      </form>}
      {update.isError && <p className="alert" role="alert">{update.error.message}</p>}
      {feedback && <p className="success" role="status">{feedback}</p>}
    </footer>}
  </>
}

export function TicketDrawer({ ticketId, search }: { ticketId: string; search: string }) {
  const closeLink = useRef<HTMLAnchorElement>(null)
  const query = useQuery({
    queryKey: ['tickets', ticketId],
    queryFn: ({ signal }) => api<Ticket>(ticketPath(ticketId), { signal }),
    retry: (attempt, error) => !(error instanceof ApiError && error.status === 404) && attempt < 1,
  })
  useEffect(() => {
    closeLink.current?.focus({ preventScroll: true })
  }, [ticketId])
  const notFound = query.error instanceof ApiError && query.error.status === 404
  const ticket = query.data
  return <aside className="panel ticket-detail" aria-labelledby="ticket-detail-title" onKeyDown={event => {
    if (event.key === 'Escape' && !(event.target instanceof HTMLTextAreaElement)) closeLink.current?.click()
  }}>
    <header className="ticket-detail-header">
      <div>
        <div className="ticket-detail-meta"><span className="numeric">{ticketId}</span>
          {ticket && <StatusBadge tone={ticketTones[ticket.status]}>{ticketStatuses[ticket.status]}</StatusBadge>}
        </div>
        <h2 id="ticket-detail-title">{ticket?.title ?? 'Карточка обращения'}</h2>
        {ticket && <p><CalendarDays size={14} aria-hidden="true" /> Создано {formatDate(ticket.created_at)}</p>}
      </div>
      <Button variant="ghost" className="icon-button" asChild>
        <Link ref={closeLink} aria-label="Закрыть карточку обращения" to={{ pathname: '/tickets', search }} state={{ returnToTicket: ticketId }} preventScrollReset><X size={18} /></Link>
      </Button>
    </header>
    {ticket ? <TicketDrawerContent ticket={ticket} /> : <PageState loading={query.isPending} error={notFound ? null : query.error}
      retry={() => void query.refetch()} empty="Обращение не найдено" />}
  </aside>
}
