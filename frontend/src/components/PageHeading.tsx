import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export const PageHeadingTarget = createContext<HTMLElement | null>(null)

export function PageHeading({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  const target = useContext(PageHeadingTarget)
  const heading = <div className="page-heading" data-slot="page-heading">
    <div className="page-heading-copy"><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
    {actions && <div className="page-actions">{actions}</div>}
  </div>
  return target ? createPortal(heading, target) : heading
}
