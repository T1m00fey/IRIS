import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import {
  ArrowUpRight, Bell, Building2, Headphones, Laptop, ListOrdered, Monitor, Paintbrush,
  ShieldCheck, Sun, UserRound, type LucideIcon,
} from 'lucide-react'
import { api } from '../../api/client'
import { usePreferences, useUser, type Preferences, type User } from '../../app/session'
import { PageHeading } from '../../components/PageHeading'
import { PageState } from '../../components/PageState'
import { AudioSettings } from './AudioSettings'
import { PermissionList, SettingRow, SettingSwitch, SettingsCard, UnavailableSetting } from './SettingsControls'
import './settings.css'

interface SettingsSection {
  id: string
  label: string
  icon: LucideIcon
}

const operatorSections: SettingsSection[] = [
  { id: 'workspace', label: 'Рабочее место', icon: Monitor },
  { id: 'audio', label: 'Аудиоустройства', icon: Headphones },
  { id: 'notifications', label: 'Уведомления', icon: Bell },
  { id: 'appearance', label: 'Оформление', icon: Paintbrush },
  { id: 'account', label: 'Аккаунт', icon: UserRound },
  { id: 'permissions', label: 'Мои разрешения', icon: ShieldCheck },
]

const managerSections: SettingsSection[] = [
  { id: 'company', label: 'Компания', icon: Building2 },
  { id: 'contact-center', label: 'Контакт-центр', icon: Headphones },
  { id: 'queues', label: 'Очереди и регламенты', icon: ListOrdered },
  { id: 'permissions', label: 'Разрешения', icon: ShieldCheck },
  { id: 'notifications', label: 'Уведомления', icon: Bell },
  { id: 'personal', label: 'Личные настройки', icon: UserRound },
]

interface PreferenceControls {
  settings: Preferences
  saving: boolean
  save: (change: Partial<Preferences>) => void
}

interface ContactCenterOverview {
  enabled: boolean
  departments: { code: string; name: string }[]
}

export function SettingsPage() {
  const user = useUser()
  return <RoleSettings key={user.id} user={user} />
}

function RoleSettings({ user }: { user: User }) {
  const { query, update } = usePreferences()
  const manager = user.role === 'manager'
  const sections = manager ? managerSections : operatorSections
  const [active, setActive] = useState(sections[0].id)
  const overview = active === sections[0].id
  const preferences = query.data && {
    settings: query.data,
    saving: update.isPending,
    save: update.mutate,
  }

  return <>
    <PageHeading title="Настройки" subtitle={manager
      ? 'Параметры компании, контакт-центра и учётной записи'
      : 'Параметры рабочего пространства и системы'} />
    <div className="iris-settings">
      <nav className="iris-settings-nav" aria-label="Разделы настроек">
        {sections.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={active === id}
          aria-controls="iris-settings-content" onClick={() => setActive(id)}>
          <Icon size={21} aria-hidden="true" />{label}
        </button>)}
      </nav>
      {update.isError && <p className="alert iris-settings-feedback" role="alert">Не удалось сохранить настройки. {update.error.message}</p>}
      {update.isPending && <p className="iris-settings-feedback muted" role="status">Сохранение настроек…</p>}
      {update.isSuccess && <p className="success iris-settings-feedback" role="status">Настройки сохранены</p>}
      <div id="iris-settings-content" className={overview ? 'iris-settings-overview' : 'iris-settings-single'}>
        {manager
          ? <ManagerSettings active={active} overview={overview} user={user} preferences={preferences} />
          : <OperatorSettings active={active} overview={overview} user={user} preferences={preferences} />}
        {!preferences && (overview || active === 'notifications' || active === 'personal') &&
          <PageState loading={query.isPending} error={query.error} retry={() => void query.refetch()} />}
      </div>
    </div>
  </>
}

