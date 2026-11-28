export type CustomerStatus = 'active' | 'suspended' | 'inactive'
export type ServiceStatus = 'active' | 'suspended' | 'disconnected'

export interface AccountOverview {
  number: string
  address: string
  tariff_name: string
  balance_kopecks: number
  service_status: ServiceStatus
}

export interface Customer {
  id: string
  full_name: string
  phone: string
  status: CustomerStatus
  account_count: number
  primary_account: AccountOverview | null
  last_contact_at: string | null
}

export interface Incident {
  id: string
  title: string
  description: string
  status: 'open' | 'investigating' | 'resolved'
  started_at: string
  estimated_resolution_at: string | null
}

export interface Payment {
  id: string
  amount_kopecks: number
  status: 'credited' | 'pending' | 'failed'
  paid_at: string
  credited_at: string | null
}

export interface Account extends AccountOverview {
  speed_mbps: number
  monthly_fee_kopecks: number
  equipment: string | null
  active_incidents: Incident[]
  payments: Payment[]
}

export interface CustomerDetail extends Customer {
  accounts: Account[]
}
