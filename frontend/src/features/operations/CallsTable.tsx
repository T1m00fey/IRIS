import { Link } from 'react-router'
import { StatusBadge } from '../../components/StatusBadge'
import { formatDate, formatDuration } from '../../lib/format'
import type { Call } from '../../types/operations'
import { callDepartments, callStatuses, callTones, outcomes, phases } from './labels'

export function CallsTable({ calls, compact = false }: { calls: Call[]; compact?: boolean }) {
  return <div className="table-scroll" tabIndex={0} role="region" aria-label="Таблица звонков">
    <table className="data-table">
      <thead><tr>
        <th scope="col">Клиент</th><th scope="col">Начало</th>{!compact && <th scope="col">Длительность</th>}
        <th scope="col">Отдел</th><th scope="col">Статус</th>{!compact && <><th scope="col">Фаза</th><th scope="col">Результат</th><th scope="col">Сводка</th></>}
      </tr></thead>
      <tbody>{calls.map(call => <tr key={call.id}>
        <td><Link className="table-primary" to={'/calls/' + call.id}>{call.customer_name || 'Неизвестный клиент'}</Link><span className="table-secondary numeric">{call.caller_phone_masked || call.id}</span></td>
        <td className="numeric">{formatDate(call.started_at)}</td>{!compact && <td className="numeric">{formatDuration(call.duration_seconds)}</td>}
        <td>{call.department ? callDepartments[call.department] ?? call.department : '—'}</td>
        <td><StatusBadge tone={callTones[call.status]}>{callStatuses[call.status]}</StatusBadge></td>
        {!compact && <><td>{call.phase ? phases[call.phase] : '—'}</td><td>{outcomes[call.outcome]}</td><td className="table-summary"><span className="line-clamp" title={call.summary || undefined}>{call.summary || '—'}</span></td></>}
      </tr>)}</tbody>
    </table>
  </div>
}
