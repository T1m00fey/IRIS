import { useId, type ReactNode } from 'react'
import { CircleCheck, LockKeyhole, type LucideIcon } from 'lucide-react'

export function SettingsCard({ title, description, icon: Icon, badge, children }: {
  title: string
  description: string
  icon: LucideIcon
  badge?: string
  children: ReactNode
}) {
  const headingId = useId()
  return <section className="panel iris-settings-card" aria-labelledby={headingId}>
    <div className="iris-settings-card-heading">
      <span className="iris-settings-icon"><Icon size={24} aria-hidden="true" /></span>
      <div>
        <h2 id={headingId}>{title}</h2>
        <p>{description}</p>
      </div>
      {badge && <span className="badge badge-success">{badge}</span>}
    </div>
    {children}
  </section>
}

export function SettingRow({ title, description, descriptionId, icon: Icon, children }: {
  title: string
  description?: string
  descriptionId?: string
  icon?: LucideIcon
  children?: ReactNode
}) {
  return <div className="iris-settings-row">
    {Icon && <Icon size={19} className="iris-settings-row-icon" aria-hidden="true" />}
    <div className="iris-settings-row-copy">
      <strong>{title}</strong>
      {description && <small id={descriptionId}>{description}</small>}
    </div>
    {children}
  </div>
}

export function SettingSwitch({ title, description, checked, disabled, onChange }: {
  title: string
  description?: string
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => void
}) {
  const descriptionId = useId()
  return <SettingRow title={title} description={description} descriptionId={descriptionId}>
    <button type="button" className="iris-settings-switch" role="switch" aria-label={title}
      aria-describedby={description ? descriptionId : undefined} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}>
      <span />
    </button>
  </SettingRow>
}

export function UnavailableSetting({ title, reason }: { title: string; reason: string }) {
  return <SettingRow title={title} description={reason}>
    <LockKeyhole size={16} className="iris-settings-unavailable" aria-label="Недоступно" />
  </SettingRow>
}

export function PermissionList({ allowed, restricted }: { allowed: string[]; restricted: string }) {
  return <ul className="iris-settings-permissions">
    {allowed.map(label => <li key={label}><CircleCheck size={19} aria-hidden="true" />{label}</li>)}
    <li className="iris-settings-unavailable"><LockKeyhole size={16} aria-hidden="true" />{restricted}</li>
  </ul>
}
