import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Headset } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router'
import type { Collection, Call, CallDetail } from '../types/operations'
import { api } from '../api/client'
import { PageHeading } from '../components/PageHeading'
import { PageState } from '../components/PageState'
import { Button } from '../components/ui/button'
import { Pagination } from '../components/Pagination'
import { CallsTable } from '../features/operations/CallsTable'
import { CallActivity, CallChecks, CallRecord, CallSummary, Transcript, VoiceControls } from '../features/operations/CallContext'
import { callStatuses, departments, outcomes } from '../features/operations/labels'

const limit = 12

export function useCall(id: string | undefined) {
  return useQuery({ queryKey: ['calls', id], queryFn: ({ signal }) => api<CallDetail>('/api/v1/calls/' + encodeURIComponent(id!), { signal }), enabled: Boolean(id) })
}

export function CallsPage({ live = false }: { live?: boolean }) {
  const [filters, setFilters] = useSearchParams()
  const status = filters.get('status') || ''
  const department = filters.get('department') || ''
  const outcome = filters.get('outcome') || ''
  const offset = Math.max(0, Number(filters.get('offset')) || 0)
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (status) params.set('status', status)
  if (department) params.set('department', department)
  if (outcome) params.set('outcome', outcome)
  if (live) params.set('live', 'true')
  const query = useQuery({
    queryKey: ['calls', 'list', params.toString()],
    queryFn: ({ signal }) => api<Collection<Call>>('/api/v1/calls?' + params, { signal }),
  })
  function change(key: string, value: string) {
    const next = new URLSearchParams(filters)
    next.delete('offset')
    if (value) next.set(key, value)
    else next.delete(key)
    setFilters(next)
  }
  const statuses = Object.entries(callStatuses).filter(([key]) => !live || key === 'active' || key === 'ringing')
  return <>
    <PageHeading title={live ? 'Активные звонки' : 'История звонков'} subtitle={live ? 'Входящие и текущие звонки' : 'Результаты звонков, сводки и реплики'} />
    <div className="panel filter-panel filters">
      <label className="filter-label">Статус<select className="field" value={status} onChange={event => change('status', event.target.value)}><option value="">Все статусы</option>{statuses.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label className="filter-label">Отдел<select className="field" value={department} onChange={event => change('department', event.target.value)}><option value="">Все отделы</option>{Object.entries(departments).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {!live && <label className="filter-label">Результат<select className="field" value={outcome} onChange={event => change('outcome', event.target.value)}><option value="">Все результаты</option>{Object.entries(outcomes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
      {(status || department || outcome) && <Button variant="ghost" onClick={() => setFilters({})}>Сбросить</Button>}
    </div>
    {query.isPending || query.isError || !query.data.items.length ? <PageState loading={query.isPending} error={query.error} retry={() => void query.refetch()} empty={status || department || outcome ? 'По этим фильтрам звонков нет' : live ? 'Текущих звонков нет' : 'Звонков пока нет'} /> : <section className="panel">
      <CallsTable calls={query.data.items} />
      <Pagination total={query.data.total} offset={offset} limit={limit} setOffset={value => { const next = new URLSearchParams(filters); next.set('offset', String(value)); setFilters(next) }} />
    </section>}
  </>
}

export function CallPage() {
  const { callId } = useParams()
  const query = useCall(callId)
  return <>
    <PageHeading title="Карточка звонка" subtitle={callId} actions={<><Button asChild><Link to="/calls"><ArrowLeft size={14} /> История звонков</Link></Button>{callId && <Button asChild><Link to={'/workspace?call=' + encodeURIComponent(callId)}><Headset size={14} /> Рабочее место</Link></Button>}</>} />
    {!query.data ? <PageState loading={query.isPending} error={query.error} retry={() => void query.refetch()} empty="Звонок не найден" /> : <div className="detail-grid">
      <div className="detail-stack"><CallSummary key={query.data.id} call={query.data} /><Transcript call={query.data} /><CallActivity call={query.data} /></div>
      <div className="detail-stack"><CallRecord call={query.data} /><CallChecks call={query.data} /><VoiceControls call={query.data} /></div>
    </div>}
  </>
}
