import { mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const voiceToken = process.env.IRIS_E2E_VOICE_TOKEN
const screenshots = process.env.IRIS_E2E_VOICE_SCREENSHOTS

test.skip(!voiceToken, 'Requires a fresh demo SQLite with Contact Center and a local test Voice token')

async function capture(page: Page, name: string) {
  if (!screenshots) return
  await mkdir(screenshots, { recursive: true })
  for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 800]]) {
    await page.setViewportSize({ width, height })
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: screenshots + '/' + name + '-' + width + '.png', fullPage: true })
  }
}

async function voice(request: APIRequestContext, path: string, data?: object) {
  const response = await request.post('/api/v1/voice' + path, {
    data, headers: { Authorization: 'Bearer ' + voiceToken },
  })
  expect(response.ok(), path + ' returned ' + response.status() + '\n' + await response.text()).toBeTruthy()
  return response.json()
}

test('operator receives an SSE offer and controls the live call while reading history', async ({ page, context, browser }) => {
  test.setTimeout(120000)
  const managerContext = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  try {
    const login = await context.request.post('/api/v1/auth/login', { data: { username: 'operator', password: 'iris-operator' } })
    expect(login.ok()).toBeTruthy()
    const managerLogin = await managerContext.request.post('/api/v1/auth/login', { data: { username: 'manager', password: 'iris-manager' } })
    expect(managerLogin.ok()).toBeTruthy()
    const manager = await managerContext.newPage()
    await manager.goto('/manager/contact-center')
    await page.goto('/workspace')
    await expect(page.getByRole('banner').getByText('В реальном времени')).toBeVisible()
    await expect(manager.getByRole('banner').getByText('В реальном времени')).toBeVisible()
    const banner = page.getByRole('region', { name: 'Текущий звонок' })
    const activeCalls = manager.getByRole('region', { name: 'Активные звонки' })
    const createCall = async (account: string, apartment: string) => {
      const call = await voice(context.request, '/calls', { provider_call_id: 'iris-browser-qa-' + randomUUID() }) as { id: string }
      const path = '/calls/' + call.id
      await voice(context.request, path + '/connected')
      expect(await voice(context.request, path + '/identify', { account_id: account, apartment })).toEqual({ identified: true })
      const message = await voice(context.request, path + '/messages', { event_id: 'consent', speaker: 'customer', text: 'Да, передайте звонок в поддержку.' })
      await voice(context.request, path + '/summary', { event_id: 'summary', summary: 'Учебный звонок. Восстановить связь после оплаты.' })
      await voice(context.request, path + '/handoff', { event_id: 'handoff', department: 'technical_support', priority: 'high' })
      return { path, messageId: message.id as string }
    }
    const connectCall = async (path: string) => {
      await expect(banner.getByText('Входящий звонок')).toBeVisible()
      const accepted = page.waitForResponse(response => response.url().includes('/api/v1/operator/assignments/') && response.url().endsWith('/accept'))
      await banner.getByRole('button', { name: 'Принять звонок' }).click()
      expect((await accepted).ok()).toBeTruthy()
      await expect(banner.getByText('Ожидаем подтверждение Voice')).toBeVisible()
      const assignment = await context.request.get('/api/v1/voice' + path + '/assignment', {
        headers: { Authorization: 'Bearer ' + voiceToken },
      })
      expect(assignment.ok()).toBeTruthy()
      const { id } = await assignment.json() as { id: string }
      await voice(context.request, path + '/assignments/' + id + '/connected')
      await expect(banner.getByText('Активный разговор')).toBeVisible()
    }
    const { path: first, messageId } = await createCall('100045', '8')
    await connectCall(first)
    await voice(context.request, first + '/ticket', {
      handoff: {
        ticket_id: 'T-QA-' + randomUUID(), customer_request: 'Восстановить связь',
        summary: 'Учебный звонок. Восстановить связь после оплаты.', customer_report: 'Связь пропала после оплаты.',
        verified_facts: [], open_question: 'Когда появится связь?', secondary_questions: [], confirmed_at: new Date().toISOString(),
      },
      confirmation_message_id: messageId, department: 'technical_support', account_number: '100045',
    })
    await voice(context.request, first + '/finish', { status: 'completed', outcome: 'ticket_created' })
    await banner.getByRole('button', { name: 'Завершить постобработку' }).click()
    await expect(page.getByRole('combobox', { name: 'Рабочий статус' })).toHaveValue('available')
    await page.locator('.desk-list').getByRole('button', { name: 'История', exact: true }).click()
    await page.locator('.desk-calls button').first().click()
    await expect(page).toHaveURL(new RegExp(first.split('/').at(-1) + '$'))
    await expect(page.getByRole('link', { name: 'Открыть обращение' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Открыть профиль клиента' })).toBeVisible()
    await capture(page, 'operator-workspace-history')
    await page.getByRole('link', { name: 'Открыть обращение' }).click()
    await expect(page.getByRole('heading', { name: 'Содержание обращения' })).toBeVisible()
    await capture(page, 'operator-ticket')
    await page.goBack()
    await page.getByRole('link', { name: 'Открыть профиль клиента' }).click()
    await expect(page.getByRole('heading', { name: 'Контактные данные' })).toBeVisible()
    await capture(page, 'operator-customer')
    await page.goBack()

    const { path: second } = await createCall('100042', '42')
    await expect(activeCalls.getByText('Анна Петрова', { exact: true })).toBeVisible()
    await expect(banner.getByText('Входящий звонок')).toBeVisible()
    await capture(page, 'operator-workspace-offer')
    await connectCall(second)
    await expect(page).toHaveURL(new RegExp(first.split('/').at(-1) + '$'))
    const hold = page.waitForResponse(response => response.url().endsWith('/control') && response.request().method() === 'POST')
    await banner.getByRole('button', { name: 'Удержание' }).click()
    const holdResponse = await hold
    expect(holdResponse.ok()).toBeTruthy()
    expect((await holdResponse.json()).kind).toBe('hold')
    await banner.getByRole('button', { name: 'Открыть текущий звонок' }).click()
    await expect(page).toHaveURL(new RegExp(second.split('/').at(-1) + '$'))
    await expect(page.getByRole('heading', { name: 'Сводка ИИ' })).toBeVisible()
    await capture(page, 'operator-workspace-connected')
    const connectedRow = activeCalls.getByRole('row').filter({ hasText: 'Анна Петрова' })
    await expect(connectedRow.getByText('Разговор с оператором')).toBeVisible()
    await expect(connectedRow.getByText('Александра Орлова')).toBeVisible()
    await capture(manager, 'contact-center-active')
    await voice(context.request, second + '/finish', { status: 'completed', outcome: 'unresolved' })
    await expect(banner.getByRole('button', { name: 'Завершить постобработку' })).toBeVisible()
    await banner.getByRole('button', { name: 'Завершить постобработку' }).click()
    await expect(page.getByRole('combobox', { name: 'Рабочий статус' })).toHaveValue('available')
    await page.getByRole('link', { name: 'Моя аналитика' }).click()
    await expect(page.getByRole('img', { name: 'Динамика принятых звонков и решённых обращений' })).toBeVisible()
    await capture(page, 'operator-analytics-populated')
  } finally {
    await managerContext.close()
  }
})
