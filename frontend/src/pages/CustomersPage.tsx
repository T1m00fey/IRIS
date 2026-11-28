import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { ArrowDown, ArrowDownUp, ArrowUp, ChevronRight, Search, Users, LayoutList, Columns2 } from 'lucide-react'
import { useDeferredValue, type ReactNode } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'
import { api } from '../api/client'
import { PageHeading } from '../components/PageHeading'
import { PageState } from '../components/PageState'
import { Button } from '../components/ui/button'
import { CustomerProfilePage } from './CustomerProfilePage'
import {
  CrmBadge, CrmPagination, CrmState, customerStatuses, formatMoney, initials,
} from '../features/crm/CrmElements'
import type { Customer } from '../features/crm/types'
import { formatDate, formatNumber } from '../lib/format'
import type { Collection } from '../types/operations'
import '../features/crm/crm.css'

const pageSize = 10

const columns: ColumnDef<Customer>[] = [
  {
    id: 'name', header: 'Клиент', accessorKey: 'full_name',
    cell: ({ row: { original } }) => (
      <div className="crm-customer-cell">
        <span className="crm-avatar" aria-hidden="true">{initials(original.full_name)}</span>
        <div>
          <CustomerLink customer={original} className="crm-link">{original.full_name}</CustomerLink>
          <span className="crm-secondary muted">{original.phone}</span>
        </div>
      </div>
    ),
  },
  {
    id: 'status', header: 'Статус', accessorKey: 'status',
    cell: ({ row: { original } }) => (
      <CrmBadge status={original.status}>{customerStatuses[original.status]}</CrmBadge>
    ),
  },
  {
    id: 'account_count', header: 'Счета', accessorKey: 'account_count',
    cell: ({ row: { original } }) => (
      <>
        <span className="crm-number">{original.primary_account?.number ?? '—'}</span>
        {original.primary_account && <span className="crm-secondary muted">Всего {original.account_count}</span>}
      </>
    ),
  },
  {
    id: 'address', header: 'Адрес подключения', accessorFn: (customer) => customer.primary_account?.address,
    cell: ({ row: { original } }) => original.primary_account?.address ?? '—',
  },
  {
    id: 'tariff', header: 'Тариф', accessorFn: (customer) => customer.primary_account?.tariff_name,
    cell: ({ row: { original } }) => original.primary_account?.tariff_name ?? '—',
  },
  {
    id: 'balance', header: 'Баланс', accessorFn: (customer) => customer.primary_account?.balance_kopecks,
    cell: ({ row: { original } }) => original.primary_account ? (
      <span className="crm-number" title={formatMoney(original.primary_account.balance_kopecks)}
        data-negative={original.primary_account.balance_kopecks < 0}>
        {formatMoney(original.primary_account.balance_kopecks)}
      </span>
    ) : '—',
  },
  {
    id: 'last_contact_at', header: 'Последнее обращение', accessorKey: 'last_contact_at',
    cell: ({ row: { original } }) => formatDate(original.last_contact_at),
  },
  {
    id: 'details', header: () => <span className="sr-only">Карточка</span>, enableSorting: false,
    cell: ({ row: { original } }) => (
      <CustomerLink customer={original} className="button button-ghost crm-row-action" label={'Открыть карточку ' + original.full_name}>
        <ChevronRight size={16} />
      </CustomerLink>
    ),
  },
]

const sortableColumns = new Set(columns.filter((column) => column.enableSorting !== false).map((column) => column.id))
const emptyCustomers: Customer[] = []

function CustomerLink({ customer, className, children, label, current }: {
  customer: Customer
  className?: string
  children: ReactNode
  label?: string
  current?: boolean
}) {
  const { search } = useLocation()
  const { customerId } = useParams()
  const filters = new URLSearchParams(search)
  for (const key of ['tab', 'account', 'history_offset']) filters.delete(key)
  return <Link className={className} to={{ pathname: '/customers/' + encodeURIComponent(customer.id), search: filters.toString() }}
    aria-current={(current ?? customerId === customer.id) ? 'page' : undefined} aria-label={label} preventScrollReset>{children}</Link>
}

