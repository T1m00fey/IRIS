import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import type { Call, Collection, Dashboard, Employee, Ticket } from '../../types/operations'
import { moscowDay } from '../operator/data'
import { useContactCenterQueue, type QueueEntry } from './contact-center-data'

interface DailyActivity {
  date: string
  total_calls: number
  total_tickets: number
  accepted_calls: number
}

const pageSize = 100
const hourLength = 60 * 60 * 1000

async function loadHourlyCalls(day: string, signal: AbortSignal) {
  const start = Date.parse(day + 'T00:00:00+03:00')
  const series = Array<number>(24).fill(0)
  const seen = new Set<string>()
  for (let offset = 0; ; offset += pageSize) {
    const page = await api<Collection<Call>>('/api/v1/calls?limit=' + pageSize + '&offset=' + offset, { signal })
    for (const call of page.items) {
      const hour = Math.floor((Date.parse(call.started_at) - start) / hourLength)
      // The history endpoint returns newest calls first.
      if (hour < 0) return series
      if (hour < series.length && !seen.has(call.id)) {
        series[hour]++
        seen.add(call.id)
      }
    }
    if (!page.items.length || offset + page.items.length >= page.total) return series
  }
}

export function useManagerDashboard() {
  const [day, setDay] = useState(() => moscowDay())
  useEffect(() => {
    const timer = window.setInterval(() => setDay(moscowDay()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const previousDay = new Date(Date.parse(day) - 24 * hourLength).toISOString().slice(0, 10)
  const params = new URLSearchParams({ from_date: previousDay, to_date: day })
  const activity = useQuery({
    queryKey: ['analytics', 'manager-home', day],
    queryFn: ({ signal }) => api<{ daily: DailyActivity[] }>('/api/v1/manager/analytics?' + params, { signal }),
    refetchInterval: 30_000,
  })
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: ({ signal }) => api<Dashboard>('/api/v1/dashboard', { signal }),
  })
  const tickets = useQuery({
    queryKey: ['tickets', 'manager-home'],
    queryFn: ({ signal }) => api<Collection<Ticket>>('/api/v1/tickets?limit=5', { signal }),
  })
  const employees = useQuery({
    queryKey: ['employees'],
    queryFn: ({ signal }) => api<Employee[]>('/api/v1/employees', { signal }),
  })
  const hours = useQuery({
    queryKey: ['calls', 'manager-hours', day],
    queryFn: ({ signal }) => loadHourlyCalls(day, signal),
  })
  const queue = useContactCenterQueue()

  return {
    activity, dashboard, tickets, employees, hours, queue,
    today: activity.data?.daily.find(item => item.date === day),
    yesterday: activity.data?.daily.find(item => item.date === previousDay),
  }
}

export function summarizeVoiceQueue(snapshot: { items: QueueEntry[]; departments: { code: string; name: string }[] }, employees: Employee[] | undefined) {
  const assigned = new Set(snapshot.items.flatMap(item => item.assignment ? [item.assignment.employee_id] : []))
  const waiting = snapshot.items.filter(item => item.state !== 'connected')

  return snapshot.departments.map(department => {
    const calls = waiting.filter(item => item.department === department.code)
    const operators = employees?.filter(item => item.department === department.code)
    const available = operators?.filter(item => item.status === 'available' && !assigned.has(item.id)).length
    const averageWait = calls.length ? calls.reduce((sum, call) => sum + call.waiting_seconds, 0) / calls.length : null
    return { ...department, waiting: calls.length, available, averageWait }
  })
}
