import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import type { Call, Collection, Ticket } from '../../types/operations'

type CustomerHistory = { calls: Call; tickets: Ticket }

export function useCustomerHistory<Kind extends keyof CustomerHistory>(
  kind: Kind,
  customerId: string,
  accountNumber: string | undefined,
  offset: number,
  limit: number,
) {
  const query = new URLSearchParams({ customer_id: customerId, limit: String(limit), offset: String(offset) })
  if (accountNumber) query.set('account_number', accountNumber)

  return useQuery({
    queryKey: [kind, 'customer', customerId, accountNumber, offset, limit],
    queryFn: ({ signal }) => api<Collection<CustomerHistory[Kind]>>('/api/v1/' + kind + '?' + query, { signal }),
  })
}
