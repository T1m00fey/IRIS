import { mkdir } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Ticket } from '../src/types/operations'

const screenshots = process.env.IRIS_TICKETS_SCREENSHOTS

test.beforeEach(async ({ context }) => {
  const login = await context.request.post('/api/v1/auth/login', { data: { username: 'manager', password: 'iris-manager' } })
  expect(login.ok()).toBeTruthy()
})

test('searches by number, topic and customer and opens the linked ticket context', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/tickets')
  const table = page.getByRole('region', { name: 'Таблица обращений' })
  const search = page.getByRole('searchbox', { name: 'Поиск' })
  const target = table.getByRole('link', { name: 'Интернет недоступен после оплаты' })
  for (const term of ['T-1042', 'после оплаты', 'Петрова Анна']) {
    await search.fill(term)
    await expect(target).toBeVisible()
    await expect(table.getByRole('row')).toHaveCount(2)
  }
  await page.getByRole('button', { name: 'В очереди' }).click()
  await expect(page.getByRole('combobox', { name: 'Статус' })).toHaveValue('queued')
  await expect(target).toBeVisible()
  await page.getByRole('combobox', { name: 'Ответственный' }).selectOption({ label: 'Без назначения' })
  await expect(target).toBeVisible()
  await page.getByRole('button', { name: 'Дополнительные фильтры' }).click()
  await page.getByRole('textbox', { name: 'Лицевой счёт' }).fill('100042')
  await expect(target).toBeVisible()
  await page.getByRole('combobox', { name: 'Сортировка' }).selectOption('queue')
  const filtered = new URL(page.url()).search
  await target.click()
  const drawer = page.getByRole('complementary', { name: 'Интернет недоступен после оплаты' })
  await expect(drawer.getByRole('heading', { name: 'Сводка ИИ' })).toBeVisible()
  await expect(drawer.getByRole('heading', { name: 'Проверенные факты' })).toBeVisible()
  await expect(drawer.getByRole('heading', { name: 'Открытые вопросы' })).toBeVisible()
  await expect(drawer.getByRole('heading', { name: 'История обработки' })).toBeVisible()
  await expect(drawer.getByRole('link', { name: /Открыть звонок/ })).toHaveAttribute('href', '/calls/call_1042')
  await expect(target).toHaveAttribute('aria-current', 'page')
  await expect(drawer.getByRole('button', { name: 'Добавить заметку о клиенте' })).toBeVisible()
  const narrow = (await table.boundingBox())!.width
  await expect(drawer.getByRole('link', { name: 'Закрыть карточку обращения' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  expect(new URL(page.url()).search).toBe(filtered)
  await expect(target).toBeFocused()
  expect((await table.boundingBox())!.width).toBeGreaterThan(narrow)
})

test('filters across API pages before paginating the results', async ({ page }) => {
  const items: Ticket[] = Array.from({ length: 115 }, (_, index) => ({
    id: 'QA-' + (index + 1), call_id: null, account_number: null, customer_id: null,
    customer_name: 'Учебный клиент', title: 'Проверка обращения ' + (index + 1), summary: null,
    created_at: '2026-11-27T10:00:00Z', started_at: null, closed_at: null, waiting_seconds: 60,
    department: 'technical_support', priority: 'normal', status: 'queued',
    assigned_employee_name: index >= 100 ? 'Дежурный сотрудник' : null,
  }))
  await page.route(url => url.pathname === '/api/v1/tickets', async route => {
    const params = new URL(route.request().url()).searchParams
    const offset = Number(params.get('offset'))
    const limit = Number(params.get('limit'))
    const status = params.get('status')
    const matching = status && status !== 'queued' ? [] : items
    await route.fulfill({ json: { items: matching.slice(offset, offset + limit), total: matching.length, offset, limit } })
  })
  await page.route('**/api/v1/employees', route => route.fulfill({ json: [{ full_name: 'Дежурный сотрудник' }] }))
  await page.goto('/tickets')
  const table = page.getByRole('table')
  const next = page.getByRole('button', { name: 'Следующая страница' })
  await expect(table.getByRole('cell', { name: 'QA-1', exact: true })).toBeVisible()
  await next.click()
  await expect(table.getByRole('cell', { name: 'QA-13', exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Ответственный' }).selectOption('Дежурный сотрудник')
  await expect(table.getByRole('cell', { name: 'QA-101', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Все обращения 15' })).toBeVisible()
  await next.click()
  await expect(table.getByRole('cell', { name: 'QA-113', exact: true })).toBeVisible()
  await expect(next).toBeDisabled()
  await page.getByRole('searchbox', { name: 'Поиск' }).fill('QA-115')
  await expect(table.getByRole('row')).toHaveCount(2)
  await expect(table.getByRole('cell', { name: 'QA-115', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Все обращения 1' })).toBeVisible()
})

for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 800], [1024, 768], [390, 844]]) {
  test('fits the ticket list and drawer at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto('/tickets')
    const table = page.getByRole('region', { name: 'Таблица обращений' })
    await expect(table.getByRole('link', { name: 'Интернет недоступен после оплаты' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Все обращения \d/ })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    if (screenshots) {
      await mkdir(screenshots, { recursive: true })
      await page.screenshot({ path: screenshots + '/tickets-' + width + '.png', fullPage: true })
    }
    await table.getByRole('link', { name: 'Интернет недоступен после оплаты' }).click()
    const drawer = page.getByRole('complementary', { name: 'Интернет недоступен после оплаты' })
    await expect(drawer.getByRole('heading', { name: 'Сводка ИИ' })).toBeVisible()
    await expect(drawer.getByRole('button', { name: 'Добавить заметку о клиенте' })).toBeVisible()
    if (width > 800) await expect(table).toBeVisible()
    else await expect(table).toBeHidden()
    if (width >= 1440) expect(await table.evaluate(element => element.scrollWidth)).toBeLessThanOrEqual((await table.boundingBox())!.width + 1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    if (screenshots) {
      await page.mouse.move(0, 0)
      await page.screenshot({ path: screenshots + '/ticket-drawer-' + width + '.png', fullPage: true })
    }
  })
}

test('saves a CRM customer note from the ticket and reloads it', async ({ page }) => {
  test.skip(process.env.IRIS_E2E_WRITE !== '1', 'Use a fresh demo SQLite database for mutations')
  await page.goto('/tickets/T-1042')
  const drawer = page.getByRole('complementary', { name: 'Интернет недоступен после оплаты' })
  const text = 'Уточнить срок восстановления · ' + Date.now()
  await drawer.getByRole('button', { name: 'Добавить заметку о клиенте' }).click()
  await drawer.getByRole('textbox', { name: 'Новая заметка о клиенте' }).fill(text)
  await drawer.getByRole('button', { name: 'Сохранить заметку' }).click()
  await expect(drawer.getByText('Заметка о клиенте сохранена')).toBeVisible()
  await page.reload()
  await expect(drawer.getByText(text, { exact: true })).toBeVisible()
  await drawer.getByRole('link', { name: 'Анна Петрова' }).click()
  await page.getByRole('link', { name: 'Заметки', exact: true }).click()
  await expect(page.getByText(text, { exact: true })).toBeVisible()
})
