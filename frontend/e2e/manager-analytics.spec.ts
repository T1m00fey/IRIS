import { expect, test, type Page } from '@playwright/test'

const departments = [
  { code: 'technical_support', name: 'Техническая поддержка' },
  { code: 'billing', name: 'Платежи и расчёты' },
  { code: 'connection', name: 'Новые подключения' },
]
const names = ['Александра Орлова', 'Максим Козлов', 'Елена Иванова', 'Сергей Волков']
const employees = names.map((full_name, index) => ({ id: 'employee_' + index, full_name, department: departments[index % 3].code }))
const totals = [196, 243, 307, 314, 428, 329, 322]
const accepted = [165, 216, 266, 270, 392, 282, 278]
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

async function mockAnalytics(page: Page) {
  await page.clock.setFixedTime(new Date('2026-04-18T13:00:00Z'))
  await page.route('**/api/v1/employees', route => route.fulfill({ json: employees }))
  await page.route('**/api/v1/manager/analytics?*', route => {
    const filters = new URL(route.request().url()).searchParams
    const from = filters.get('from_date')!
    const to = filters.get('to_date')!
    const person = employees.find(employee => employee.id === filters.get('employee_id'))
    const department = filters.get('department')
    const empty = from < '2026-04-05'
    const prior = to < '2026-04-12'
    const multiplier = empty ? 0 : person ? .055 : department ? .46 : 1
    const scale = (value: number) => Math.round(value * multiplier * (prior ? .8 : 1))
    const daily = Array.from({ length: (Date.parse(to) - Date.parse(from)) / 86400000 + 1 }, (_, index) => {
      const date = new Date(Date.parse(from) + index * 86400000).toISOString().slice(0, 10)
      const day = Number(date.slice(-2)) - (prior ? 5 : 12)
      const total_calls = from === to && !prior && !empty ? 1 : scale(totals[day] ?? 0)
      const accepted_calls = from === to && !prior && !empty ? 1 : scale(accepted[day] ?? 0)
      return { date, total_calls, accepted_calls, abandoned_calls: total_calls - accepted_calls, total_tickets: 0, resolved_tickets: 0 }
    })
    const total = sum(daily.map(day => day.total_calls))
    const answered = Math.floor(total * .59)
    const created = Math.floor(total * .22)
    const unresolved = Math.floor(total * .09)
    const noConfirmation = Math.floor(total * .06)
    return route.fulfill({ json: {
      total_calls: total, accepted_calls: sum(daily.map(day => day.accepted_calls)), abandoned_calls: sum(daily.map(day => day.abandoned_calls)),
      total_tickets: from === '2026-04-12' ? person ? person.id === 'employee_0' ? 2 : 0 : department ? 3 : 4 : 0,
      resolved_tickets: total ? person ? 7 : 34 : 0, average_answer_seconds: total ? prior ? 33 : 28 : null,
      average_duration_seconds: total ? 183 : null, average_wait_seconds: total ? 47 : null, departments, daily,
      by_department: departments.filter(item => !department || department === item.code).map((item, index) => ({
        department: item.code, name: item.name, total_calls: Math.round(total * (department ? 1 : [.55, .27, .18][index])),
        total_tickets: total ? [3, 1, 0][index] : 0, resolved_tickets: total ? [2, 1, 0][index] : 0,
      })),
      outcomes: [
        { outcome: 'answered', count: answered }, { outcome: 'ticket_created', count: created },
        { outcome: 'unresolved', count: unresolved }, { outcome: 'no_confirmation', count: noConfirmation },
        { outcome: 'unknown', count: total - answered - created - unresolved - noConfirmation },
      ],
    } })
  })
  await page.route('**/api/v1/tickets?*', route => {
    const rows = [
      { id: 'closed', department: 'technical_support', status: 'closed', assigned_employee_id: 'employee_0', started_at: '2026-04-18T08:00:00Z', closed_at: '2026-04-18T08:12:00Z' },
      { id: 'active', department: 'technical_support', status: 'in_progress', assigned_employee_id: 'employee_0' },
      { id: 'queued', department: 'technical_support', status: 'queued' },
      { id: 'other', department: 'billing', status: 'queued' },
    ].map(row => ({ ...row, created_at: '2026-04-17T21:15:00Z' }))
    const newer = Array.from({ length: 99 }, (_, index) => ({ id: 'future_' + index, created_at: '2026-04-18T21:00:00Z' }))
    const all = [...newer, ...rows, { id: 'older', created_at: '2026-04-11T20:59:59Z' }]
    const offset = Number(new URL(route.request().url()).searchParams.get('offset'))
    return route.fulfill({ json: { total: all.length, items: all.slice(offset, offset + 100) } })
  })
}

