import { expect, test, type BrowserContext, type Page } from '@playwright/test'

type Role = 'manager' | 'operator'
const preferences = '/api/v1/auth/preferences'

test.skip(process.env.IRIS_E2E_WRITE !== '1', 'Use a demo SQLite database for settings writes')

async function login(context: BrowserContext, role: Role) {
  const response = await context.request.post('/api/v1/auth/login', { data: { username: role, password: 'iris-' + role } })
  expect(response.ok()).toBeTruthy()
}

function section(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('button', { name, exact: true })
}

test('operator settings persist, apply to the workspace and report failed saves', async ({ page, context }) => {
  await login(context, 'operator')
  const initial = await (await context.request.get(preferences)).json() as { summary_expanded: boolean; density: string }
  try {
    await page.goto('/settings')
    const summary = page.getByRole('switch', { name: 'Показывать сводку ИИ' })
    await expect(summary).toHaveAttribute('aria-checked', String(initial.summary_expanded))
    await summary.click()
    await expect(page.getByText('Настройки сохранены', { exact: true })).toBeVisible()
    await page.reload()
    await expect(summary).toHaveAttribute('aria-checked', String(!initial.summary_expanded))

    const density = initial.density === 'compact' ? 'comfortable' : 'compact'
    await page.getByRole('combobox', { name: 'Плотность интерфейса' }).selectOption(density)
    await expect(page.getByText('Настройки сохранены', { exact: true })).toBeVisible()
    expect((await (await context.request.get(preferences)).json()).density).toBe(density)
    await expect(page.locator('.v3-shell')).toHaveClass(density === 'compact' ? /density-compact/ : /^(?!.*density-compact)/)

    await page.route('**' + preferences, route => route.request().method() === 'PATCH'
      ? route.fulfill({ status: 503, json: { detail: 'Сервер временно недоступен' } }) : route.continue())
    await summary.click()
    await expect(page.getByRole('alert')).toContainText('Сервер временно недоступен')
    await expect(page.getByText('Настройки сохранены', { exact: true })).toHaveCount(0)
    await expect(summary).toHaveAttribute('aria-checked', String(!initial.summary_expanded))
    await expect(section(page, 'Компания')).toHaveCount(0)

    await section(page, 'Аккаунт').click()
    await expect(page.getByRole('link', { name: 'Открыть мой профиль' })).toHaveAttribute('href', '/profile')
    await section(page, 'Оформление').click()
    await expect(page.getByText('Светлая', { exact: true })).toBeVisible()
    await expect(page.getByText(/Масштаб страницы меняется средствами браузера/)).toBeVisible()
    await section(page, 'Уведомления').click()
    for (const title of ['Входящие звонки', 'Новые назначения', 'Важные инциденты']) {
      await expect(page.getByText(title, { exact: true })).toBeVisible()
      await expect(page.getByRole('switch', { name: title })).toHaveCount(0)
    }
  } finally {
    expect((await context.request.patch(preferences, { data: initial })).ok()).toBeTruthy()
  }
})

test('manager sees business settings and saves only personal preferences', async ({ page, context, browser }) => {
  await login(context, 'manager')
  const operator = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const initial = await (await context.request.get(preferences)).json() as { sound_notifications: boolean }
  try {
    await login(operator, 'operator')
    const operatorSettings = await (await operator.request.get(preferences)).json()
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'Компания', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Открыть контакт-центр' })).toHaveAttribute('href', '/manager/contact-center')
    await expect(page.getByRole('link', { name: 'Открыть очереди' })).toHaveAttribute('href', '/queues')
    await expect(section(page, 'Аудиоустройства')).toHaveCount(0)
    await section(page, 'Разрешения').click()
    await expect(page.getByText('Изменение ролей недоступно')).toBeVisible()
    await section(page, 'Личные настройки').click()
    await expect(page.getByRole('combobox', { name: 'Плотность интерфейса' })).toBeVisible()
    await section(page, 'Уведомления').click()
    const sound = page.getByRole('switch', { name: 'Звуковые уведомления' })
    await sound.click()
    await expect(page.getByText('Настройки сохранены', { exact: true })).toBeVisible()
    await page.reload()
    await expect(sound).toHaveAttribute('aria-checked', String(!initial.sound_notifications))
    expect(await (await operator.request.get(preferences)).json()).toEqual(operatorSettings)
  } finally {
    await operator.close()
    expect((await context.request.patch(preferences, { data: initial })).ok()).toBeTruthy()
  }
})
