import { mkdir } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

const screenshots = process.env.IRIS_CRM_SCREENSHOTS

test.beforeEach(async ({ context }) => {
  const login = await context.request.post('/api/v1/auth/login', { data: { username: 'manager', password: 'iris-manager' } })
  expect(login.ok()).toBeTruthy()
})

test('обзор показывает данные одного счёта и сохраняет выбор при переходах', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/customers?q=100047')
  const catalog = page.getByRole('region', { name: 'Клиентская база' })
  await catalog.getByRole('link', { name: /Мария Смирнова/ }).click()
  const profile = page.getByRole('region', { name: 'Карточка выбранного клиента' })
  const accounts = profile.getByRole('region', { name: 'Лицевые счета', exact: true })
  const contacts = profile.getByRole('region', { name: 'Контактные данные' })
  const balance = profile.getByRole('region', { name: 'Баланс' })
  const service = profile.getByRole('region', { name: 'Тариф и услуги' })
  const tickets = profile.getByRole('region', { name: 'Последние обращения' })
  const payments = profile.getByRole('region', { name: 'История платежей' })
  const incidents = profile.getByRole('region', { name: 'Сетевые инциденты' })
  const account = profile.getByRole('combobox', { name: 'Активный лицевой счёт' })
  const ticket = tickets.getByRole('link', { name: 'Нестабильная связь на втором адресе' })

  await expect(catalog.getByRole('link', { name: /Мария Смирнова/ })).toHaveAttribute('aria-current', 'page')
  await expect(accounts.getByRole('button', { name: /Счёт 100046/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(contacts.getByText(/ул\. Примерная/)).toBeVisible()
  await expect(balance.getByText(/220\s*₽/)).toBeVisible()
  await expect(service.getByText('Домашний 500')).toBeVisible()
  await expect(payments.getByText(/850\s*₽/)).toBeVisible()
  await expect(ticket).toHaveCount(0)
  await expect(incidents.getByText('По этому адресу активных инцидентов нет')).toBeVisible()

  const request = page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname === '/api/v1/tickets' && url.searchParams.get('customer_id') === 'customer_100046'
      && url.searchParams.get('account_number') === '100047'
  })
  await accounts.getByRole('button', { name: /Счёт 100047/ }).click()
  expect((await request).ok()).toBeTruthy()
  await expect(account).toHaveValue('100047')
  await expect(profile.getByText('Основной счёт 100046')).toBeVisible()
  await expect(contacts.getByText(/наб\. Тренировочная/)).toBeVisible()
  await expect(contacts.getByText(/ул\. Примерная/)).toHaveCount(0)
  await expect(balance.getByText(/180\s*₽/)).toBeVisible()
  await expect(service.getByText('Домашний 100')).toBeVisible()
  await expect(payments.getByText(/500\s*₽/)).toBeVisible()
  await expect(payments.getByText(/850\s*₽/)).toHaveCount(0)
  await expect(ticket).toHaveAttribute('href', '/tickets/T-1047')
  await expect(incidents.getByText('Потери пакетов на узле доступа')).toBeVisible()

  if (screenshots) {
    await mkdir(screenshots, { recursive: true })
    await page.mouse.move(0, 0)
    await page.screenshot({ path: screenshots + '/customer-second-account-1440.png', fullPage: true })
  }
  await payments.getByRole('link', { name: 'Все платежи' }).click()
  await expect(page.getByRole('table').getByText('payment_100047')).toBeVisible()
  await page.reload()
  await expect(account).toHaveValue('100047')
  await expect(page.getByRole('table').getByText('payment_100047')).toBeVisible()
  await profile.getByRole('link', { name: 'Открыть заметки' }).click()
  await expect(profile.getByRole('heading', { name: 'Заметки о клиенте' })).toBeVisible()
})

for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 800], [1024, 768], [390, 844]]) {
  test('каталог, карточка и таблица на ширине ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height })
    const catalog = page.getByRole('region', { name: 'Клиентская база' })
    const profile = page.getByRole('region', { name: 'Карточка выбранного клиента' })
    await page.goto('/customers?sort=name')
    await expect(catalog).toBeVisible()
    await expect(catalog.getByLabel('Клиентов: 12')).toBeVisible()
    await catalog.getByRole('link', { name: /Анна Петрова/ }).click()
    await expect(profile.getByRole('heading', { name: 'Анна Петрова' })).toBeVisible()
    await expect(profile.getByRole('link', { name: 'Интернет недоступен после оплаты' })).toBeVisible()
    await expect(profile.getByRole('region', { name: 'Тариф и услуги' })).toBeVisible()
    if (width <= 780) await expect(catalog).toBeHidden()
    else await expect(catalog.getByRole('link', { name: /Анна Петрова/ })).toHaveAttribute('aria-current', 'page')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    if (screenshots) {
      await mkdir(screenshots, { recursive: true })
      await page.mouse.move(0, 0)
      await page.screenshot({ path: screenshots + '/customer-' + width + '.png', fullPage: true })
    }

    await profile.getByRole('link', { name: 'Клиенты', exact: true }).click()
    await expect(catalog).toBeVisible()
    await page.getByRole('link', { name: 'Таблица', exact: true }).click()
    await expect(page.getByRole('table', { name: 'Клиенты' })).toBeVisible()
    await expect(page).toHaveURL(/sort=name&view=table/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    if (width <= 780) {
      const scroll = page.getByRole('region', { name: 'Таблица клиентской базы' })
      expect(await scroll.evaluate(element => element.scrollWidth)).toBeGreaterThan(width)
      await scroll.evaluate(element => { element.scrollLeft = 200 })
      expect(await scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
      await scroll.evaluate(element => { element.scrollLeft = 0 })
    }
    if (screenshots) await page.screenshot({ path: screenshots + '/catalog-table-' + width + '.png', fullPage: true })
    await page.getByRole('link', { name: 'Карточки', exact: true }).click()
    await expect(catalog.getByRole('combobox', { name: 'Сортировка клиентов' })).toHaveValue('name:asc')
    if (screenshots && width <= 780) await page.screenshot({ path: screenshots + '/catalog-' + width + '.png', fullPage: true })
  })
}
