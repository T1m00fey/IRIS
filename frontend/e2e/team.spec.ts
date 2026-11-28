import { expect, test } from '@playwright/test'

const team = [
  { id: 'operator_1', full_name: 'Александра Орлова', department: 'technical_support', status: 'available' },
  { id: 'operator_2', full_name: 'Иван Кузнецов', department: 'billing', status: 'busy' },
  { id: 'operator_3', full_name: 'Мария Котова', department: 'connection', status: 'paused' },
  { id: 'operator_4', full_name: 'Павел Васильев', department: 'technical_support', status: 'lunch' },
  { id: 'operator_5', full_name: 'Елена Лебедева', department: 'billing', status: 'available' },
  { id: 'operator_6', full_name: 'Дмитрий Соколов', department: 'connection', status: 'wrap_up' },
  { id: 'operator_7', full_name: 'Анна Никитина', department: 'technical_support', status: 'offline' },
  { id: 'operator_8', full_name: 'Сергей Мартынов', department: 'billing', status: 'busy' },
].map(person => ({ ...person, updated_at: '2026-11-28T08:10:00Z' }))
const departments = [
  { code: 'technical_support', name: 'Техническая поддержка' },
  { code: 'billing', name: 'Биллинг' },
  { code: 'connection', name: 'Подключения' },
]

test.beforeEach(async ({ context }) => {
  const login = await context.request.post('/api/v1/auth/login', { data: { username: 'manager', password: 'iris-manager' } })
  expect(login.ok()).toBeTruthy()
})

test('team filters and connected calls use manager data', async ({ page }) => {
  await page.setViewportSize({ width: 1672, height: 941 })
  await page.clock.setFixedTime(new Date('2026-11-28T09:15:00Z'))
  await page.route('**/api/v1/employees', route => route.fulfill({ json: team }))
  await page.route('**/api/v1/manager/contact-center?state=connected&*', route => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset'))
    const calls = [
      { call_id: 'call_1042', assignment: { employee_id: 'operator_2', connected_at: '2026-11-28T09:10:32Z' } },
      { call_id: 'team-test-call', assignment: { employee_id: 'operator_8', connected_at: '2026-11-28T09:12:49Z' } },
    ]
    return route.fulfill({ json: { enabled: true, departments, offset, limit: 1, total: calls.length, items: calls.slice(offset, offset + 1) } })
  })
  await page.goto('/employees')
  const table = page.getByRole('table')
  await expect(table.getByRole('row')).toHaveCount(9)
  const kpis = page.locator('.team-kpis')
  await expect(kpis.locator('strong')).toHaveText(['8', '2', '2', '1', '1'])
  await expect(page.locator('.team-occupancy strong')).toHaveText('25 %')
  await expect(page.getByRole('meter', { name: /Биллинг/ })).toHaveAttribute('value', '1')
  await expect(table.getByRole('link', { name: 'Открыть звонок call_1042' })).toHaveText('4 мин 28 с')
  await expect(table.getByRole('link', { name: 'Открыть звонок team-test-call' })).toBeVisible()

  if (process.env.IRIS_TEAM_SCREENSHOTS) {
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: process.env.IRIS_TEAM_SCREENSHOTS + '/synthetic-desktop.png', fullPage: true })
  }

  await page.getByRole('combobox', { name: 'Отдел', exact: true }).selectOption('billing')
  await page.getByRole('combobox', { name: 'Статус', exact: true }).selectOption('busy')
  await expect(table.getByRole('row')).toHaveCount(3)
  await page.getByRole('searchbox', { name: 'Поиск сотрудника' }).fill('никитина')
  await expect(page.getByText('Сотрудники по фильтрам не найдены')).toBeVisible()
  await page.getByRole('button', { name: 'Сбросить' }).click()
  await page.getByRole('button', { name: 'Дополнительные фильтры' }).click()
  await page.locator('.team-extra-filters select').selectOption('connected')
  await expect(table.getByRole('row')).toHaveCount(3)
  await page.getByRole('button', { name: 'Действия для сотрудника Иван Кузнецов' }).click()
  await expect(page.getByRole('link', { name: 'Открыть текущий звонок' })).toBeVisible()
  await page.getByRole('button', { name: 'Сведения о сотруднике' }).click()
  const details = page.getByRole('dialog', { name: 'Иван Кузнецов' })
  await expect(details.getByText('Биллинг')).toBeVisible()
  await expect(details.getByRole('link', { name: 'Открыть звонок call_1042' })).toBeVisible()
  await details.getByRole('button', { name: 'Закрыть сведения' }).click()
  await expect(details).toBeHidden()
  await table.getByRole('link', { name: 'Открыть звонок call_1042' }).click()
  await expect(page).toHaveURL(/\/calls\/call_1042$/)
})

