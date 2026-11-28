import { mkdir } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

const managerScreens = [
  ['manager-home', '/manager', 'Главная', '/api/v1/dashboard'],
  ['contact-center', '/manager/contact-center', 'Контакт-центр', '/api/v1/manager/contact-center'],
  ['live-calls', '/live', 'Активные звонки', '/api/v1/calls'],
  ['queues', '/queues', 'Очередь обращений', '/api/v1/tickets'],
  ['tickets', '/tickets', 'Обращения', '/api/v1/tickets'],
  ['ticket-drawer', '/tickets/T-1042', 'Интернет недоступен после оплаты', '/api/v1/tickets/T-1042'],
  ['customers', '/customers', 'Клиенты', '/api/v1/customers'],
  ['customer-profile', '/customers/customer_100042', 'Анна Петрова', '/api/v1/customers/customer_100042'],
  ['customer-notes', '/customers/customer_100042?tab=notes', 'Заметки о клиенте', '/api/v1/customers/customer_100042/notes'],
  ['call-history', '/calls', 'История звонков', '/api/v1/calls'],
  ['call-detail', '/calls/call_1042', 'Карточка звонка', '/api/v1/calls/call_1042'],
  ['analytics', '/analytics', 'Аналитика', '/api/v1/manager/analytics'],
  ['team', '/employees', 'Команда', '/api/v1/employees'],
  ['departments', '/departments', 'Команда', '/api/v1/analytics'],
  ['network-incidents', '/incidents', 'Сетевые инциденты', '/api/v1/incidents'],
] as const

const operatorScreens = [
  ['operator-home', '/operator', 'Главная', '/api/v1/operator/workspace'],
  ['operator-workspace', '/workspace', 'Рабочее место', '/api/v1/operator/workspace'],
  ['operator-analytics', '/operator/analytics', 'Моя аналитика', '/api/v1/operator/analytics'],
] as const

const sharedScreens = [
  ['settings', '/settings', 'Настройки', '/api/v1/auth/preferences'],
  ['profile', '/profile', 'Мой профиль', '/api/v1/auth/me'],
] as const

const activeSections: Partial<Record<string, string>> = {
  'live-calls': 'Контакт-центр', 'call-history': 'Контакт-центр', 'call-detail': 'Контакт-центр',
  'queues': 'Обращения', 'departments': 'Команда', 'network-incidents': 'Главная',
}

const screenshots = process.env.IRIS_E2E_SCREENSHOTS || 'test-results/screenshots'

function waitForApi(page: Page, path: string) {
  return page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === 'GET')
}

async function capture(page: Page, width: number, name: string) {
  await page.evaluate(() => document.fonts.ready)
  expect(await page.evaluate(() => window.visualViewport?.scale), name + ' browser zoom').toBe(1)
  await expect(page.locator('[data-state="loading"]')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth), name + ' page width').toBeLessThanOrEqual(width)
  await page.screenshot({ path: screenshots + '/' + name + '-' + width + '.png', fullPage: true, animations: 'disabled' })
  if (['manager-home', 'operator-workspace-history', 'ticket-drawer'].includes(name)) {
    const { height } = page.viewportSize()!
    await page.screenshot({ path: screenshots + '/' + name + '-' + width + 'x' + height + '.png' })
  }
}

