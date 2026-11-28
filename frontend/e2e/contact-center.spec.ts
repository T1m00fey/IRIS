import { mkdir } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

const department = { code: 'technical_support', name: 'Техническая поддержка' }
const queuePath = '**/api/v1/manager/contact-center?*'
const livePath = '**/api/v1/calls?live=true&*'
const route = '/manager/contact-center'
const time = '2026-11-28T12:00:00Z'

async function capture(page: Page, name: string) {
  const directory = process.env.IRIS_E2E_CONTACT_CENTER_SCREENSHOTS
  if (!directory) return
  await mkdir(directory, { recursive: true })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: directory + '/' + name + '.png', fullPage: true })
}

test.beforeEach(async ({ context }) => {
  const login = await context.request.post('/api/v1/auth/login', { data: { username: 'manager', password: 'iris-manager' } })
  expect(login.ok()).toBeTruthy()
})

test('empty voice queue and disabled voice are distinguishable from event streaming', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  let enabled = false
  await page.route(queuePath, request => request.fulfill({ json: { enabled, departments: [department], items: [], total: 0, limit: 100, offset: 0 } }))
  await page.route(livePath, request => request.fulfill({ json: { items: [], total: 0, limit: 100, offset: 0 } }))
  await page.goto(route)
  const queue = page.getByRole('region', { name: 'Очередь звонков' })
  await expect(queue.getByText('Распределение голосовых звонков отключено')).toBeVisible()
  await expect(page.getByRole('banner').getByText('В реальном времени', { exact: true })).toBeVisible()
  await expect(page.getByText('Входящих и активных звонков нет')).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  const height = (await queue.boundingBox())?.height ?? 0
  expect(height).toBeLessThan(150)
  await capture(page, 'contact-center-voice-disabled-1440')

  enabled = true
  await page.reload()
  await expect(queue.getByText('Ожидающих звонков нет')).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveCount(1)
  await capture(page, 'contact-center-empty-1440')
})

test('active calls, voice queue and the call drawer use server data', async ({ page }) => {
  await page.clock.setFixedTime(new Date(time))
  const names = ['Тестовый клиент ИИ', 'Тестовый клиент в очереди', 'Тестовый клиент с предложением', 'Тестовый клиент на подключении', 'Тестовый клиент в разговоре']
  const phases = ['ai_active', 'waiting_for_operator', 'waiting_for_operator', 'operator_joining', 'with_operator']
  const calls = names.map((name, index) => ({
    id: 'qa-call-' + index, status: 'active', phase: phases[index], outcome: 'unknown', customer_id: null,
    customer_name: name, caller_phone_masked: '+7 ••• ••• 00 0' + index, account_number: null,
    department: department.code, started_at: '2026-11-28T11:54:00Z', connected_at: '2026-11-28T11:55:00Z',
    ended_at: null, duration_seconds: 300, summary: 'Тестовая проверка подключения',
  }))
  const staff = [
    { id: 'free', full_name: 'Тестовый Свободный', department: department.code, status: 'available' },
    { id: 'offered', full_name: 'Тестовый Получатель', department: department.code, status: 'available' },
    { id: 'connecting', full_name: 'Тестовый Подключается', department: department.code, status: 'busy' },
    { id: 'connected', full_name: 'Тестовый Оператор', department: department.code, status: 'busy' },
  ]
  const items = ['waiting', 'offered', 'connecting', 'connected'].map((state, index) => ({
    call_id: calls[index + 1].id, department: department.code, state,
    priority: index === 0 ? 'high' : 'normal', category: null, waiting_seconds: (index + 1) * 30,
    assignment: index === 0 ? null : { employee_id: staff[index].id, employee_name: staff[index].full_name, connected_at: index === 3 ? '2026-11-28T11:58:00Z' : null },
  }))
  await page.route(livePath, request => request.fulfill({ json: { items: calls, total: calls.length, limit: 100, offset: 0 } }))
  await page.route(queuePath, request => request.fulfill({ json: { enabled: true, departments: [department], items, total: items.length, limit: 100, offset: 0 } }))
  await page.route('**/api/v1/employees', request => request.fulfill({ json: staff }))
  await page.route('**/api/v1/calls/qa-call-4', request => request.fulfill({ json: {
    ...calls[4], handoff: null, summary_reviewed_at: time, can_join: false, crm_checks: [], ai_actions: [],
    transcript: [{ id: 1, speaker: 'customer', text: 'Тестовая реплика клиента', created_at: time }],
    events: [{ type: 'assignment.connected', created_at: time, details: null }],
    tickets: [{ id: 'T-1042', title: 'Тестовое обращение', status: 'in_progress' }],
  } }))

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(route)
  const active = page.getByRole('region', { name: 'Активные звонки' })
  for (const label of ['Обслуживается ИИ', 'Ожидает оператора', 'Предложен сотруднику', 'Подключается', 'Разговор с оператором']) {
    await expect(active.getByText(label, { exact: true })).toBeVisible()
  }
  const queue = page.getByRole('region', { name: 'Очередь звонков' })
  await expect(queue.getByRole('row')).toHaveCount(4)
  await expect(queue.getByText('Тестовый клиент в разговоре')).toHaveCount(0)
  await expect(page.getByText('1 мин 0 с', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('2 мин 0 с в разговоре')).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '3')
  await expect(page.getByRole('progressbar')).toHaveAttribute('max', '4')
  await capture(page, 'contact-center-active-1440')

  const callButton = active.getByRole('button', { name: /Тестовый клиент в разговоре/ })
  await callButton.click()
  const drawer = page.getByRole('dialog', { name: 'Карточка звонка' })
  await expect(drawer.getByText('Тестовый Оператор')).toBeVisible()
  await expect(drawer.getByRole('heading', { name: 'Сводка ИИ' })).toBeVisible()
  await expect(drawer.getByText('Оператор подключился')).toBeVisible()
  await drawer.getByText('Транскрипция · 1').click()
  await expect(drawer.getByText('Тестовая реплика клиента')).toBeVisible()
  await expect(drawer.getByRole('link', { name: /T-1042/ })).toHaveAttribute('href', '/tickets/T-1042')
  await drawer.getByRole('heading', { name: 'Карточка звонка' }).scrollIntoViewIfNeeded()
  await capture(page, 'contact-center-drawer-1440')
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(callButton).toBeFocused()

  await page.getByRole('button', { name: 'Очереди', exact: true }).click()
  await expect(page).toHaveURL(/view=queue/)
  await page.getByRole('combobox', { name: 'Состояние очереди звонков' }).selectOption('offered')
  await expect(queue.getByRole('row')).toHaveCount(2)
  await expect(queue.getByText('Тестовый Получатель')).toBeVisible()
  await page.getByRole('button', { name: 'История звонков', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Полная история' })).toHaveAttribute('href', '/calls')
  await expect(page.getByRole('region', { name: 'Таблица истории звонков' })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('button', { name: 'Очереди', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.getByRole('button', { name: 'В реальном времени', exact: true }).click()

  for (const width of [1920, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    if (width === 390) {
      for (const table of [active, queue]) {
        expect(await table.locator('.cc-table-scroll').evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0)
      }
    }
    await capture(page, 'contact-center-active-' + width)
  }
})
