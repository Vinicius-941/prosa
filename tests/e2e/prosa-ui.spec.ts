import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const accessibilityTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function expectNoA11yViolations(page: import('@playwright/test').Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(accessibilityTags).analyze()
  const summary = result.violations.map(item => `${item.impact}: ${item.id} — ${item.help} (${item.nodes.length} elementos)`).join('\n')
  expect(result.violations, `${label}\n${summary}`).toEqual([])
}

test('fluxos principais, navegação móvel, teclado, contraste e acessibilidade', async ({ page, context }, testInfo) => {
  const widthSamples = [320, 360, 390, 700, 768, 1024, 1440]
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  const username = `qa_${stamp}`
  const displayName = `QA Prosa ${stamp}`

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Seu espaço começa aqui.' })).toBeVisible()
  await expectNoA11yViolations(page, 'Cadastro móvel')

  await page.getByLabel('Como podemos te chamar?').fill(displayName)
  await page.getByLabel('Nome de usuário').fill(username)
  await page.getByLabel('Senha').fill('SenhaSegura!2026QA')
  await page.getByRole('button', { name: 'Criar conta' }).click()
  await expect(page.getByRole('button', { name: 'Abrir conversas e navegação' })).toBeVisible()
  await expect(page.getByRole('main')).toBeVisible()

  const addContact = page.locator('.rail').getByRole('button', { name: 'Adicionar contato' })
  await addContact.click()
  const contactDialog = page.getByRole('dialog', { name: 'Encontre pessoas' })
  await expect(contactDialog).toBeVisible()
  await expect(contactDialog.getByPlaceholder('Digite pelo menos 2 caracteres')).toBeFocused()
  await expectNoA11yViolations(page, 'Diálogo de contatos')
  await page.keyboard.press('Escape')
  await expect(contactDialog).toBeHidden()

  await page.getByRole('button', { name: 'Comunidades', exact: true }).click()
  await page.getByLabel('Nome da comunidade').fill(`Comunidade ${stamp}`)
  await page.getByRole('button', { name: 'Criar', exact: true }).click()
  const channelName = `qa-${stamp.slice(-8)}`
  await page.getByLabel(/Nome do canal/).fill(channelName)
  await page.getByRole('button', { name: 'Criar canal' }).click()
  await expect(page.getByRole('button', { name: new RegExp(`# ${channelName}`) })).toBeVisible()
  await expectNoA11yViolations(page, 'Painel de comunidades móvel')

  await page.locator('.rail').getByRole('button', { name: 'Mensagens' }).click()
  const mobileNavigation = page.getByRole('dialog', { name: 'Navegação' })
  await expect(mobileNavigation).toBeVisible()
  await expect(mobileNavigation.getByRole('combobox', { name: 'Selecionar comunidade' })).toBeVisible()
  await expectNoA11yViolations(page, 'Navegação móvel aberta')
  await expect(page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).resolves.toBe(true)
  await page.keyboard.press('Shift+Tab')
  await expect(page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).resolves.toBe(true)
  await page.keyboard.press('Escape')
  await expect(mobileNavigation).toBeHidden()

  await page.locator('.rail').getByRole('button', { name: 'Mensagens' }).click()
  await mobileNavigation.getByRole('button', { name: new RegExp(`# ${channelName}`) }).click()
  await expect(page.getByRole('heading', { name: channelName })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Escrever mensagem' })).toBeVisible()
  const testMessage = `Mensagem de QA ${stamp}`
  await page.getByRole('textbox', { name: 'Escrever mensagem' }).fill(testMessage)
  await page.getByRole('button', { name: 'Enviar mensagem' }).click()
  await expect(page.getByRole('article').getByText(testMessage, { exact: true })).toBeVisible()
  await expect(page.getByText('Conectado · mensagens sincronizadas em tempo real')).toBeVisible()
  await expectNoA11yViolations(page, 'Conversa com mensagem móvel')

  await page.getByRole('button', { name: 'Abrir conversas e navegação' }).click()
  const choices = mobileNavigation.locator('.mobile-chat-list .conversation')
  expect(await choices.count()).toBeGreaterThanOrEqual(2)
  await choices.first().click()
  await expect(mobileNavigation).toBeHidden()

  for (const width of widthSamples) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 })
    const metrics = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(metrics.content, `scroll horizontal em ${width}px: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(metrics.viewport + 1)
    await page.screenshot({ path: testInfo.outputPath(`viewport-${width}.png`), fullPage: true })
  }

  await page.setViewportSize({ width: 1024, height: 900 })
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
  await expect(page.getByPlaceholder('Buscar conversas e mensagens')).toBeFocused()
  await page.getByPlaceholder('Buscar conversas e mensagens').fill('temporário')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
  await expect(page.getByPlaceholder('Buscar conversas e mensagens')).toHaveValue('temporário')

  await page.locator('.rail').getByRole('button', { name: /Abrir opções da conta/ }).click()
  await expect(page.getByRole('button', { name: 'Sair da conta' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Sair da conta' })).toBeHidden()

  await context.setOffline(true)
  await expect(page.getByText('Sem conexão · verifique a rede para enviar e receber mensagens')).toBeVisible()
  await context.setOffline(false)
  await expect(page.getByText('Conectado · mensagens sincronizadas em tempo real')).toBeVisible({ timeout: 15_000 })

  await expectNoA11yViolations(page, 'Interface autenticada desktop')
})
