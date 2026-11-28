import type { ReactNode } from 'react'
import type { Tone } from '../types/operations'

export function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <span className={'badge badge-' + tone}><i aria-hidden="true" />{children}</span>
}