for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 800], [1024, 768]]) {
  for (const role of ['manager', 'operator'] as const) {
    test(role + ' real API and viewport ' + width + '×' + height, async ({ page, context }) => {
      test.setTimeout(120000)
      await page.setViewportSize({ width, height })
      await mkdir(screenshots, { recursive: true })
      if (role === 'manager') {
        const session = waitForApi(page, '/api/v1/auth/me')
        await page.goto('/login')
        expect((await session).status()).toBe(401)
        await expect(page.getByRole('heading', { name: 'Вход в IRIS' })).toBeVisible()
        await capture(page, width, 'login')
      }
      const login = await context.request.post('/api/v1/auth/login', { data: { username: role, password: 'iris-' + role } })
      expect(login.ok()).toBeTruthy()
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
      page.on('response', response => {
        if (response.status() >= 400 && new URL(response.url()).pathname.startsWith('/api/')) {
          errors.push(response.status() + ' ' + response.url())
        }
      })

      const screens = role === 'manager' ? managerScreens : operatorScreens
      for (const [name, path, heading, endpoint] of [...screens, ...sharedScreens]) {
        const request = waitForApi(page, endpoint)
        await page.goto(path)
        const response = await request
        expect(response.ok(), path + ' API').toBeTruthy()
        const pageHeading = page.getByRole('heading', { name: heading, exact: true }).first()
        await expect(pageHeading).toBeVisible()
        if (name === role + '-home' || name === 'operator-workspace') {
          const headingBox = (await pageHeading.boundingBox())!
          const headerBox = (await page.getByRole('banner').boundingBox())!
          expect(headingBox.y, 'heading top inside the header').toBeGreaterThanOrEqual(headerBox.y)
          expect(headingBox.y + headingBox.height, 'heading bottom inside the header').toBeLessThanOrEqual(headerBox.y + headerBox.height)
        }
        const skip = page.getByRole('link', { name: 'Перейти к содержанию' })
        await expect(skip).toBeAttached()
        if (name === role + '-home') {
          await page.keyboard.press('Tab')
          await expect(skip).toBeFocused()
          await page.keyboard.press('Enter')
          await expect(page.getByRole('main')).toBeFocused()
        }
        if (name === 'customers' || name === 'operator-workspace') {
          const layout = name === 'customers' ? '.crm-contact-list' : '.desk-grid'
          await expect(page.locator(layout)).toBeVisible()
        }
        const activeSection = activeSections[name]
        if (activeSection) {
          await expect(page.getByRole('navigation', { name: 'Разделы IRIS' }).getByRole('link', { name: activeSection }))
            .toHaveAttribute('aria-current', 'location')
        }
        if (name === 'profile' && role === 'operator') await expect(page.getByRole('heading', { name: 'Рабочий профиль' })).toBeVisible()
        const filename = name === 'settings' || name === 'profile' ? role + '-' + name : name
        await capture(page, width, filename)

        if (name === 'operator-workspace') {
          const workspace = await response.json() as { history: { id: string; customer_id: string | null }[] }
          await page.locator('.desk-list').getByRole('button', { name: 'История', exact: true }).click()
          if (!workspace.history.length) {
            await expect(page.getByText('История звонков пуста')).toBeVisible()
            continue
          }
          const call = workspace.history[0]
          const detail = waitForApi(page, '/api/v1/operator/calls/' + call.id)
          await page.locator('.desk-calls button').first().click()
          expect((await detail).ok()).toBeTruthy()
          await expect(page.getByRole('heading', { name: 'Сводка ИИ' })).toBeVisible()
          await capture(page, width, 'operator-workspace-history')
          const caseLink = page.getByRole('link', { name: 'Открыть обращение', exact: true }).first()
          if (await caseLink.count()) {
            const href = await caseLink.getAttribute('href')
            const ticket = waitForApi(page, '/api/v1' + href)
            await caseLink.click()
            expect((await ticket).ok()).toBeTruthy()
            await expect(page.getByRole('heading', { name: 'Содержание обращения' })).toBeVisible()
            await capture(page, width, 'operator-ticket')
          }
          if (call.customer_id) {
            const customer = waitForApi(page, '/api/v1/operator/customers/' + call.customer_id)
            await page.goto('/operator/customers/' + call.customer_id)
            expect((await customer).ok()).toBeTruthy()
            await expect(page.getByRole('heading', { name: 'Контактные данные' })).toBeVisible()
            await capture(page, width, 'operator-customer')
          }
        }
      }
      expect(errors).toEqual([])
    })
  }
}
