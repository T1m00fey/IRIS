import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router'
import '@fontsource-variable/inter'
import '../styles/index.css'
import '../styles/v3.css'
import { AppShell } from '../layouts/AppShell'
import { IncidentsPage } from '../pages/IncidentsPage'
import { CallsPage, CallPage } from '../pages/CallsPage'
import { TicketsPage, TicketPage } from '../pages/TicketsPage'
import { LoginPage } from '../pages/LoginPage'
import { OperatorDesk } from '../workspaces/operator/OperatorDesk'
import { OperatorTicket } from '../workspaces/operator/OperatorTicket'
import { OperatorAnalytics, OperatorCustomer, OperatorHome } from '../workspaces/operator/OperatorPages'
import { ManagerHome, ContactCenter, TeamPage } from '../workspaces/manager/ManagerPages'
import { ProfilePage, SettingsPage } from '../pages/PreferencesPage'
import { HomeRedirect, SessionGate } from './session'
import { PageState } from '../components/PageState'

const CompanyAnalytics = lazy(() => import('../workspaces/manager/CompanyAnalytics').then(module => ({ default: module.CompanyAnalytics })))
const CustomersPage = lazy(() => import('../pages/CustomersPage').then(module => ({ default: module.CustomersPage })))
const KnowledgeBase = lazy(() => import('../workspaces/manager/knowledge/KnowledgeBase').then(module => ({ default: module.KnowledgeBase })))
const KnowledgeArticle = lazy(() => import('../workspaces/manager/knowledge/KnowledgeBase').then(module => ({ default: module.KnowledgeArticle })))

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 12000, retry: 1 } } })

createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={queryClient}>
  <BrowserRouter><Routes>
    <Route path="login" element={<LoginPage />} />
    <Route element={<SessionGate />}>
      <Route index element={<HomeRedirect />} />
      <Route element={<AppShell />}>
        <Route path="settings" element={<SettingsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route element={<SessionGate role="operator" />}>
          <Route path="operator" element={<OperatorHome />} />
          <Route path="workspace" element={<OperatorDesk />} />
          <Route path="operator/analytics" element={<OperatorAnalytics />} />
          <Route path="operator/customers/:customerId" element={<OperatorCustomer />} />
          <Route path="operator/tickets/:ticketId" element={<OperatorTicket />} />
        </Route>
        <Route element={<SessionGate role="manager" />}>
          <Route path="manager" element={<ManagerHome />} />
          <Route path="manager/contact-center" element={<ContactCenter />} />
          <Route path="manager/knowledge" element={<Suspense fallback={<PageState loading />}><KnowledgeBase /></Suspense>} />
          <Route path="manager/knowledge/new" element={<Suspense fallback={<PageState loading />}><KnowledgeArticle /></Suspense>} />
          <Route path="manager/knowledge/:articleId" element={<Suspense fallback={<PageState loading />}><KnowledgeArticle /></Suspense>} />
          <Route path="live" element={<CallsPage key="live" live />} />
          <Route path="queues" element={<TicketsPage key="queue" queue />} />
          <Route path="customers" element={<Suspense fallback={<PageState loading />}><CustomersPage /></Suspense>} />
          <Route path="customers/:customerId" element={<Suspense fallback={<PageState loading />}><CustomersPage /></Suspense>} />
          <Route path="calls" element={<CallsPage />} />
          <Route path="calls/:callId" element={<CallPage />} />
          <Route path="tickets" element={<TicketsPage />} />
          <Route path="tickets/:ticketId" element={<TicketPage />} />
          <Route path="employees" element={<TeamPage />} />
          <Route path="departments" element={<TeamPage initialTab="departments" />} />
          <Route path="analytics" element={<Suspense fallback={<PageState loading />}><CompanyAnalytics /></Suspense>} />
          <Route path="incidents" element={<IncidentsPage />} />
        </Route>
        <Route path="*" element={<PageState empty="Страница не найдена" />} />
      </Route>
    </Route>
  </Routes></BrowserRouter>
</QueryClientProvider></StrictMode>)
