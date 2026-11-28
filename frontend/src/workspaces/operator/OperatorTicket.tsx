import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { api } from '../../api/client'
import { PageHeading } from '../../components/PageHeading'
import { PageState } from '../../components/PageState'
import { StatusBadge } from '../../components/StatusBadge'
import { Button } from '../../components/ui/button'
import { ticketStatuses, ticketTones } from '../../features/operations/labels'
import { formatDate } from '../../lib/format'
import type { CallDetail, Ticket } from '../../types/operations'

interface TicketContext {
  ticket: Ticket
  handoff: CallDetail['handoff']
  events: CallDetail['events']
}

export function OperatorTicket() {
  const { ticketId } = useParams()
  const query = useQuery({ queryKey: ['operator', 'tickets', ticketId], queryFn: ({signal}) => api<TicketContext>('/api/v1/operator/tickets/' + encodeURIComponent(ticketId!), {signal}) })
  const data = query.data
  const back = '/workspace' + (data?.ticket.call_id ? '?call=' + encodeURIComponent(data.ticket.call_id) : '')
  return <><PageHeading title={data?.ticket.title || 'Карточка обращения'} subtitle={ticketId} actions={<Button asChild><Link to={back}>Рабочее место</Link></Button>} />
    {data ? <div className="layout-stack"><section className="panel content-panel"><StatusBadge tone={ticketTones[data.ticket.status]}>{ticketStatuses[data.ticket.status]}</StatusBadge><h2>Содержание обращения</h2><p>{data.handoff?.summary || data.ticket.summary}</p>{data.handoff?.open_question && <p>{data.handoff.open_question}</p>}</section>
    <section className="panel content-panel"><h2>История обслуживания</h2><ul className="work-items">{data.events.map((event, index) => <li key={index}><span>{typeof event.details === 'string' ? event.details : event.type}</span><time dateTime={event.created_at}>{formatDate(event.created_at)}</time></li>)}</ul>{!data.events.length && <p className="inline-empty">История пока пуста</p>}</section></div>
    : <PageState loading={query.isPending} error={query.error} retry={() => void query.refetch()} />}
  </>
}
