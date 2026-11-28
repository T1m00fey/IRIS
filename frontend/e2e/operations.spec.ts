import { expect, test, type BrowserContext } from '@playwright/test'

async function login(context: BrowserContext, role: 'manager' | 'operator') {
  const response = await context.request.post('/api/v1/auth/login', { data: { username: role, password: 'iris-' + role } })
  expect(response.ok()).toBeTruthy()
}

test('manager opens a call, its transcript, CRM and linked ticket', async ({ page, context }) => {
  await login(context, 'manager')
  await page.goto('/calls/call_1042')
  await expect(page.getByRole('heading', { name: 'Карточка звонка' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Сводка ИИ' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Проверки CRM' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Принять звонок' })).toBeDisabled()
  await page.getByText(/Транскрипция ·/).click()
  await expect(page.locator('details[open] .timeline li').first()).toBeVisible()
  await page.getByRole('link', { name: 'Интернет недоступен после оплаты' }).click()
  await expect(page).toHaveURL(/\/tickets\/T-1042$/)
  await expect(page.getByRole('heading', { name: 'Содержание обращения' })).toBeVisible()
})

test('operator opens the desk, checks live updates and reads available history', async ({ page, context }) => {
  await login(context, 'operator')
  const workspace = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/operator/workspace' && response.ok())
  await page.goto('/workspace')
  const data = await (await workspace).json() as { history: { id: string }[]; assignment: unknown; voice_available: boolean }
  await expect(page.getByRole('heading', { name: 'Рабочее место' })).toBeVisible()
  const calls = page.locator('.desk-list')
  await expect(calls.getByRole('heading', { name: /^Звонки/ })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Рабочий статус' })).toBeVisible()
  await expect(page.getByText('В реальном времени', { exact: true })).toBeVisible()
  if (!data.voice_available) await expect(page.getByText('Голосовые функции недоступны')).toBeVisible()
  if (!data.assignment) await expect(page.getByText('Назначенных звонков пока нет')).toBeVisible()

  await calls.getByRole('button', { name: 'История', exact: true }).click()
  if (data.history.length) {
    const call = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/operator/calls/' + data.history[0].id)
    await calls.locator('.desk-calls button').first().click()
    expect((await call).ok()).toBeTruthy()
    await expect(page.getByRole('heading', { name: 'Сводка ИИ' })).toBeVisible()
  } else {
    await expect(page.getByText('История звонков пуста')).toBeVisible()
  }
})

test('sign-in redirects the operator and protects manager data in the API', async ({ page, context }) => {
  const anonymous = await context.request.get('/api/v1/customers')
  expect(anonymous.status()).toBe(401)
  await page.goto('/customers')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('Имя пользователя').fill('operator')
  await page.getByLabel('Пароль').fill('iris-operator')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/operator$/)
  await page.goto('/customers')
  await expect(page).toHaveURL(/\/operator$/)
  expect((await context.request.get('/api/v1/customers')).status()).toBe(403)
})
