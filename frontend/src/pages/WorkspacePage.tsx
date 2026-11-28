import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, Pause } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { api } from '../api/client'
import { PageHeading } from '../components/PageHeading'
import { PageState } from '../components/PageState'
import { StatusBadge } from '../components/StatusBadge'
import { Button } from '../components/ui/button'
import { CallChecks, CallRecord, CallSummary, Transcript, VoiceControls } from '../features/operations/CallContext'
import { callStatuses, departments, employeeStatuses, employeeTones } from '../features/operations/labels'
import { formatDate } from '../lib/format'
import type { Call, Collection, Employee, EmployeeStatus } from '../types/operations'
import { useCall } from './CallsPage'

function useEmployees() {
  return useQuery({ queryKey: ['employees'], queryFn: ({ signal }) => api<Employee[]>('/api/v1/employees', { signal }) })
}

function EmployeeActions({ employee }: { employee: Employee }) {
  const client = useQueryClient()
  const change = useMutation({
    mutationFn: (status: EmployeeStatus) => api<Employee>('/api/v1/employees/' + encodeURIComponent(employee.id), { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: updated => {
      client.setQueryData<Employee[]>(['employees'], current => current?.map(person => person.id === updated.id ? updated : person))
      void client.invalidateQueries({ queryKey: ['employees'] })
    },
  })
  return <div>
    <div className="actions">
      <select className="field" aria-label="Статус оператора" value={employee.status} disabled={change.isPending} onChange={event => change.mutate(event.target.value as EmployeeStatus)}>
        {Object.entries(employeeStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <Button disabled={change.isPending} onClick={() => change.mutate(employee.status === 'paused' ? 'available' : 'paused')}><Pause size={14} />{employee.status === 'paused' ? 'Снять паузу' : 'Пауза'}</Button>
    </div>
    {change.isSuccess && <span className="sr-only" role="status">Статус обновлён</span>}
    {change.isError && <p className="alert" role="alert">{change.error.message}</p>}
  </div>
}

export function EmployeesPage() {
  const employees = useEmployees()
  const current = employees.data?.find(person => person.is_current)
  return <>
    <PageHeading title="Сотрудники" subtitle="Состав контактного центра и статусы операторов" actions={current && <EmployeeActions employee={current} />} />
    {employees.isPending || employees.isError || !employees.data.length ? <PageState loading={employees.isPending} error={employees.error} retry={() => void employees.refetch()} empty="Сотрудников пока нет" /> : <section className="panel">
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Таблица сотрудников"><table className="data-table"><thead><tr><th scope="col">Сотрудник</th><th scope="col">Отдел</th><th scope="col">Статус</th><th scope="col">Обновлён</th></tr></thead>
        <tbody>{employees.data.map(person => <tr key={person.id}><td><strong>{person.full_name}</strong>{person.is_current && <span className="table-secondary">Ваш профиль</span>}</td><td>{departments[person.department]}</td><td><StatusBadge tone={employeeTones[person.status]}>{employeeStatuses[person.status]}</StatusBadge></td><td>{formatDate(person.updated_at)}</td></tr>)}</tbody>
      </table></div>
    </section>}
  </>
}

export function WorkspacePage() {
  const [selection, setSelection] = useSearchParams()
  const selected = selection.get('call')
  const setSelected = (id: string) => setSelection({ call: id }, { replace: true })
  const employees = useEmployees()
  const current = employees.data?.find(person => person.is_current)
  const live = useQuery({ queryKey: ['calls', 'workspace-live'], queryFn: ({ signal }) => api<Collection<Call>>('/api/v1/calls?live=true&limit=10', { signal }) })
  const recent = useQuery({ queryKey: ['calls', 'workspace-recent'], queryFn: ({ signal }) => api<Collection<Call>>('/api/v1/calls?limit=6', { signal }) })
  const selectedId = selected || live.data?.items[0]?.id || recent.data?.items[0]?.id
  const call = useCall(selectedId)
  const awaitingLists = live.isPending || recent.isPending
  const listError = live.error || recent.error

  useEffect(() => { document.title = 'Рабочее место · IRIS'; return () => { document.title = 'IRIS · SkyNet' } }, [])

  return <>
    <PageHeading title="Рабочее место" subtitle="Звонок, контекст клиента и согласованная сводка" actions={current && <EmployeeActions employee={current} />} />
    <div className="workspace-grid">
      <div className="detail-stack">
        <section className="panel content-panel"><h2>Активные звонки</h2>
          {live.isPending ? <p role="status" className="inline-empty">Загрузка…</p> : live.isError ? <><p className="alert" role="alert">{live.error.message}</p><Button onClick={() => void live.refetch()}>Повторить</Button></> : live.data.items.length > 0 ? <CallPicker calls={live.data.items} selected={selectedId} select={setSelected} /> : <p className="inline-empty">Текущих звонков нет</p>}
          <Link className="text-link mt-3 inline-flex items-center gap-1" to="/live">Все активные <ArrowUpRight size={14} /></Link>
        </section>
        <section className="panel content-panel"><h2>Недавние звонки</h2>
          {recent.isPending ? <p role="status" className="inline-empty">Загрузка…</p> : recent.isError ? <><p className="alert" role="alert">{recent.error.message}</p><Button onClick={() => void recent.refetch()}>Повторить</Button></> : recent.data.items.length > 0 ? <CallPicker calls={recent.data.items} selected={selectedId} select={setSelected} /> : <p className="inline-empty">Звонков пока нет</p>}
          <Link className="text-link mt-3 inline-flex items-center gap-1" to="/queues">Очередь обращений <ArrowUpRight size={14} /></Link>
        </section>
      </div>
      <div className="detail-stack">
        <VoiceControls call={call.data} />
        {call.data ? <><CallSummary key={call.data.id} call={call.data} /><Transcript key={'transcript-' + call.data.id} call={call.data} /></> : <PageState loading={selectedId ? call.isPending : awaitingLists} error={call.error || listError} retry={() => { if (selectedId) void call.refetch(); else { void live.refetch(); void recent.refetch() } }} empty="Выберите звонок" />}
      </div>
      <aside className="detail-stack" aria-label="Контекст клиента">{call.data ? <><CallRecord call={call.data} /><CallChecks call={call.data} /></> : <section className="panel content-panel"><h2>Контекст клиента</h2><p className="inline-empty">Появится после выбора звонка</p></section>}</aside>
    </div>
  </>
}

function CallPicker({ calls, selected, select }: { calls: Call[]; selected?: string; select: (id: string) => void }) {
  return <div className="call-picker">{calls.map(call => <button type="button" key={call.id} aria-pressed={selected === call.id} onClick={() => select(call.id)}>
    <strong>{call.customer_name || call.caller_phone_masked || call.id}</strong><small>{callStatuses[call.status]} · {formatDate(call.started_at)}</small>
  </button>)}</div>
}
