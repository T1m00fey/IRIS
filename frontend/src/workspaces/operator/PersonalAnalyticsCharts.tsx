import { useEffect, useMemo, useRef } from 'react'
import {
  ArcElement, BarController, BarElement, CategoryScale, Chart, DoughnutController,
  LinearScale, Tooltip,
} from 'chart.js'
import { formatNumber } from '../../lib/format'
import type { PersonalAnalytics } from './data'
import styles from './PersonalAnalytics.module.css'

Chart.register(ArcElement, BarController, BarElement, CategoryScale, DoughnutController, LinearScale, Tooltip)

type Activity = PersonalAnalytics['daily'][number]
export type Outcome = { label: string; count: number; color: string }

const axisDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const fullDate = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeZone: 'UTC' })

function chartTheme(canvas: HTMLCanvasElement) {
  const theme = getComputedStyle(canvas)
  return {
    token: (name: string) => theme.getPropertyValue(name).trim(),
    font: { family: theme.fontFamily, size: 11 },
  }
}

function activityBuckets(days: Activity[]) {
  const groupSize = days.length > 120 ? 14 : days.length > 31 ? 7 : 1
  const buckets = []
  for (let index = 0; index < days.length; index += groupSize) {
    const group = days.slice(index, index + groupSize)
    const first = new Date(group[0].date)
    const last = new Date(group[group.length - 1].date)
    buckets.push({
      label: axisDate.format(first),
      period: fullDate.formatRange(first, last),
      calls: group.reduce((sum, day) => sum + day.accepted_calls, 0),
      tickets: group.reduce((sum, day) => sum + day.resolved_tickets, 0),
    })
  }
  return { buckets, groupSize }
}

export function ActivityChart({ days }: { days: Activity[] }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const { buckets, groupSize } = useMemo(() => activityBuckets(days), [days])
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const { font, token } = chartTheme(element)
    const muted = token('--muted-foreground')
    const chart = new Chart(element, {
      type: 'bar',
      data: {
        labels: buckets.map(bucket => bucket.label),
        datasets: [
          { label: 'Принятые звонки', data: buckets.map(bucket => bucket.calls), backgroundColor: token('--primary') },
          { label: 'Решённые обращения', data: buckets.map(bucket => bucket.tickets), backgroundColor: token('--success') },
        ],
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        locale: 'ru-RU',
        datasets: { bar: { maxBarThickness: 18, borderRadius: 3 } },
        interaction: { mode: 'index', intersect: false, axis: 'x' },
        plugins: { tooltip: { callbacks: { title: points => buckets[points[0].dataIndex].period } } },
        scales: {
          x: {
            title: { display: true, text: 'Дата', color: muted, font },
            ticks: { color: muted, font, maxRotation: 0, maxTicksLimit: 8 },
            grid: { display: false },
            border: { color: token('--border') },
          },
          y: {
            title: { display: true, text: 'Количество', color: muted, font },
            beginAtZero: true,
            suggestedMax: 2,
            ticks: { color: muted, font, precision: 0, maxTicksLimit: 5 },
            grid: { color: token('--border') },
            border: { display: false },
          },
        },
      },
    })
    return () => chart.destroy()
  }, [buckets])

  return <>
    <div className={styles.legend} aria-hidden="true">
      <span><i className={styles.callsKey} />Принятые звонки</span>
      <span><i className={styles.ticketsKey} />Решённые обращения</span>
    </div>
    <div className={styles.plot}>
      <canvas ref={canvas} role="img" aria-label="Динамика принятых звонков и решённых обращений" />
    </div>
    <details className={styles.chartData}>
      <summary>{groupSize === 1 ? 'Данные по дням' : 'Данные по периодам'}</summary>
      <div className="table-scroll" role="region" aria-label="Данные графика" tabIndex={0}>
        <table className="data-table">
          <thead><tr><th scope="col">Дата</th><th scope="col">Звонки</th><th scope="col">Обращения</th></tr></thead>
          <tbody>{buckets.map(bucket => <tr key={bucket.period}>
            <th scope="row">{bucket.period}</th><td>{formatNumber(bucket.calls)}</td><td>{formatNumber(bucket.tickets)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>
  </>
}

export function OutcomeChart({ outcomes }: { outcomes: Outcome[] }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const total = outcomes.reduce((sum, item) => sum + item.count, 0)

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const { token } = chartTheme(element)
    const chart = new Chart(element, {
      type: 'doughnut',
      data: {
        labels: outcomes.map(item => item.label),
        datasets: [{
          data: outcomes.map(item => item.count),
          backgroundColor: outcomes.map(item => token(item.color)),
          borderColor: token('--surface'),
          borderWidth: 2,
        }],
      },
      options: { animation: false, maintainAspectRatio: false, cutout: '78%', locale: 'ru-RU' },
    })
    return () => chart.destroy()
  }, [outcomes])

  return <div className={styles.outcomeBody}>
    {total >= 2 && <div className={styles.donut} aria-hidden="true">
      <canvas ref={canvas} />
      <div className={styles.donutTotal}><strong>{formatNumber(total)}</strong><span>звонков</span></div>
    </div>}
    <ul className={styles.outcomes + ' work-items'}>
      {outcomes.map(item => <li key={item.label}>
        <span><i style={{ background: 'var(' + item.color + ')' }} aria-hidden="true" />{item.label}</span>
        <strong>{formatNumber(item.count)}</strong>
      </li>)}
    </ul>
  </div>
}