test.beforeEach(async ({ page, context }) => {
  const response = await context.request.post('/api/v1/auth/login', { data: { username: 'manager', password: 'iris-manager' } })
  expect(response.ok()).toBeTruthy()
  await mockAnalytics(page)
})

test('dashboard uses report totals and displays ticket statuses across pages', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1672, height: 941 })
  await page.goto('/analytics')
  const metrics = page.locator('.analytics-kpis')
  await expect(metrics.getByText('2 139', { exact: true })).toBeVisible()
  await expect(metrics.getByText('−15,2 %', { exact: true })).toBeVisible()
  const table = page.getByRole('table').first()
  await expect(table.getByRole('row')).toHaveCount(5)
  const processing = page.getByRole('heading', { name: 'Обработка обращений' }).locator('..').locator('..')
  await expect(processing.getByText('12 мин 0 с')).toBeVisible()
  await expect(processing.locator('dd')).toHaveText(['4', '1', '1', '2', '12 мин 0 с'])
  const chart = page.getByRole('slider', { name: 'Динамика звонков по дням' })
  await chart.focus()
  await chart.press('End')
  await expect(chart).toHaveAttribute('aria-valuetext', /Входящие 322, Принятые 278/)
  await chart.press('ArrowLeft')
  await expect(chart).toHaveAttribute('aria-valuetext', /Входящие 329/)
  await page.getByRole('heading', { name: 'Динамика звонков', exact: true }).click()
  const plot = (await chart.boundingBox())!
  await chart.hover({ position: { x: Math.round(plot.width * .67), y: 80 } })
  await expect(page.locator('.analytics-tooltip')).toContainText('428')
  await page.evaluate(() => document.fonts.ready)
  if (process.env.IRIS_ANALYTICS_SCREENSHOTS) {
    await page.screenshot({ path: process.env.IRIS_ANALYTICS_SCREENSHOTS + '/synthetic-desktop.png', fullPage: true })
  }

  await page.getByLabel('Отдел', { exact: true }).selectOption('technical_support')
  await page.getByLabel('Сотрудник', { exact: true }).selectOption('employee_0')
  await expect(table.getByRole('row')).toHaveCount(2)
  await expect(table.getByRole('rowheader')).toHaveText('АОАлександра Орлова')
  await expect(processing.locator('dd')).toHaveText(['2', '1', '1', '0', '12 мин 0 с'])
  expect(errors).toEqual([])
})

test('one call, empty periods and narrow viewports stay readable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/analytics')
  await expect(page.locator('.analytics-employee-table tbody tr')).toHaveCount(4)
  const period = page.getByLabel('Период', { exact: true })
  if (process.env.IRIS_ANALYTICS_SCREENSHOTS) {
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: process.env.IRIS_ANALYTICS_SCREENSHOTS + '/synthetic-mobile.png', fullPage: true })
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const employeeTable = page.getByRole('region', { name: 'Эффективность сотрудников' })
  await employeeTable.scrollIntoViewIfNeeded()
  await employeeTable.evaluate(element => { element.scrollLeft = element.scrollWidth })
  await expect(employeeTable.getByRole('columnheader', { name: 'Решено' })).toBeInViewport()
  await period.selectOption('1')
  const chart = page.getByRole('slider', { name: 'Динамика звонков по дням' })
  await expect(chart).toHaveAttribute('aria-valuemax', '1')
  await expect(chart.locator('text').filter({ hasText: /^4$/ })).toBeVisible()
  await period.selectOption('custom')
  await page.getByLabel('С', { exact: true }).fill('2026-01-01')
  await page.getByLabel('По', { exact: true }).fill('2026-01-07')
  await expect(page.getByText('За выбранный период звонков нет')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Результаты звонков' })).toBeVisible()
  await page.getByLabel('С', { exact: true }).fill('2026-01-08')
  await expect(page.getByText('Укажите корректный период от 1 до 366 дней')).toBeVisible()
  await expect(page.getByLabel('Отдел', { exact: true })).toBeEnabled()
})
