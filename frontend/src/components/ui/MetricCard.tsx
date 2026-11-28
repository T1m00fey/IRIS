import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export function MetricCard({ label, value, icon: Icon, textValue = false }: {
  label: string; value: ReactNode; icon?: LucideIcon; textValue?: boolean
}) {
  return <div className="panel v3-metric">
    {Icon && <span className="icon-chip" aria-hidden="true"><Icon size={22} /></span>}
    <div className="metric-copy">
      <div className="metric-caption">{label}</div>
      <strong className={textValue ? 'metric-status' : undefined}>{value ?? '—'}</strong>
    </div>
  </div>
}