test('manager updates multiple specializations and sees them after reload', async ({ context, page }) => {
  test.skip(process.env.IRIS_E2E_WRITE !== '1', 'Use a fresh demo SQLite database for mutations')
  await page.setViewportSize({ width: 390, height: 844 })
  const endpoint = '/api/v1/employees/operator_1/specializations'
  const response = await context.request.get('/api/v1/employees')
  expect(response.ok()).toBeTruthy()
  const employees = await response.json() as { id: string; specializations: string[] }[]
  const original = employees.find(person => person.id === 'operator_1')!.specializations
  const openDetails = async () => {
    await page.getByRole('button', { name: 'Действия для сотрудника Александра Орлова' }).click()
    await page.getByRole('button', { name: 'Сведения о сотруднике' }).click()
  }
  const details = page.getByRole('dialog', { name: 'Александра Орлова' })
  const sales = details.getByRole('checkbox', { name: /^SALES/ })
  const firstLine = details.getByRole('checkbox', { name: /^L1/ })
  const secondLine = details.getByRole('checkbox', { name: /^L2/ })
  const save = details.getByRole('button', { name: 'Сохранить специализации' })
  try {
    await page.goto('/employees')
    await openDetails()
    await sales.check()
    await firstLine.check()
    await secondLine.check()
    await save.click()
    await expect(details.getByRole('status')).toHaveText('Специализации сохранены')
    await page.reload()
    await openDetails()
    await expect(sales).toBeChecked()
    await expect(firstLine).toBeChecked()
    await expect(secondLine).toBeChecked()
    await firstLine.uncheck()
    await save.click()
    await expect(details.getByRole('status')).toHaveText('Специализации сохранены')
    await details.getByRole('button', { name: 'Закрыть сведения' }).click()
    await expect(page.getByRole('row', { name: /Александра Орлова/ }).getByText('SALES, L2')).toBeVisible()
  } finally {
    const reset = await context.request.put(endpoint, { data: { specializations: original } })
    expect(reset.ok()).toBeTruthy()
  }
})

test('team and departments routes work on a narrow viewport with the demo API', async ({ context, page }) => {
  const response = await context.request.get('/api/v1/manager/contact-center?state=connected')
  expect(response.ok()).toBeTruthy()
  const { enabled } = await response.json() as { enabled: boolean }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/departments')
  const departmentsTab = page.getByRole('tab', { name: 'Отделы', exact: true })
  await expect(departmentsTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('table')).toBeVisible()
  await departmentsTab.focus()
  await departmentsTab.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'График смен' })).toBeFocused()
  await expect(page.getByRole('tabpanel').getByText('Расписание смен недоступно в текущей конфигурации')).toBeVisible()
  await page.getByRole('tab', { name: 'Роли и доступы' }).click()
  await expect(page.getByRole('tabpanel').getByText('OPERATOR', { exact: true })).toBeVisible()
  await expect(page.getByRole('tabpanel').getByText('MANAGER', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Сотрудники' }).click()
  await expect(page.getByRole('rowheader', { name: 'Александра Орлова' })).toBeVisible()
  await expect(page.getByText('Распределение звонков отключено')).toHaveCount(enabled ? 0 : 1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  if (process.env.IRIS_TEAM_SCREENSHOTS) {
    await page.mouse.click(2, 2)
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: process.env.IRIS_TEAM_SCREENSHOTS + '/demo-mobile.png', fullPage: true })
  }
  const region = page.getByRole('region', { name: 'Таблица сотрудников' })
  await region.scrollIntoViewIfNeeded()
  await region.evaluate(element => { element.scrollLeft = element.scrollWidth })
  await expect(page.getByRole('button', { name: 'Действия для сотрудника Александра Орлова' })).toBeInViewport()
})
