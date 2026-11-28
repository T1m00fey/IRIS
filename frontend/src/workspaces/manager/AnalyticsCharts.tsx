import { useEffect, useId, useRef, useState } from 'react'
import { outcomes } from '../../features/operations/labels'
import { formatNumber } from '../../lib/format'
import { formatReportDay, type CompanyReport, type DailyActivity } from './analytics-data'

const series = [
  { key: 'total_calls', label: 'Входящие', color: 'var(--primary)' },
  { key: 'accepted_calls', label: 'Принятые', color: 'var(--analytics-secondary)' },
] as const

const percent = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 1 })

export function CallTrend({ days }: { days: DailyActivity[] }) {
  const frame = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(540)
  const [active, setActive] = useState<number | null>(null)
  const fillId = useId()
  useEffect(() => {
    const element = frame.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(180, entry.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const peak = Math.max(...days.map(day => Math.max(day.total_calls, day.accepted_calls)), 1)
  const targetStep = Math.max(peak / 5, 1)
  const magnitude = 10 ** Math.floor(Math.log10(targetStep))
  const step = [1, 2, 2.5, 5, 10].map(unit => unit * magnitude).find(unit => unit >= targetStep && Number.isInteger(unit)) ?? 10 * magnitude
  const intervals = Math.max(4, Math.ceil(peak / step))
  const top = 12
  const bottom = 197
  const height = 225
  const left = Math.max(35, formatNumber(step * intervals).length * 8 + 9)
  const right = width - 14
  const plotWidth = right - left
  const x = (index: number) => days.length === 1 ? left + plotWidth / 2 : left + index * plotWidth / (days.length - 1)
  const y = (value: number) => bottom - value * (bottom - top) / (step * intervals)
  const labelCount = Math.min(days.length, Math.max(2, Math.floor(plotWidth / 76)))
  const ticks = Array.from({ length: labelCount }, (_, index) => labelCount === 1 ? 0 : Math.round(index * (days.length - 1) / (labelCount - 1)))
  const selected = active === null ? null : days[active]
  const selectedX = selected && active !== null ? x(active) : 0
  const drawDots = days.length <= 14
  const points = (key: typeof series[number]['key']) => days.map((day, index) => x(index) + ',' + y(day[key])).join(' ')

  return <div className="analytics-chart-frame" ref={frame}>
    <svg className="analytics-trend" width="100%" height={height} viewBox={'0 0 ' + width + ' ' + height}
      role="slider" tabIndex={0} aria-label="Динамика звонков по дням"
      aria-valuemin={1} aria-valuemax={days.length} aria-valuenow={(active ?? 0) + 1}
      aria-valuetext={[formatReportDay((selected || days[0]).date, true), ...series.map(item => item.label + ' ' + formatNumber((selected || days[0])[item.key]))].join(', ')}
      onFocus={() => setActive(index => index ?? 0)} onBlur={() => setActive(null)}
      onPointerLeave={event => { if (document.activeElement !== event.currentTarget) setActive(null) }}
      onPointerMove={event => {
        const pointerX = event.clientX - event.currentTarget.getBoundingClientRect().left
        if (pointerX < left - 6 || pointerX > right + 6) return
        setActive(Math.max(0, Math.min(days.length - 1, Math.round((pointerX - left) / plotWidth * (days.length - 1)))))
      }}
      onKeyDown={event => {
        const index = active ?? 0
        const positions: Record<string, number> = { ArrowLeft: index - 1, ArrowDown: index - 1, ArrowRight: index + 1, ArrowUp: index + 1, Home: 0, End: days.length - 1 }
        if (positions[event.key] === undefined) return
        event.preventDefault()
        setActive(Math.max(0, Math.min(days.length - 1, positions[event.key])))
      }}>
      <defs><linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--analytics-secondary)" stopOpacity=".23" />
        <stop offset="100%" stopColor="var(--analytics-secondary)" stopOpacity=".025" />
      </linearGradient></defs>
      {Array.from({ length: intervals + 1 }, (_, tick) => <g key={tick} className="analytics-axis">
        <line x1={left} x2={right} y1={y(tick * step)} y2={y(tick * step)} />
        <text x={left - 9} y={y(tick * step)} dy=".33em" textAnchor="end">{formatNumber(tick * step)}</text>
      </g>)}
      {ticks.map((index, tick) => <text className="analytics-axis-label" key={index} x={x(index)} y={height - 8}
        textAnchor={ticks.length === 1 ? 'middle' : tick === 0 ? 'start' : tick === ticks.length - 1 ? 'end' : 'middle'}>
        {formatReportDay(days[index].date)}
      </text>)}
      {days.length > 1 && <polygon points={left + ',' + bottom + ' ' + points('total_calls') + ' ' + right + ',' + bottom} fill={'url(#' + fillId + ')'} />}
      {selected && <line className="analytics-guide" x1={selectedX} x2={selectedX} y1={top} y2={bottom} />}
      {series.map(item => <g key={item.key} style={{ color: item.color }}>
        <polyline points={points(item.key)} fill="none" stroke="currentColor" strokeWidth={item.key === 'total_calls' ? 3 : 2.3}
          strokeLinejoin="round" strokeDasharray={item.key === 'accepted_calls' ? '6 4' : undefined} />
        {drawDots && days.map((day, index) => <circle key={day.date} cx={x(index)} cy={y(day[item.key])} r={item.key === 'total_calls' ? 3.7 : 2.6} fill="currentColor" />)}
        {selected && <circle cx={selectedX} cy={y(selected[item.key])} r={5} fill="currentColor" stroke="var(--surface)" strokeWidth={1.8} />}
      </g>)}
    </svg>
    {selected && <div className="analytics-tooltip" style={{ left: Math.max(0, Math.min(width - 167, selectedX + 12)) }}>
      <strong>{formatReportDay(selected.date)}</strong>
      {series.map(item => <span key={item.key}><i style={{ background: item.color }} />{item.label}<b>{formatNumber(selected[item.key])}</b></span>)}
    </div>}
  </div>
}

export function CallLegend() {
  return <ul className="analytics-legend" aria-label="Серии графика">
    {series.map(item => <li key={item.key}><i style={{ background: item.color }} />{item.label}</li>)}
  </ul>
}

const outcomeColors = {
  answered: 'var(--primary)',
  ticket_created: 'var(--analytics-secondary)',
  unresolved: 'var(--analytics-green-light)',
  no_confirmation: 'var(--analytics-gray)',
  unknown: 'var(--border)',
}

export function OutcomeChart({ values }: { values: CompanyReport['outcomes'] }) {
  const rows = values.filter(row => row.count > 0).sort((a, b) => b.count - a.count)
  const total = rows.reduce((sum, row) => sum + row.count, 0)
  let offset = 0
  return <div className="analytics-outcomes">
    <div className="analytics-donut">
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r="79" fill="none" stroke="var(--muted)" strokeWidth="38" />
        {rows.map(row => {
          const portion = row.count * 100 / total
          const start = offset
          offset += portion
          const gap = rows.length > 1 ? Math.min(.7, portion / 4) : 0
          return <circle key={row.outcome} cx="100" cy="100" r="79" pathLength="100" fill="none"
            stroke={outcomeColors[row.outcome]} strokeWidth="38" transform="rotate(-90 100 100)"
            strokeDasharray={(portion - gap) + ' ' + (100 - portion + gap)} strokeDashoffset={-start} />
        })}
      </svg>
      <div className="analytics-donut-total"><strong>{formatNumber(total)}</strong><span>звонков</span></div>
    </div>
    <ul className="analytics-outcome-list">
      {rows.map(row => <li key={row.outcome}>
        <i style={{ background: outcomeColors[row.outcome] }} />
        <span>{row.outcome === 'unknown' ? 'Результат не указан' : outcomes[row.outcome]}</span><strong>{formatNumber(row.count)}</strong><small>{percent.format(row.count / total)}</small>
      </li>)}
    </ul>
  </div>
}

export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2 || !values.some(Boolean)) return null
  const scale = Math.max(4, ...values) * 1.1
  const points = values.map((value, index) => [1 + 73 * index / (values.length - 1), 25 - value * 23 / scale].join(',')).join(' ')
  return <svg className="analytics-sparkline" viewBox="0 0 75 26" aria-hidden="true">
    <polygon points={'1,26 ' + points + ' 74,26'} fill="var(--primary-light)" />
    <polyline points={points} fill="none" stroke="var(--analytics-secondary)" strokeWidth="1.7" strokeLinejoin="round" />
  </svg>
}
