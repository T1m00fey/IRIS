import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import type { Call, Collection, Employee, Ticket } from '../../types/operations'

interface Activity {
  total_calls: number
  accepted_calls: number
  abandoned_calls: number
  total_tickets: number
  resolved_tickets: number
}

interface ActivityMetrics extends Activity {
  average_answer_seconds: number | null
  average_duration_seconds: number | null
  average_wait_seconds: number | null
}

export interface DailyActivity extends Activity {
  date: string
}

export interface CompanyReport extends ActivityMetrics {
  daily: DailyActivity[]
  by_department: (ActivityMetrics & { department: string | null; name: string })[]
  departments: { code: string; name: string }[]
  outcomes: { outcome: Call['outcome']; count: number }[]
}

export interface ReportFilters {
  from: string
  to: string
  department: string
  employee: string
}

const dayMs = 86400000
const dayFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeZone: 'UTC' })
const moscowDate = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeZone: 'Europe/Moscow' })

function dateMs(day: string) {
  return Date.parse(day + 'T00:00:00Z')
}

export function validRange({ from, to }: ReportFilters) {
  const days = (dateMs(to) - dateMs(from)) / dayMs + 1
  return days >= 1 && days <= 366 && from > '0001-01-01' && to > '0001-01-07' && to < '9999-12-31'
}

export function previousRange(filters: ReportFilters): ReportFilters {
  const end = dateMs(filters.from) - dayMs
  const start = end - (dateMs(filters.to) - dateMs(filters.from))
  const iso = (date: number) => Number.isFinite(date) ? new Date(date).toISOString().slice(0, 10) : ''
  return { ...filters, from: iso(start), to: iso(end) }
}

export function formatReportDay(day: string, full = false) {
  return (full ? dateFormat : dayFormat).format(dateMs(day)).replace(/.$/, '')
}

function params({ from, to, department, employee }: ReportFilters) {
  const query = new URLSearchParams({ from_date: from, to_date: to })
  if (department) query.set('department', department)
  if (employee) query.set('employee_id', employee)
  return query.toString()
}

function getReport(filters: ReportFilters, signal: AbortSignal) {
  return api<CompanyReport>('/api/v1/manager/analytics?' + params(filters), { signal })
}

export function useCompanyReport(filters: ReportFilters) {
  return useQuery({
    queryKey: ['analytics', 'report', params(filters)],
    queryFn: ({ signal }) => getReport(filters, signal),
    enabled: validRange(filters),
  })
}

export interface EmployeeActivity {
  person: Employee
  calls: number
  duration: number | null
  resolved: number
}

export function employeeActivity(person: Employee, report: CompanyReport): EmployeeActivity {
  return {
    person,
    calls: report.accepted_calls,
    duration: report.average_duration_seconds,
    resolved: report.resolved_tickets,
  }
}

export function useEmployeeActivity(filters: ReportFilters, people: Employee[]) {
  return useQuery({
    queryKey: ['analytics', 'employee-activity', params(filters), people.map(person => person.id)],
    enabled: validRange(filters) && !filters.employee && people.length > 0,
    queryFn: async ({ signal }) => {
      const rows: EmployeeActivity[] = []
      const batchSize = 6
      for (let start = 0; start < people.length; start += batchSize) {
        const batch = await Promise.all(people.slice(start, start + batchSize).map(async person =>
          employeeActivity(person, await getReport({ ...filters, employee: person.id }, signal)),
        ))
        rows.push(...batch)
      }
      return rows.filter(row => row.calls || row.resolved).sort((a, b) =>
        b.calls - a.calls || b.resolved - a.resolved || a.person.full_name.localeCompare(b.person.full_name, 'ru'),
      )
    },
  })
}

type ReportTicket = Pick<Ticket, 'id' | 'status' | 'department' | 'created_at' | 'started_at' | 'closed_at'> & {
  assigned_employee_id: string | null
}

export function useTicketProcessing(filters: ReportFilters, created: number) {
  return useQuery({
    queryKey: ['tickets', 'analytics', params(filters), created],
    enabled: validRange(filters) && created > 0,
    queryFn: async ({ signal }) => {
      const counts = { queued: 0, in_progress: 0, closed: 0 }
      const seen = new Set<string>()
      let duration = 0
      let measured = 0
      let knownTotal = 0
      const limit = 100
      for (let offset = 0; ; offset += limit) {
        const page = await api<Collection<ReportTicket>>(
          '/api/v1/tickets?sort=newest&limit=' + limit + '&offset=' + offset, { signal },
        )
        let earlier = false
        for (const ticket of page.items) {
          const day = moscowDate.format(new Date(ticket.created_at))
          if (day < filters.from) { earlier = true; break }
          if (day > filters.to || seen.has(ticket.id)) continue
          if (filters.department && ticket.department !== filters.department) continue
          if (filters.employee && ticket.assigned_employee_id !== filters.employee) continue
          seen.add(ticket.id)
          counts[ticket.status]++
          knownTotal++
          if (ticket.status !== 'closed' || !ticket.closed_at || !ticket.started_at) continue
          const seconds = (Date.parse(ticket.closed_at) - Date.parse(ticket.started_at)) / 1000
          if (seconds >= 0) {
            duration += seconds
            measured++
          }
        }
        if (earlier || !page.items.length || offset + page.items.length >= page.total) break
      }
      if (knownTotal !== created) throw new Error('Список обращений изменился во время расчёта')
      return { counts, averageSeconds: measured ? duration / measured : null }
    },
  })
}