export function CustomersPage() {
  const { customerId } = useParams()
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  const q = useDeferredValue(search.trim())
  const statusParam = params.get('status') ?? ''
  const status = Object.hasOwn(customerStatuses, statusParam) ? statusParam : ''
  const sortParam = params.get('sort') ?? ''
  const sort = sortableColumns.has(sortParam) ? sortParam : 'name'
  const sorting: SortingState = [{ id: sort, desc: params.get('order') === 'desc' }]
  const offsetParam = Number(params.get('offset'))
  const offset = Number.isSafeInteger(offsetParam) && offsetParam >= 0
    ? Math.floor(offsetParam / pageSize) * pageSize : 0
  const mode = params.get('view') === 'table' && !customerId ? 'table' : 'split'
  const query = new URLSearchParams({
    limit: String(pageSize), offset: String(offset), sort,
    order: sorting[0].desc ? 'desc' : 'asc',
  })
  if (q) query.set('q', q)
  if (status) query.set('status', status)
  const queryString = query.toString()

  const customers = useQuery({
    queryKey: ['customers', 'list', queryString],
    queryFn: ({ signal }) => api<Collection<Customer>>('/api/v1/customers?' + queryString, { signal }),
    placeholderData: keepPreviousData,
  })

  function update(changes: Record<string, string>, replace = false) {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value)
        else next.delete(key)
      }
      return next
    }, { replace, preventScrollReset: true })
  }

  const table = useReactTable({
    data: customers.data?.items ?? emptyCustomers,
    columns,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    enableSortingRemoval: false,
    enableMultiSort: false,
    state: { sorting },
    onSortingChange: (updater) => {
      const [next] = typeof updater === 'function' ? updater(sorting) : updater
      update({ sort: next?.id ?? '', order: next?.desc ? 'desc' : '', offset: '' })
    },
  })

  const filtersActive = Boolean(search || status)
  const selectedId = customerId ?? customers.data?.items[0]?.id
  const cardsView = new URLSearchParams(params)
  cardsView.delete('view')
  const tableView = new URLSearchParams(params)
  for (const key of ['tab', 'account', 'history_offset']) tableView.delete(key)
  tableView.set('view', 'table')

  return (
    <div className="crm-page">
      <PageHeading title="Клиенты" subtitle="Абоненты, лицевые счета и история обслуживания" actions={
        <div className="crm-view-switch" aria-label="Вид клиентской базы">
          <Button variant={mode === 'split' ? 'primary' : 'default'} asChild><Link aria-current={mode === 'split' ? 'page' : undefined} to={{ pathname: customerId ? '/customers/' + encodeURIComponent(customerId) : '/customers', search: cardsView.toString() }} preventScrollReset><Columns2 size={15} /> Карточки</Link></Button>
          <Button variant={mode === 'table' ? 'primary' : 'default'} asChild>
            <Link aria-current={mode === 'table' ? 'page' : undefined} to={{ pathname: '/customers', search: tableView.toString() }} preventScrollReset><LayoutList size={15} /> Таблица</Link>
          </Button>
        </div>} />

      <div className={'crm-workbench' + (mode === 'split' ? ' crm-workbench-split' : '')} data-has-selection={Boolean(customerId)}>

      <section className="panel crm-list" aria-label="Клиентская база" aria-busy={customers.isFetching}>
        <div className="crm-catalog-heading">
          <h2>Каталог клиентов</h2>
          {customers.data && !customers.isError && <span className="crm-catalog-count" aria-label={'Клиентов: ' + formatNumber(customers.data.total)}>{formatNumber(customers.data.total)}</span>}
        </div>
        <div className="crm-toolbar">
          <label className="crm-search">
            <Search size={16} aria-hidden="true" />
            <input type="search" className="field" aria-label="Поиск клиентов" value={search}
              maxLength={200}
              onChange={(event) => update({ q: event.target.value, offset: '' }, true)}
              placeholder="ФИО, телефон, лицевой счёт" />
          </label>
          <select className="field crm-filter" aria-label="Статус клиента" value={status}
            onChange={(event) => update({ status: event.target.value, offset: '' })}>
            <option value="">Все статусы</option>
            {Object.entries(customerStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          {mode === 'split' && <select className="field crm-catalog-sort" aria-label="Сортировка клиентов" value={sort + ':' + (sorting[0].desc ? 'desc' : 'asc')}
            onChange={(event) => { const [sortBy, order] = event.target.value.split(':'); update({ sort: sortBy, order, offset: '' }) }}>
            {columns.filter(({ enableSorting }) => enableSorting !== false).flatMap(({ id, header }) => [
              <option key={id + ':asc'} value={id + ':asc'}>{header as string} ↑</option>,
              <option key={id + ':desc'} value={id + ':desc'}>{header as string} ↓</option>,
            ])}
          </select>}
          {filtersActive && (
            <button className="button button-ghost" onClick={() => update({ q: '', status: '', offset: '' })}>
              Сбросить
            </button>
          )}
        </div>

        {customers.isPending && <CrmState title="Загрузка клиентов…" />}
        {customers.isError && (
          <CrmState title="Не удалось загрузить клиентов" description="Проверьте соединение и повторите запрос." error>
            <button className="button" onClick={() => void customers.refetch()}>Повторить</button>
          </CrmState>
        )}
        {!customers.isError && customers.data && (
          customers.data.items.length ? (
            <>
              {mode === 'split' && <ul className="crm-contact-list">
                  {customers.data.items.map((customer) => (
                    <li key={customer.id} className={customer.id === selectedId ? 'crm-contact-selected' : undefined}>
                      <CustomerLink customer={customer} className="crm-contact" current={customer.id === selectedId}>
                        <span className="crm-avatar" aria-hidden="true">{initials(customer.full_name)}</span>
                        <span className="crm-contact-info"><strong>{customer.full_name}</strong><small>{customer.phone || 'Телефон не указан'}</small>
                          <small>{customer.primary_account ? 'Счёт ' + customer.primary_account.number : 'Без лицевого счёта'}{customer.account_count > 1 && ' · +' + (customer.account_count - 1)}</small></span>
                        <CrmBadge status={customer.status}>{customerStatuses[customer.status]}</CrmBadge>
                      </CustomerLink>
                    </li>
                  ))}
              </ul>}
              {mode === 'table' && <div className="table-scroll" tabIndex={0} role="region" aria-label="Таблица клиентской базы">
                <table className="data-table crm-customer-table" aria-label="Клиенты">
                  <thead>
                    {table.getHeaderGroups().map((group) => (
                      <tr key={group.id}>
                        {group.headers.map((header) => {
                          const sorted = header.column.getIsSorted()
                          const SortIcon = sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ArrowDownUp
                          return (
                            <th key={header.id} scope="col" data-column={header.column.id}
                              aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}>
                              {header.column.getCanSort() ? (
                                <button className="crm-sort" onClick={header.column.getToggleSortingHandler()}>
                                  {flexRender(header.column.columnDef.header, header.getContext())}
                                  <SortIcon size={13} aria-hidden="true" />
                                </button>
                              ) : flexRender(header.column.columnDef.header, header.getContext())}
                            </th>
                          )
                        })}
                      </tr>
                    ))}
                  </thead>
                  <tbody>
                    {table.getRowModel().rows.map((row) => (
                      <tr key={row.id}>
                        {row.getVisibleCells().map((cell) => (
                          <td key={cell.id} data-column={cell.column.id}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
              <CrmPagination {...customers.data} busy={customers.isPlaceholderData}
                onChange={(next) => update({ offset: next ? String(next) : '' })} />
            </>
          ) : (
            <CrmState title={offset > 0 ? 'На этой странице нет клиентов' : filtersActive ? 'Клиенты не найдены' : 'Клиентская база пока пуста'}
              description={filtersActive ? 'Уточните запрос или сбросьте фильтр.' : undefined}>
              <Users size={20} className="crm-empty-icon" aria-hidden="true" />
              {offset > 0 && <button className="button" onClick={() => update({ offset: '' })}>К первой странице</button>}
            </CrmState>
          )
        )}
      </section>
      {mode === 'split' && <section className="crm-selection" aria-label="Карточка выбранного клиента">
        {selectedId ? <CustomerProfilePage key={selectedId} customerId={selectedId} /> : !customers.isPending && <PageState empty="Выберите клиента" />}
      </section>}
      </div>
    </div>
  )
}
