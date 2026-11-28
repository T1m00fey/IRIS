import { api } from '../../api/client'
import type { Collection, Ticket, TicketStatus } from '../../types/operations'

export const ticketTabs = [
  { status: '', label: 'Все обращения' },
  { status: 'queued', label: 'В очереди' },
  { status: 'in_progress', label: 'В работе' },
  { status: 'closed', label: 'Закрытые' },
] as const

export const ticketListPath = '/api/v1/tickets'
export const unassigned = 'unassigned:'

export function ticketPath(id: string) {
  return ticketListPath + '/' + encodeURIComponent(id)
}

export function getTicketPage(filters: string, limit: number, offset: number, signal: AbortSignal) {
  const params = new URLSearchParams(filters)
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  return api<Collection<Ticket>>(ticketListPath + '?' + params, { signal })
}

export async function getMatchingTickets(filters: string, signal: AbortSignal) {
  // Search and assignee filters apply to the full server-filtered list before UI pagination.
  const limit = 100
  const tickets = new Map<string, Ticket>()
  let offset = 0
  while (true) {
    const { items, total } = await getTicketPage(filters, limit, offset, signal)
    for (const ticket of items) tickets.set(ticket.id, ticket)
    offset += items.length
    if (items.length === 0 || offset >= total) return [...tickets.values()]
  }
}

export async function getTicketCounts(filters: string, signal: AbortSignal) {
  const statuses: TicketStatus[] = ['queued', 'in_progress', 'closed']
  const [queued, in_progress, closed] = await Promise.all(statuses.map(async status => {
    const params = new URLSearchParams(filters)
    params.set('status', status)
    const { total } = await getTicketPage(params.toString(), 1, 0, signal)
    return total
  }))
  return { queued, in_progress, closed, '': queued + in_progress + closed }
}

function normalize(value: string) {
  return value.toLocaleLowerCase('ru').replaceAll('ё', 'е')
}

export function filterTickets(tickets: Ticket[], search: string, assignee: string) {
  const words = normalize(search).split(/\s+/u).filter(Boolean)
  return tickets.filter(ticket => {
    const name = ticket.assigned_employee_name || ''
    if (assignee && (assignee === unassigned ? name !== '' : name !== assignee)) return false
    const searchable = normalize([ticket.id, ticket.customer_name, ticket.title].join(' '))
    return words.every(word => searchable.includes(word))
  })
}

export function countTickets(tickets: Ticket[]) {
  const counts: Record<TicketStatus | '', number> = { '': tickets.length, queued: 0, in_progress: 0, closed: 0 }
  for (const ticket of tickets) counts[ticket.status]++
  return counts
}
