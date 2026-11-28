import { mkdir } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ context }) => {
  const session = await context.request.post('/api/v1/auth/login', {
    data: { username: 'manager', password: 'iris-manager' },
  })
  expect(session.ok()).toBeTruthy()
})

test('manager home charts and voice queues use their own data', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-27T18:00:00+03:00'))
  const calls = Array.from({ length: 104 }, (_, index) => ({
    id: 'call-' + index,
    started_at: new Date(Date.parse('2026-11-27T17:00:00+03:00') - index * 5 * 60_000).toISOString(),
  }))
  calls.push({ id: 'previous-day', started_at: '2026-11-26T23:50:00+03:00' })
  await page.route('**/api/v1/calls?limit=100&offset=*', async route => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset'))
    await route.fulfill({ json: { items: calls.slice(offset, offset + 100), total: calls.length, limit: 100, offset } })
  })
  await page.route('**/api/v1/manager/analytics?from_date=2026-11-26&to_date=2026-11-27', route => route.fulfill({ json: {
    daily: [
      { date: '2026-11-26', total_calls: 90, accepted_calls: 85, total_tickets: 18 },
      { date: '2026-11-27', total_calls: 104, accepted_calls: 96, total_tickets: 26 },
    ],
  } }))

  const departments = [
    { code: 'technical_support', name: 'Техподдержка' },
    { code: 'billing', name: 'Платежи' },
    { code: 'connection', name: 'Подключения' },
  ]
  const statuses = {
    technical_support: ['available', 'available', 'busy', 'busy', 'paused', 'offline', 'wrap_up'],
    billing: ['available', 'available', 'busy', 'lunch'],
    connection: ['available', 'offline'],
  }
  const employees = Object.entries(statuses).flatMap(([department, states]) =>
    states.map((status, index) => ({ id: department + '-' + index, department, status })))
  await page.route('**/api/v1/employees', route => route.fulfill({ json: employees }))
  const items = [
    { call_id: 'call-1', department: 'technical_support', state: 'waiting', waiting_seconds: 60, assignment: null },
    { call_id: 'call-2', department: 'technical_support', state: 'offered', waiting_seconds: 120, assignment: { employee_id: 'technical_support-0' } },
    { call_id: 'call-3', department: 'billing', state: 'connecting', waiting_seconds: 35, assignment: null },
    { call_id: 'call-4', department: 'technical_support', state: 'connected', waiting_seconds: 400, assignment: { employee_id: 'technical_support-2' } },
  ]
  await page.route('**/api/v1/manager/contact-center?limit=100&offset=0', route => route.fulfill({ json: {
    enabled: true, departments, items, total: items.length, limit: 100, offset: 0,
  } }))

  await page.goto('/manager')
  await expect(page.getByRole('article').filter({ hasText: 'Звонки сегодня' })).toContainText('+14')
  await expect(page.getByRole('article').filter({ hasText: 'Обращения' })).toContainText('26')
  await expect(page.getByRole('region', { name: 'Текущая ситуация' })).toContainText('Постобработка')
  const support = page.getByRole('region', { name: 'Очереди' }).getByRole('listitem').filter({ hasText: 'Техподдержка' })
  await expect(support).toContainText('2 ожидают')
  await expect(support).toContainText('Доступно · 1')
  await expect(support).toContainText('1 мин 30 с')
  await expect(support.getByRole('progressbar')).toHaveAttribute('value', '2')
  await expect(page.getByRole('link', { name: 'Все очереди' })).toHaveAttribute('href', '/manager/contact-center')
  await expect(page.getByRole('link', { name: 'Все обращения' })).toHaveAttribute('href', '/tickets')
  await expect(page.getByRole('link', { name: 'Все инциденты' })).toHaveAttribute('href', '/incidents')
  await expect(page.getByRole('link', { name: /T-1042/ })).toHaveAttribute('href', '/tickets/T-1042')
  expect(await page.getByRole('region', { name: 'Сетевые инциденты' }).getByText('Затронуто клиентов', { exact: false }).count()).toBe(0)

  const hour = page.getByRole('button', { name: '08:00–09:00, звонков 7' })
  await expect(hour).toBeVisible()
  const screenshots = process.env.IRIS_E2E_SCREENSHOTS
  if (screenshots) await mkdir(screenshots, { recursive: true })
  for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 800], [1024, 768], [390, 844]]) {
    await page.setViewportSize({ width, height })
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    if (screenshots) await page.screenshot({ path: screenshots + '/manager-dashboard-' + width + '.png', fullPage: true })
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await hour.hover()
  await expect(page.getByText('Звонков · 7')).toBeVisible()
  if (screenshots) await page.screenshot({ path: screenshots + '/manager-dashboard-tooltip-1440.png', fullPage: true })
  await hour.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('button', { name: '09:00–10:00, звонков 12' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Звонков · 12')).toHaveCount(0)

  const row = page.getByRole('button', { name: /Повреждение линии связи/ })
  const dialog = page.getByRole('dialog', { name: 'Повреждение линии связи' })
  await row.click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Время обнаружения')).toBeVisible()
  await dialog.getByRole('button', { name: 'Закрыть' }).click()
  await expect(dialog).toBeHidden()
  await expect(row).toBeFocused()
})