function OperatorSettings({ active, overview, user, preferences }: {
  active: string
  overview: boolean
  user: User
  preferences?: PreferenceControls
}) {
  return <>
    {overview && <div className="iris-settings-top">
      <SettingsCard title="Рабочее место" description="Основные параметры работы оператора" icon={Laptop}>
        {preferences && <>
          <SettingSwitch title="Показывать сводку ИИ" description="Раскрывать сводку при открытии звонка"
            checked={preferences.settings.summary_expanded} disabled={preferences.saving}
            onChange={summary_expanded => preferences.save({ summary_expanded })} />
          <DensitySetting {...preferences} />
          <SidebarSetting {...preferences} />
        </>}
        <UnavailableSetting title="Статус по умолчанию и пауза после звонка" reason="Правила готовности задаёт контакт-центр." />
      </SettingsCard>
      <AudioSettings />
    </div>}
    {!overview && active === 'audio' && <AudioSettings />}
    <SettingsGroup overview={overview}>
      {(overview || active === 'notifications') && <NotificationSettings preferences={preferences} />}
      {(overview || active === 'appearance') && <AppearanceSettings />}
      {(overview || active === 'permissions') && <PermissionSettings manager={false} />}
    </SettingsGroup>
    {active === 'account' && <SettingsCard title="Аккаунт" description="Данные вашей учётной записи" icon={UserRound}>
      <AccountDetails user={user} />
      <SettingsLink to="/profile">Открыть мой профиль</SettingsLink>
    </SettingsCard>}
  </>
}

function ManagerSettings({ active, overview, user, preferences }: {
  active: string
  overview: boolean
  user: User
  preferences?: PreferenceControls
}) {
  const showContactCenter = overview || active === 'contact-center'
  const contactCenter = useQuery({
    queryKey: ['manager', 'settings', 'contact-center', user.id],
    queryFn: ({ signal }) => api<ContactCenterOverview>('/api/v1/manager/contact-center?limit=1', { signal }),
    enabled: showContactCenter,
  })

  return <>
    {showContactCenter && <div className={overview ? 'iris-settings-top' : undefined}>
      {overview && <SettingsCard title="Компания" description="Рабочая область организации" icon={Building2}>
        <SettingRow title="Организация"><span className="iris-settings-value">{user.company || 'Не указана в профиле'}</span></SettingRow>
        <SettingRow title="Учётная запись"><span className="iris-settings-value">{user.full_name}</span></SettingRow>
        <UnavailableSetting title="Реквизиты компании" reason="Редактирование из кабинета руководителя недоступно." />
      </SettingsCard>}
      <SettingsCard title="Контакт-центр" description="Отделы и распределение звонков" icon={Headphones}>
        {contactCenter.data ? <>
          <SettingRow title="Распределение звонков">
            <span className={contactCenter.data.enabled ? 'badge badge-success' : 'badge'}>
              {contactCenter.data.enabled ? 'Включено' : 'Отключено'}
            </span>
          </SettingRow>
          <SettingRow title="Доступные отделы"
            description={contactCenter.data.departments.map(department => department.name).join(' · ') || 'Нет активных отделов'} />
          <SettingsLink to="/manager/contact-center">Открыть контакт-центр</SettingsLink>
        </> : <PageState loading={contactCenter.isPending} error={contactCenter.error} retry={() => void contactCenter.refetch()} />}
      </SettingsCard>
    </div>}
    <SettingsGroup overview={overview}>
      {(overview || active === 'queues') && <SettingsCard title="Очереди и регламенты" description="Обработка и распределение обращений" icon={ListOrdered}>
        <SettingRow title="Очереди обращений" description="Просмотр и обработка обращений по отделам" />
        <UnavailableSetting title="Правила распределения и сроки" reason="Просмотр и редактирование регламентов из этого кабинета недоступны." />
        <SettingsLink to="/queues">Открыть очереди</SettingsLink>
      </SettingsCard>}
      {(overview || active === 'permissions') && <PermissionSettings manager />}
      {(overview || active === 'notifications') && <NotificationSettings manager preferences={preferences} />}
    </SettingsGroup>
    {active === 'personal' && <SettingsCard title="Личные настройки" description="Профиль и параметры отображения" icon={UserRound}>
      <AccountDetails user={user} />
      {preferences && <><DensitySetting {...preferences} /><SidebarSetting {...preferences} /></>}
      <SettingsLink to="/profile">Открыть мой профиль</SettingsLink>
    </SettingsCard>}
  </>
}

