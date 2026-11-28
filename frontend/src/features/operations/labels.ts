import type { Call, CallStatus, Department, EmployeeStatus, Priority, TicketStatus, Tone } from '../../types/operations'

export const departments: Record<Department, string> = { technical_support: 'Техподдержка', billing: 'Платежи', connection: 'Подключения' }
export const callStatuses: Record<CallStatus, string> = { ringing: 'Входящий', active: 'Активный', completed: 'Завершён', abandoned: 'Пропущен', failed: 'Сбой' }
export const callTones: Record<CallStatus, Tone> = { ringing: 'info', active: 'success', completed: 'neutral', abandoned: 'warning', failed: 'danger' }
export const outcomes: Record<Call['outcome'], string> = { unknown: 'В работе', answered: 'Консультация', ticket_created: 'Создано обращение', unresolved: 'Не решено', no_confirmation: 'Без подтверждения' }
export const phases: Record<NonNullable<Call['phase']>, string> = { ai_active: 'Диалог с ИИ', waiting_for_operator: 'Ожидает оператора', operator_joining: 'Подключение', with_operator: 'У оператора' }
export const ticketStatuses: Record<TicketStatus, string> = { queued: 'В очереди', in_progress: 'В работе', closed: 'Закрыто' }
export const ticketTones: Record<TicketStatus, Tone> = { queued: 'warning', in_progress: 'info', closed: 'success' }
export const priorities: Record<Priority, string> = { high: 'Высокий', normal: 'Обычный', low: 'Низкий' }
export const employeeStatuses: Record<EmployeeStatus, string> = { available: 'На линии', busy: 'Занят', paused: 'На паузе', offline: 'Офлайн', lunch: 'Обед', wrap_up: 'Постобработка' }
export const employeeTones: Record<EmployeeStatus, Tone> = { available: 'success', busy: 'info', paused: 'warning', offline: 'neutral', lunch: 'warning', wrap_up: 'info' }
