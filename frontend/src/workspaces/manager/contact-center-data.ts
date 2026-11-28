import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { callStatuses, callTones, departments } from '../../features/operations/labels'
import type { Call, Collection, Employee, Priority, Tone } from '../../types/operations'

export interface LiveCall extends Omit<Call, 'department'> {
  department: string | null
  connected_at?: string | null
}

interface Assignment {
  employee_id: string
  employee_name: string
  connected_at: string | null
}

export interface QueueEntry {
  call_id: string
  department: string
  state: 'waiting' | 'offered' | 'connecting' | 'connected'
  priority: Priority
  category: string | null
  waiting_seconds: number
  assignment: Assignment | null
}

type DepartmentOption = { code: string; name: string }
interface Snapshot extends Collection<QueueEntry> {
  enabled: boolean
  departments: DepartmentOption[]
}

export const teamDepartments = Object.entries(departments).map(([code, name]) => ({ code, name }))

export const queueStates: Record<QueueEntry['state'], { label: string; tone: Tone }> = {
  waiting: { label: 'Ожидает оператора', tone: 'warning' },
  offered: { label: 'Предложен сотруднику', tone: 'info' },
  connecting: { label: 'Подключается', tone: 'neutral' },
  connected: { label: 'Разговор с оператором', tone: 'success' },
}

const livePhases = {
  ai_active: { label: 'Обслуживается ИИ', tone: 'success' },
  waiting_for_operator: queueStates.waiting,
  operator_joining: queueStates.connecting,
  with_operator: queueStates.connected,
} satisfies Record<NonNullable<Call['phase']>, { label: string; tone: Tone }>

export function callState(call: LiveCall, entry?: QueueEntry) {
  if (entry && call.status === 'active') return queueStates[entry.state]
  if (call.phase && call.status === 'active') return livePhases[call.phase]
  return { label: callStatuses[call.status], tone: callTones[call.status] }
}

const pageSize = 100

async function loadPages<T, P extends Collection<T>>(
  path: string, key: (item: T) => string, signal: AbortSignal, shouldRead: (first: P) => boolean = () => true,
) {
  const request = (offset: number) => api<P>(path + 'limit=' + pageSize + '&offset=' + offset, { signal })
  const first = await request(0)
  if (!shouldRead(first)) return { ...first, items: [] }

  const items = new Map(first.items.map(item => [key(item), item]))
  let offset = first.offset + first.items.length
  while (first.items.length && offset < first.total) {
    const page = await request(offset)
    if (!page.items.length) break
    for (const item of page.items) items.set(key(item), item)
    offset += page.items.length
    if (offset >= page.total) break
  }
  return { ...first, items: Array.from(items.values()) }
}

export function useContactCenterQueue(state?: 'connected') {
  const path = '/api/v1/manager/contact-center?' + (state ? 'state=' + state + '&' : '')
  return useQuery({
    queryKey: ['calls', 'contact-center-queue', state ?? 'all'],
    queryFn: ({ signal }) => loadPages<QueueEntry, Snapshot>(path, row => row.call_id, signal, first => first.enabled),
    refetchInterval: 5000,
  })
}

export function useContactCenterData() {
  const calls = useQuery({
    queryKey: ['calls', 'contact-center-live'],
    queryFn: ({ signal }) => loadPages<LiveCall, Collection<LiveCall>>('/api/v1/calls?live=true&', call => call.id, signal),
    refetchInterval: 5000,
  })
  const queue = useContactCenterQueue()
  const employees = useQuery({
    queryKey: ['employees'],
    queryFn: ({ signal }) => api<Employee[]>('/api/v1/employees', { signal }),
  })
  return { calls, queue, employees }
}

export function elapsed(start: string | null | undefined, now: number) {
  const time = start ? Date.parse(start) : NaN
  return Number.isFinite(time) ? Math.floor(Math.max(0, now - time) / 1000) : null
}
