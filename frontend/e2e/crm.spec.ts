import { expect, test } from '@playwright/test'

test.beforeEach(async ({ context }) => {
  const login = await context.request.post('/api/v1/auth/login', { data: { username: 'manager', password: 'iris-manager' } })
  expect(login.ok()).toBeTruthy()
})

test('поиск по клиенту, телефону и счёту, фильтр и сортировка', async ({ page }) => {
  await page.goto('/customers?view=table')
  const table = page.getByRole('table', { name: 'Клиенты' })
  const search = page.getByRole('searchbox', { name: 'Поиск клиентов' })
  await expect(table).toBeVisible()

  for (const query of ['Петрова Анна', '8 (000) 000-00-42', '100042']) {
    const response = page.waitForResponse((result) => {
      const url = new URL(result.url())
      return url.pathname === '/api/v1/customers' && url.searchParams.get('q') === query
    })
    await search.fill(query)
    expect((await response).ok()).toBeTruthy()
    await expect(table.getByRole('link', { name: 'Анна Петрова', exact: true })).toBeVisible()
    await expect(table.getByRole('row')).toHaveCount(2)
  }

  await page.getByRole('combobox', { name: 'Статус клиента' }).selectOption('suspended')
  await expect(page.getByText('Клиенты не найдены')).toBeVisible()
  await page.getByRole('button', { name: 'Сбросить' }).click()
  await expect(search).toHaveValue('')
  await expect(table.getByRole('link', { name: 'Анна Петрова', exact: true })).toBeVisible()

  const balance = table.getByRole('columnheader', { name: 'Баланс' })
  await balance.getByRole('button').click()
  await expect(balance).toHaveAttribute('aria-sort', /ascending|descending/)
  await expect(page).toHaveURL(/sort=balance/)
  const direction = await balance.getAttribute('aria-sort')
  await balance.getByRole('button').click()
  await expect(balance).toHaveAttribute('aria-sort', direction === 'ascending' ? 'descending' : 'ascending')
})

test('пагинация загружает следующую страницу и возвращает исходную', async ({ page }) => {
  await page.goto('/customers?view=table')
  const table = page.getByRole('table', { name: 'Клиенты' })
  const next = page.getByRole('button', { name: 'Следующая страница' })
  const previous = page.getByRole('button', { name: 'Предыдущая страница' })
  await expect(table.getByRole('row')).toHaveCount(11)
  const firstCustomer = table.getByRole('row').nth(1).getByRole('link').first()
  const customerUrl = await firstCustomer.getAttribute('href')
  expect(customerUrl).toBeTruthy()

  await next.click()
  await expect(page).toHaveURL(/offset=10/)
  await expect(next).toBeDisabled()
  await expect(firstCustomer).not.toHaveAttribute('href', customerUrl!)

  await previous.click()
  await expect(firstCustomer).toHaveAttribute('href', customerUrl!)
  await expect(previous).toBeDisabled()
})

test('карточка меняет подключение, платежи и историю при выборе счёта', async ({ page }) => {
  await page.goto('/customers?q=100047')
  await page.getByRole('region', { name: 'Клиентская база' }).getByRole('link', { name: /Мария Смирнова/ }).click()
  await expect(page.getByRole('heading', { name: 'Мария Смирнова' })).toBeVisible()

  const account = page.getByRole('combobox', { name: 'Активный лицевой счёт' })
  await expect(account).toHaveValue('100046')
  await account.selectOption('100047')
  await expect(page.getByText('Потери пакетов на узле доступа')).toBeVisible()

  const tabs = page.getByRole('navigation', { name: 'Разделы карточки клиента' })
  await tabs.getByRole('link', { name: 'Платежи' }).click()
  await expect(page.getByRole('table').getByText('payment_100047')).toBeVisible()
  await account.selectOption('100046')
  await expect(page.getByRole('table').getByText('payment_100046')).toBeVisible()
  await expect(page.getByText('payment_100047')).toHaveCount(0)

  for (const section of ['calls', 'tickets'] as const) {
    const response = page.waitForResponse((result) => {
      const url = new URL(result.url())
      return url.pathname === '/api/v1/' + section && url.searchParams.get('customer_id') === 'customer_100046'
        && url.searchParams.get('account_number') === '100046'
    })
    await tabs.getByRole('link', { name: section === 'calls' ? 'История звонков' : 'Обращения' }).click()
    expect((await response).ok()).toBeTruthy()
  }

  await page.locator('main').getByRole('link', { name: 'Клиенты', exact: true }).click()
  await expect(page.getByRole('searchbox', { name: 'Поиск клиентов' })).toHaveValue('100047')
})

test('обращение открывается в боковой панели и сохраняет фильтр', async ({ page }) => {
  await page.goto('/tickets?department=technical_support')
  const table = page.getByRole('region', { name: 'Таблица обращений' })
  const ticket = table.getByRole('link').first()
  await expect(ticket).toBeVisible()
  const href = await ticket.getAttribute('href')
  await ticket.click()
  const drawer = page.getByRole('complementary').filter({ has: page.getByRole('heading', { name: 'Содержание обращения' }) })
  await expect(drawer.getByRole('heading', { name: 'История обработки' })).toBeVisible()
  await expect(table).toBeVisible()
  expect(new URL(page.url()).pathname).toBe(href?.split('?')[0])
  await drawer.getByRole('link', { name: 'Закрыть карточку обращения' }).click()
  await expect(page).toHaveURL(/\/tickets\?department=technical_support$/)
})
