import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { StatusBadge } from '../../components/StatusBadge'
import { Button } from '../../components/ui/button'
import type { Tone } from '../../types/operations'
import type { Payment } from './types'

const rubles = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export const customerStatuses = {
  active: 'Активен',
  suspended: 'Приостановлен',
  inactive: 'Неактивен',
}

export const serviceStatuses = {
  active: 'Подключена',
  suspended: 'Приостановлена',
  disconnected: 'Отключена',
}

export const paymentStatuses: Record<Payment['status'], string> = {
  credited: 'Зачислен',
  pending: 'В обработке',
  failed: 'Отклонён',
}

export function formatMoney(kopecks: number) {
  return rubles.format(kopecks / 100)
}

export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

const statusTones: Record<string, Tone> = {
  active: 'success',
  credited: 'success',
  suspended: 'warning',
  pending: 'warning',
  failed: 'danger',
}

export function CrmBadge({ status, children }: { status: string; children: ReactNode }) {
  return <StatusBadge tone={statusTones[status]}>{children}</StatusBadge>
}

export function CrmState({ title, description, children, error = false }: {
  title: string
  description?: string
  children?: ReactNode
  error?: boolean
}) {
  return (
    <div className="crm-state" role={error ? 'alert' : 'status'}>
      <strong>{title}</strong>
      {description && <p className="muted">{description}</p>}
      {children}
    </div>
  )
}

export function CrmPagination({ offset, limit, total, onChange, busy = false }: {
  offset: number
  limit: number
  total: number
  onChange: (offset: number) => void
  busy?: boolean
}) {
  return (
    <div className="crm-pagination" aria-label="Пагинация">
      <span className="muted" aria-live="polite">
        {total ? `${offset + 1}–${Math.min(offset + limit, total)} из ${total}` : '0 записей'}
      </span>
      <div className="crm-pagination-actions">
        <Button variant="ghost" aria-label="Предыдущая страница" disabled={busy || offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}>
          <ChevronLeft size={16} />
        </Button>
        <Button variant="ghost" aria-label="Следующая страница" disabled={busy || offset + limit >= total}
          onClick={() => onChange(offset + limit)}>
          <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  )
}