function SettingsGroup({ overview, children }: { overview: boolean; children: ReactNode }) {
  return overview ? <div className="iris-settings-bottom">{children}</div> : <>{children}</>
}

function DensitySetting({ settings, saving, save }: PreferenceControls) {
  return <SettingRow title="Плотность интерфейса" description="Расстояние между строками в таблицах">
    <select className="field iris-settings-select" aria-label="Плотность интерфейса" value={settings.density}
      disabled={saving} onChange={event => save({ density: event.target.value as Preferences['density'] })}>
      <option value="comfortable">Стандартная</option>
      <option value="compact">Компактная</option>
    </select>
  </SettingRow>
}

function SidebarSetting({ settings, saving, save }: PreferenceControls) {
  return <SettingSwitch title="Свернуть панель навигации" description="Оставить только иконки разделов"
    checked={settings.sidebar_collapsed} disabled={saving} onChange={sidebar_collapsed => save({ sidebar_collapsed })} />
}

function NotificationSettings({ manager, preferences }: { manager?: boolean; preferences?: PreferenceControls }) {
  return <SettingsCard title="Уведомления" description="Параметры оповещений в вашем профиле" icon={Bell}>
    {!manager && <>
      <UnavailableSetting title="Входящие звонки" reason="Отдельное оповещение пока недоступно." />
      <UnavailableSetting title="Новые назначения" reason="Отдельное оповещение пока недоступно." />
    </>}
    <UnavailableSetting title="Важные инциденты" reason="Отдельное оповещение пока недоступно." />
    {preferences && <>
      <SettingSwitch title="Уведомления рабочего стола"
        checked={preferences.settings.desktop_notifications} disabled={preferences.saving}
        onChange={desktop_notifications => preferences.save({ desktop_notifications })} />
      <SettingSwitch title="Звуковые уведомления"
        checked={preferences.settings.sound_notifications} disabled={preferences.saving}
        onChange={sound_notifications => preferences.save({ sound_notifications })} />
      <p className="iris-settings-note">IRIS сохраняет выбор. Браузерные и звуковые оповещения пока недоступны.</p>
    </>}
  </SettingsCard>
}

function AppearanceSettings() {
  return <SettingsCard title="Оформление" description="Внешний вид интерфейса" icon={Paintbrush}>
    <div className="iris-settings-theme">
      <Sun size={27} aria-hidden="true" />
      <strong>Светлая</strong>
      <span>Текущая тема</span>
    </div>
    <UnavailableSetting title="Размер интерфейса" reason="Масштаб страницы меняется средствами браузера." />
  </SettingsCard>
}

function PermissionSettings({ manager }: { manager: boolean }) {
  return <SettingsCard title={manager ? 'Разрешения' : 'Права доступа'} description="Возможности вашей роли" icon={ShieldCheck}
    badge={manager ? 'Руководитель' : 'Оператор'}>
    {manager ? <PermissionList allowed={['Клиентская база и история звонков', 'Обработка и перенаправление обращений', 'Просмотр команды и отделов', 'Аналитика контакт-центра']}
      restricted="Изменение ролей недоступно" /> :
      <PermissionList allowed={['Назначенные звонки и история', 'Работа с доступными обращениями', 'Просмотр данных доступных клиентов', 'Добавление заметок к звонкам']}
        restricted="Управление командой и настройками компании недоступно" />}
  </SettingsCard>
}

function AccountDetails({ user }: { user: User }) {
  return <dl className="iris-settings-account">
    <div><dt>Имя</dt><dd>{user.full_name}</dd></div>
    <div><dt>Имя пользователя</dt><dd>{user.username}</dd></div>
    <div><dt>Компания</dt><dd>{user.company || 'Не указана'}</dd></div>
    <div><dt>Роль</dt><dd>{user.role === 'manager' ? 'Руководитель' : 'Оператор'}</dd></div>
  </dl>
}

function SettingsLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link className="text-link iris-settings-link" to={to}>{children}<ArrowUpRight size={16} aria-hidden="true" /></Link>
}
