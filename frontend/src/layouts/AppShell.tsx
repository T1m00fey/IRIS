import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, matchPath, NavLink, Outlet, useLocation } from 'react-router'
import { BarChart3, Bell, ChevronDown, CircleHelp, Clock3, Headset, House, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Phone, Settings, Ticket, UserRound, Users, UsersRound, X } from 'lucide-react'
import { PageHeading, PageHeadingTarget } from '../components/PageHeading'
import { Button } from '../components/ui/button'
import { api } from '../api/client'
import { home, useLogout, usePreferences, useUser } from '../app/session'
import { useLiveEvents } from '../hooks/use-live-events'
import { useOperatorWorkspace, workspaceKey } from '../workspaces/operator/data'
import { employeeStatuses } from '../features/operations/labels'
import type { Dashboard, EmployeeStatus } from '../types/operations'

const operatorItems = [
  ['Главная', '/operator', House, []], ['Рабочее место', '/workspace', Headset, ['/operator/customers/*', '/operator/tickets/*']], ['Моя аналитика', '/operator/analytics', BarChart3, []],
] as const
const managerItems = [
  ['Главная', '/manager', House, ['/incidents']], ['Контакт-центр', '/manager/contact-center', Phone, ['/live', '/calls/*']], ['Обращения', '/tickets', Ticket, ['/queues']],
  ['Клиенты', '/customers', Users, []], ['Аналитика', '/analytics', BarChart3, []], ['Команда', '/employees', UsersRound, ['/departments']],
] as const

