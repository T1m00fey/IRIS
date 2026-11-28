export type Department = 'technical_support' | 'billing' | 'connection'
export type CallStatus = 'ringing' | 'active' | 'completed' | 'abandoned' | 'failed'
export type TicketStatus = 'queued' | 'in_progress' | 'closed'
export type Priority = 'high' | 'normal' | 'low'
export type EmployeeStatus = 'available' | 'busy' | 'paused' | 'offline' | 'lunch' | 'wrap_up'
export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

export interface Collection<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface Call {
  id: string
  status: CallStatus
  phase: 'ai_active' | 'waiting_for_operator' | 'operator_joining' | 'with_operator' | null
  outcome: 'unknown' | 'answered' | 'ticket_created' | 'unresolved' | 'no_confirmation'
  department: string | null
  caller_phone_masked: string | null
  started_at: string
  ended_at: string | null
  customer_id: string | null
  customer_name: string | null
  account_number: string | null
  duration_seconds: number | null
  summary: string | null
}

export interface VerifiedFact { text: string; source: string; checked_at: string }
export interface Handoff {
  ticket_id: string
  customer_request: string
  summary: string
  customer_report: string
  verified_facts: VerifiedFact[]
  assumptions?: string[]
  actions_taken?: string[]
  open_question: string
  secondary_questions: string[]
  confirmed_at: string
}

export interface CallDetail extends Call {
  handoff: Handoff | null
  can_join: boolean
  summary_reviewed_at: string | null
  transcript: { id: number; speaker: string; text: string; created_at: string }[]
  crm_checks: VerifiedFact[]
  ai_actions: { action: string; result: string | null; created_at: string }[]
  tickets: Ticket[]
  events: { type: string; details: string | Record<string, unknown> | null; created_at: string }[]
}

export interface Ticket {
  id: string
  call_id: string | null
  customer_id: string | null
  customer_name: string | null
  account_number: string | null
  department: Department
  status: TicketStatus
  priority: Priority
  title: string
  summary: string | null
  created_at: string
  started_at: string | null
  closed_at: string | null
  waiting_seconds: number
  assigned_employee_name: string | null
}

export interface Incident {
  id: string
  title: string
  address?: string | null
  description?: string | null
  status?: 'open' | 'investigating'
  estimated_resolution_at?: string | null
  started_at?: string | null
}

export interface Dashboard {
  total_calls: number
  active_calls: number
  completed_calls: number
  total_tickets: number
  average_duration_seconds: number | null
  tickets_by_department: { department: Department; count: number }[]
  recent_calls: Call[]
  active_incidents: Incident[]
}

export type Specialization = 'SALES' | 'L1' | 'L2'

export interface Employee {
  id: string
  full_name: string
  department: Department
  status: EmployeeStatus
  is_current: boolean
  updated_at: string
  specializations: Specialization[] | null
  on_shift: boolean
}
