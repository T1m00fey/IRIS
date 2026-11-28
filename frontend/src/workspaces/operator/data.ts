import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import type { Call, CallDetail, Employee, Ticket } from '../../types/operations'

export interface OperatorNote { id: number; call_id: string; text: string; created_at: string }
export interface OperatorCall extends CallDetail { notes: OperatorNote[] }
export interface OperatorWorkspace {
  employee: Omit<Employee, 'is_current'> & { skills?: string[]; on_shift?: boolean }
  voice_available: boolean
  assignment: { id: string; call_id: string; state: string; offered_at: string; connected_at: string | null } | null
  call_id: string | null
  calls: Call[]
  history: Call[]
  tickets: Ticket[]
  waiting_calls: number
}
export interface PersonalAnalytics {
  from_date: string; to_date: string
  accepted_calls: number; resolved_tickets: number
  average_duration_seconds: number | null; line_seconds: number | null
  daily: { date: string; accepted_calls: number; resolved_tickets: number }[]
}
export const workspaceKey = ['operator', 'workspace']
export function useOperatorWorkspace(enabled = true) {
  return useQuery({ queryKey: workspaceKey, queryFn: ({ signal }) => api<OperatorWorkspace>('/api/v1/operator/workspace', { signal }), enabled, refetchInterval: 4000, staleTime: 2000 })
}
export function usePersonalAnalytics(from: string, to: string) {
  return useQuery({ queryKey: ['operator', 'analytics', from, to], queryFn: ({ signal }) => api<PersonalAnalytics>('/api/v1/operator/analytics?from_date=' + from + '&to_date=' + to, { signal }), enabled: Boolean(from && to && from <= to) })
}
export function moscowDay(daysAgo = 0) {
  return new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'}).format(Date.now() - daysAgo * 86400000)
}
