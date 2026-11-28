import { useQuery } from '@tanstack/react-query'
import { api } from '../../../api/client'
import { departments } from '../../../features/operations/labels'
import type { Department, Employee } from '../../../types/operations'
import { useContactCenterQueue } from '../contact-center-data'

interface DepartmentProfile {
  code: string
  name: string
}

export interface ConnectedCall {
  call_id: string
  assignment: { employee_id: string; connected_at: string | null } | null
}

export function useTeam() {
  return useQuery({ queryKey: ['employees'], queryFn: ({ signal }) => api<Employee[]>('/api/v1/employees', { signal }) })
}

export function useTeamCalls() {
  const { data, isError, isPending, refetch } = useContactCenterQueue('connected')
  if (!data) return { data: undefined, isError, isPending, refetch }

  const calls = new Map<string, ConnectedCall>()
  for (const call of data.items) {
    if (call.assignment?.connected_at) calls.set(call.assignment.employee_id, call)
  }
  return { data: { calls, departments: data.departments, enabled: data.enabled }, isError, isPending, refetch }
}

export function teamDepartments(configured: DepartmentProfile[], people: Employee[], observed: Department[]) {
  const labels = new Map(configured.map(item => [item.code, item.name]))
  for (const code of new Set([...observed, ...people.map(person => person.department)])) {
    if (!labels.has(code)) labels.set(code, departments[code] ?? code)
  }
  return [...labels].map(([code, name]) => ({ code, name }))
}
