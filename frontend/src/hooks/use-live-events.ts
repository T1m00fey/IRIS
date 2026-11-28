import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

export type Connection = 'connecting' | 'live' | 'polling'
const managerResources = ['calls', 'tickets', 'dashboard', 'employees', 'customers', 'analytics', 'incident_alerts']

export function useLiveEvents(role: 'operator' | 'manager') {
  const client = useQueryClient()
  const [connection, setConnection] = useState<Connection>('connecting')
  useEffect(() => {
    const resources = role === 'manager' ? managerResources : ['operator']
    const invalidate = (keys: string[]) => {
      for (const resource of keys) void client.invalidateQueries({ queryKey: [resource] })
    }
    let stream: EventSource | undefined
    let live = false
    if (typeof EventSource !== 'undefined') {
      stream = new EventSource(role === 'manager' ? '/api/v1/events' : '/api/v1/operator/events')
      stream.onopen = () => {
        live = true
        setConnection('live')
        invalidate(resources)
      }
      stream.onerror = () => {
        live = false
        setConnection('polling')
      }
      stream.addEventListener('change', (event) => {
        if (role === 'operator') { invalidate(resources); return }
        try {
          const data = JSON.parse(event.data) as { resources?: unknown }
          const keys = data.resources
          const changed = Array.isArray(keys) ? resources.filter(key => keys.includes(key)) : resources
          if (changed.includes('tickets') || changed.includes('calls')) changed.push('customers')
          if (changed.includes('tickets') || changed.includes('employees')) changed.push('analytics')
          invalidate([...new Set(changed)])
        } catch {
          invalidate(resources)
        }
      })
    } else {
      setConnection('polling')
    }
    const timer = window.setInterval(() => { if (!live) invalidate(resources) }, 5000)
    return () => { stream?.close(); window.clearInterval(timer) }
  }, [client, role])
  return connection
}