export function AppShell() {
  const user = useUser()
  const isManager = user.role === 'manager'
  const location = useLocation()
  const client = useQueryClient()
  const { query: preferences, update: setPreference } = usePreferences()
  const logout = useLogout()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [popover, setPopover] = useState<'' | 'notifications' | 'help' | 'profile'>('')
  const [headingTarget, setHeadingTarget] = useState<HTMLDivElement | null>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const mobileCloseButton = useRef<HTMLButtonElement>(null)
  const popoverButton = useRef<HTMLButtonElement | null>(null)
  const workspace = useOperatorWorkspace(!isManager)
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: ({ signal }) => api<Dashboard>('/api/v1/dashboard', { signal }),
    enabled: isManager,
  })
  const connection = useLiveEvents(isManager ? 'manager' : 'operator')
  const changeStatus = useMutation({
    mutationFn: (status: EmployeeStatus) => api('/api/v1/operator/status', { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: workspaceKey }),
  })
  const items = isManager ? managerItems : operatorItems
  const collapsed = preferences.data?.sidebar_collapsed === true
  const initials = user.full_name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase()
  const employee = workspace.data?.employee
  const isDesk = !isManager && location.pathname === '/workspace'
  const incidents = dashboard.data?.active_incidents || []
  const pendingIncidents = dashboard.data?.pending_incidents ?? 0
  const connectionText = { live: 'В реальном времени', polling: 'Резервное обновление', connecting: 'Подключение…' }[connection]
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose

  useEffect(() => {
    if (!mobileOpen) return
    const desktop = window.matchMedia('(width > 800px)')
    const onResize = () => { if (desktop.matches) setMobileOpen(false) }
    desktop.addEventListener('change', onResize)
    mobileCloseButton.current?.focus()
    return () => desktop.removeEventListener('change', onResize)
  }, [mobileOpen])

  function dismissOverlays() {
    setMobileOpen(false)
    setPopover('')
  }

  function togglePopover(next: typeof popover, button: HTMLButtonElement) {
    popoverButton.current = button
    setPopover(popover === next ? '' : next)
  }

  function closeMobileMenu() {
    dismissOverlays()
    requestAnimationFrame(() => menuButton.current?.focus())
  }

  return <div
    className={'shell v3-shell' + (collapsed ? ' sidebar-collapsed' : '') + (preferences.data?.density === 'compact' ? ' density-compact' : '')}
    onKeyDown={event => {
      if (event.key !== 'Escape') return
      if (popover) { setPopover(''); popoverButton.current?.focus() }
      else if (mobileOpen) closeMobileMenu()
    }}
    onPointerDown={event => {
      if (popover && !(event.target as Element).closest('[data-shell-popover]')) setPopover('')
    }}
  >
    {!mobileOpen && <a className="skip-link" href="#main">Перейти к содержанию</a>}
    {mobileOpen && <div className="shell-scrim" aria-hidden="true" onClick={closeMobileMenu} />}
    <aside id="sidebar" className={'sidebar' + (mobileOpen ? ' sidebar-open' : '')}>
      <div className="app-brand">
        <NavLink className="wordmark" to={home(user)} aria-label="IRIS — главная" onClick={dismissOverlays}>
          <img src="/iris.svg" alt="" /><span>IRIS<small>{user.company || 'SkyNet'}</small></span>
        </NavLink>
        <Button className="sidebar-toggle icon-button" variant="ghost" aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
          aria-controls="sidebar-navigation" aria-expanded={!collapsed} disabled={setPreference.isPending}
          onClick={() => setPreference.mutate({ sidebar_collapsed: !collapsed })}><CollapseIcon size={18} /></Button>
        <Button ref={mobileCloseButton} className="sidebar-close icon-button" variant="ghost" aria-label="Закрыть меню"
          onClick={closeMobileMenu}><X size={21} /></Button>
      </div>
      <nav id="sidebar-navigation" className="side-nav" aria-label="Разделы IRIS">
        {items.map(([name, route, Icon, related]) => {
          const section = route === home(user) ? route : route + '/*'
          const active = [section, ...related].some(path => matchPath(path, location.pathname))
          return <Link key={route} to={route} className={active ? 'active' : undefined} aria-current={active ? (matchPath(route, location.pathname) ? 'page' : 'location') : undefined}
            title={collapsed ? name : undefined} aria-label={name} onClick={dismissOverlays}><Icon size={22} /><span>{name}</span></Link>
        })}
      </nav>
      <div className="side-footer">
        <NavLink to="/settings" className="side-link" aria-label="Настройки" title={collapsed ? 'Настройки' : undefined} onClick={dismissOverlays}><Settings size={22} /><span>Настройки</span></NavLink>
        <div className="profile-anchor" data-shell-popover>
          <button className="profile" aria-label="Меню профиля" aria-expanded={popover === 'profile'}
            aria-controls={popover === 'profile' ? 'profile-options' : undefined} onClick={event => togglePopover('profile', event.currentTarget)}>
            <span className="avatar" aria-hidden="true">{initials}</span>
            <span className="profile-copy"><strong>{user.full_name}</strong><small>{isManager ? 'Руководитель' : 'Оператор'}</small></span>
            <ChevronDown size={17} className="profile-arrow" />
          </button>
          {popover === 'profile' && <div id="profile-options" className="panel profile-popover">
            <NavLink to="/profile" onClick={dismissOverlays}><UserRound size={17} /> Мой профиль</NavLink>
            {!isManager && <NavLink to="/profile#shift" onClick={dismissOverlays}><Clock3 size={17} /> Моя смена</NavLink>}
            <NavLink to="/settings" onClick={dismissOverlays}><Settings size={17} /> Настройки</NavLink>
            <button onClick={() => logout.mutate()} disabled={logout.isPending}><LogOut size={17} /> Выйти</button>
            {logout.isError && <p className="alert" role="alert">{logout.error.message}</p>}
          </div>}
        </div>
      </div>
    </aside>
    <div className="shell-main" inert={mobileOpen}>
      <header className="topbar">
        <Button ref={menuButton} className="nav-toggle icon-button" variant="ghost" aria-label="Открыть меню" aria-controls="sidebar"
          aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu size={22} /></Button>
        <div className="topbar-heading" ref={setHeadingTarget} />
        <div className="topbar-end">
          {employee && <label className="presence" data-status={employee.status}>
            <i aria-hidden="true" />
            <select aria-label="Рабочий статус" disabled={changeStatus.isPending || employee.status === 'busy' || employee.status === 'wrap_up'}
              value={employee.status} onChange={event => changeStatus.mutate(event.target.value as EmployeeStatus)}>
              {Object.entries(employeeStatuses).filter(([value]) => !['busy', 'wrap_up'].includes(value) || value === employee.status)
                .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <ChevronDown size={15} aria-hidden="true" />
          </label>}
          <span className={'connection connection-' + connection} role="status" title={connectionText}>
            <i aria-hidden="true" /><span>{connectionText}</span>
          </span>
          <div className="notification-anchor" data-shell-popover>
            <Button variant="ghost" className="icon-button" aria-label="Уведомления" aria-expanded={popover === 'notifications'}
              aria-controls={popover === 'notifications' ? 'shell-notifications' : undefined}
              onClick={event => togglePopover('notifications', event.currentTarget)}><Bell size={22} />{(pendingIncidents > 0 || incidents.length > 0) && <i className="notification-dot" />}</Button>
            {popover === 'notifications' && <section id="shell-notifications" className="panel notification-popover" aria-label="Уведомления">
              <strong>Уведомления</strong>
              {pendingIncidents > 0 || incidents.length > 0 ? <ul>
                {pendingIncidents > 0 && <li><Link className="text-link" to="/incidents" onClick={dismissOverlays}>Возможные аварии ({pendingIncidents})</Link></li>}
                {incidents.map(incident => <li key={incident.id}>{incident.title}</li>)}
              </ul> : <p>Новых уведомлений нет</p>}
            </section>}
          </div>
          <div className="notification-anchor" data-shell-popover>
            <Button variant="ghost" className="icon-button" aria-label="Помощь" aria-expanded={popover === 'help'}
              aria-controls={popover === 'help' ? 'shell-help' : undefined}
              onClick={event => togglePopover('help', event.currentTarget)}><CircleHelp size={22} /></Button>
            {popover === 'help' && <section id="shell-help" className="panel notification-popover" aria-label="Помощь"><strong>Помощь</strong>
              <p>{isManager ? 'Рабочие показатели доступны в разделе «Контакт-центр».' : 'Назначенные звонки и история доступны на рабочем месте.'}</p>
            </section>}
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="main-content">
        <PageHeadingTarget.Provider value={headingTarget}>
          {isDesk && <PageHeading title="Рабочее место" subtitle="Обслуживание клиентов и управление звонками" />}
          {changeStatus.isError && <p className="alert" role="alert">{changeStatus.error.message}</p>}
          {setPreference.isError && <p className="alert" role="alert">{setPreference.error.message}</p>}
          <Outlet />
        </PageHeadingTarget.Provider>
      </main>
    </div>
  </div>
}
