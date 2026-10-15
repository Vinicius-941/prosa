import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const accessibilityTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function expectNoA11yViolations(page: import('@playwright/test').Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(accessibilityTags).analyze()
  const summary = result.violations.map(item => `${item.impact}: ${item.id} — ${item.help} (${item.nodes.length} elementos)`).join('\n')
  expect(result.violations, `${label}\n${summary}`).toEqual([])
}

test('fluxos principais, navegação móvel, papéis comunitários, teclado, contraste e acessibilidade', async ({ page, context, request }, testInfo) => {
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
  const registrationResponsePromise = page.waitForResponse(response => response.url().endsWith('/api/auth/register'))
  await page.getByRole('button', { name: 'Criar conta' }).click()
  const registrationResponse = await registrationResponsePromise
  const apiBase = new URL('/api', registrationResponse.url()).href
  expect((await registrationResponse.json()).token).toBeUndefined()
  await expect(page.evaluate(() => localStorage.getItem('prosa.session'))).resolves.toBeNull()
  const sessionCookies = await context.cookies(registrationResponse.url())
  expect(sessionCookies.find(cookie => cookie.name === 'prosa_session')?.httpOnly).toBe(true)
  expect(sessionCookies.find(cookie => cookie.name === 'prosa_csrf')?.httpOnly).toBe(true)
  const csrfRejectedStatus = await page.evaluate(async apiUrl => (await fetch(apiUrl, {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-prosa-client': 'web' },
    body: JSON.stringify({ username: 'csrf_probe', displayName: 'Teste', password: 'SenhaSegura!2026QA' }),
  })).status, new URL('/api/auth/register', registrationResponse.url()).href)
  expect(csrfRejectedStatus).toBe(403)
  const priorSessionToken = sessionCookies.find(cookie => cookie.name === 'prosa_session')!.value
  await context.clearCookies({ name: 'prosa_session' })
  await page.evaluate(token => localStorage.setItem('prosa.session', token), priorSessionToken)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Abrir conversas e navegação' })).toBeVisible()
  await expect(page.getByRole('main')).toBeVisible()
  await expect(page.evaluate(() => localStorage.getItem('prosa.session'))).resolves.toBeNull()
  expect((await context.cookies(registrationResponse.url())).find(cookie => cookie.name === 'prosa_session')?.httpOnly).toBe(true)
  await expect(page.getByRole('heading', { name: 'Seu espaço ainda está vazio' })).toBeVisible()
  await expectNoA11yViolations(page, 'Conversa pessoal vazia')
  await page.screenshot({ path: testInfo.outputPath('empty-conversations.png'), fullPage: true })

  await page.locator('.rail').getByRole('button', { name: /Abrir opções da conta/ }).click()
  await page.getByRole('button', { name: 'Editar perfil' }).click()
  const profileDialog = page.getByRole('dialog', { name: 'Editar perfil' })
  await expect(profileDialog).toBeVisible()
  await expectNoA11yViolations(page, 'Edição de perfil')
  await profileDialog.getByLabel('Descrição curta').fill('Conversa de QA.')
  await profileDialog.getByLabel('Cor do avatar').selectOption('blue')
  await profileDialog.getByLabel('Moldura').selectOption('ring')
  await expect(page.locator('.profile-preview .avatar')).toHaveText('QP')
  await profileDialog.getByRole('button', { name: 'Salvar perfil' }).click()
  await expect(profileDialog).toBeHidden()
  await expect(page.locator('.profile-orb')).toHaveClass(/blue/)

  await page.locator('.rail').getByRole('button', { name: /Abrir opções da conta/ }).click()
  await page.getByRole('button', { name: 'Configurações' }).click()
  await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible()
  await expectNoA11yViolations(page, 'Configurações no navegador')
  await expect(page.getByText('Navegador', { exact: true })).toBeVisible()
  await expect(page.getByText('Iniciar o Prosa com o sistema')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('settings-browser.png'), fullPage: true })
  await page.getByLabel('Reduzir animações').check()
  await expect(page.locator('html')).toHaveClass(/user-reduced-motion/)
  await page.getByLabel('Reduzir animações').uncheck()
  const closeNotice = page.getByRole('button', { name: 'Fechar aviso' })
  if (await closeNotice.isVisible()) await closeNotice.click()

  const addContact = page.locator('.rail').getByRole('button', { name: 'Adicionar contato' })
  await addContact.click()
  const contactDialog = page.getByRole('dialog', { name: 'Encontre pessoas' })
  await expect(contactDialog).toBeVisible()
  await expect(contactDialog.getByPlaceholder('Digite pelo menos 2 caracteres')).toBeFocused()
  await expectNoA11yViolations(page, 'Diálogo de contatos')
  await page.keyboard.press('Escape')
  await expect(contactDialog).toBeHidden()

  await page.getByRole('button', { name: 'Comunidades', exact: true }).click()
  await expectNoA11yViolations(page, 'Lista de comunidades vazia')
  await page.screenshot({ path: testInfo.outputPath('empty-communities.png'), fullPage: true })
  await page.getByRole('button', { name: 'Entrar com convite' }).click()
  const joinDialog = page.getByRole('dialog', { name: 'Entrar com convite' })
  await joinDialog.getByLabel('Código de convite').fill('convite-inexistente')
  await joinDialog.getByRole('button', { name: 'Entrar na comunidade' }).click()
  await expect(joinDialog.getByRole('alert')).toBeVisible()
  await expect(joinDialog.getByLabel('Código de convite')).toHaveValue('convite-inexistente')
  await page.keyboard.press('Escape')
  await expect(joinDialog).toBeHidden()
  await page.getByRole('button', { name: 'Criar comunidade' }).click()
  const communityDialog = page.getByRole('dialog', { name: 'Criar comunidade' })
  await expect(communityDialog).toBeVisible()
  await expectNoA11yViolations(page, 'Criação de comunidade')
  await communityDialog.getByLabel('Nome da comunidade').fill(`Comunidade ${stamp}`)
  await communityDialog.getByRole('button', { name: 'Criar comunidade' }).click()
  await expect(communityDialog).toBeHidden()
  await expect(page.getByRole('heading', { name: 'geral', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Comece a conversar em geral' })).toBeVisible()
  await expectNoA11yViolations(page, 'Canal comunitário vazio')
  await page.locator('.rail').getByRole('button', { name: 'Comunidades' }).click()
  await page.locator('.community-card-heading').filter({ hasText: `Comunidade ${stamp}` }).click()
  await page.locator('.community-admin > summary').click()
  const channelName = `qa-${stamp.slice(-8)}`
  await page.getByLabel(/Nome do canal/).fill(channelName)
  await page.getByRole('button', { name: 'Criar canal' }).click()
  await expect(page.getByRole('button', { name: new RegExp(`# ${channelName}`) })).toBeVisible()
  await expectNoA11yViolations(page, 'Painel de comunidades móvel')

  await page.locator('.rail').getByRole('button', { name: 'Mensagens' }).click()
  const mobileNavigation = page.getByRole('dialog', { name: 'Navegação' })
  await expect(mobileNavigation).toBeVisible()
  await expect(mobileNavigation.getByRole('combobox', { name: 'Selecionar comunidade' })).toBeVisible()
  await expect(mobileNavigation.getByRole('button', { name: new RegExp(channelName) })).toHaveCount(1)
  await expectNoA11yViolations(page, 'Navegação móvel aberta')
  await expect(page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).resolves.toBe(true)
  await page.keyboard.press('Shift+Tab')
  await expect(page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).resolves.toBe(true)
  await page.keyboard.press('Escape')
  await expect(mobileNavigation).toBeHidden()

  await page.locator('.rail').getByRole('button', { name: 'Mensagens' }).click()
  await mobileNavigation.getByRole('button', { name: new RegExp(channelName) }).click()
  await expect(page.getByRole('heading', { name: channelName, exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Escrever mensagem' })).toBeVisible()
  const testMessage = `Mensagem de QA ${stamp}`
  await page.getByRole('textbox', { name: 'Escrever mensagem' }).fill(testMessage)
  await page.getByRole('button', { name: 'Enviar mensagem' }).click()
  await expect(page.getByRole('article').getByText(testMessage, { exact: true })).toBeVisible()
  await expect(page.locator('.message-avatar-slot .avatar').last()).toHaveClass(/blue.*frame-ring|frame-ring.*blue/)
  await expect(page.getByText('Conectado · mensagens sincronizadas em tempo real')).toBeVisible()
  await expectNoA11yViolations(page, 'Conversa com mensagem móvel')

  const communitiesResponse = await page.evaluate(async apiBase => fetch(`${apiBase}/communities`, {
    credentials: 'include', headers: { 'x-prosa-client': 'web' },
  }).then(response => response.json()), apiBase)
  const selectedChannel = communitiesResponse.communities[0].channels.find((channel: { name: string }) => channel.name === channelName)
  expect(selectedChannel).toBeTruthy()
  const csrf = (await context.cookies(registrationResponse.url())).find(cookie => cookie.name === 'prosa_csrf')?.value
  expect(csrf).toBeTruthy()
  const historyStatuses = await page.evaluate(async ({ apiBase, conversationId, csrf, stamp }) => {
    const statuses = []
    for (let index = 1; index <= 24; index++) {
      const response = await fetch(`${apiBase}/conversations/${conversationId}/messages`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-prosa-client': 'web', 'x-prosa-csrf': csrf },
        body: JSON.stringify({ text: `Histórico de rolagem ${stamp} ${index}` }),
      })
      statuses.push(response.status)
    }
    return statuses
  }, { apiBase, conversationId: selectedChannel.conversationId, csrf, stamp })
  expect(historyStatuses).toEqual(Array(24).fill(201))
  await expect(page.getByRole('article').getByText(`Histórico de rolagem ${stamp} 24`, { exact: true })).toBeVisible()
  const fullHistoryScroll = await page.locator('.message-scroll').evaluate(element => ({ height: element.scrollHeight, client: element.clientHeight }))
  expect(fullHistoryScroll.height).toBeGreaterThan(fullHistoryScroll.client)
  await page.locator('.message-scroll').evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')) })

  await page.getByRole('button', { name: 'Abrir conversas e navegação' }).click()
  const choices = mobileNavigation.locator('.mobile-chat-list .conversation')
  expect(await choices.count()).toBeGreaterThanOrEqual(2)
  await choices.first().click()
  await expect(mobileNavigation).toBeHidden()
  await page.getByRole('button', { name: 'Abrir conversas e navegação' }).click()
  await mobileNavigation.getByRole('button', { name: new RegExp(channelName) }).click()
  await expect(page.getByRole('heading', { name: channelName, exact: true })).toBeVisible()
  const restoredHistoryScroll = await page.locator('.message-scroll').evaluate(element => ({ top: element.scrollTop, height: element.scrollHeight, client: element.clientHeight }))
  expect(restoredHistoryScroll.top + restoredHistoryScroll.client).toBeGreaterThanOrEqual(restoredHistoryScroll.height - 2)

  for (const width of widthSamples) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 })
    const metrics = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(metrics.content, `scroll horizontal em ${width}px: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(metrics.viewport + 1)
    if (width === 320) await expect(page.locator('.message.mine .message-actions').first().getByRole('button', { name: 'Editar' })).toBeVisible()
    if (width === 768) {
      const channelContext = page.locator('.conversation-list .conversation-bottom > span').filter({ hasText: /· geral ·/ }).first()
      const contextLayout = await channelContext.evaluate(element => ({
        textOverflow: getComputedStyle(element).textOverflow,
        right: element.getBoundingClientRect().right,
        containerRight: element.closest('.conversation')!.getBoundingClientRect().right,
      }))
      expect(contextLayout.textOverflow).toBe('ellipsis')
      expect(contextLayout.right).toBeLessThanOrEqual(contextLayout.containerRight + 1)
      const messageLayouts = await page.locator('.message').evaluateAll(elements => elements.map((element, index) => {
        const controls = [...element.querySelectorAll('.message-actions, .message-social-controls')]
        const controlBottom = Math.max(...controls.flatMap(control => [...control.children].map(child => child.getBoundingClientRect().bottom)))
        const nextBubbleTop = elements[index + 1]?.querySelector('.message-body > p')?.getBoundingClientRect().top ?? Infinity
        return { visible: controls.some(control => getComputedStyle(control).opacity === '1'), controlBottom, nextBubbleTop }
      }))
      for (const layout of messageLayouts) if (layout.visible) {
        expect(layout.nextBubbleTop, `ações de mensagem sobrepõem a seguinte em 768 px: ${JSON.stringify(layout)}`).toBeGreaterThanOrEqual(layout.controlBottom - 1)
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`viewport-${width}.png`), fullPage: true })
  }

  const zoomSession = await context.newCDPSession(page)
  for (const zoom of [1, 1.25, 1.5]) {
    const cssWidth = Math.round(1440 / zoom)
    const cssHeight = Math.round(900 / zoom)
    await zoomSession.send('Emulation.setDeviceMetricsOverride', { width: cssWidth, height: cssHeight, deviceScaleFactor: zoom, mobile: false })
    const zoomMetrics = await page.evaluate(() => ({
      zoom: Math.round(devicePixelRatio * 100),
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }))
    const level = Math.round(zoom * 100)
    expect(zoomMetrics.zoom, `densidade ${level}%: ${JSON.stringify(zoomMetrics)}`).toBe(level)
    expect(zoomMetrics.viewport, `viewport CSS equivalente a ${level}%: ${JSON.stringify(zoomMetrics)}`).toBe(cssWidth)
    expect(zoomMetrics.content, `overflow horizontal em escala simulada ${level}%: ${JSON.stringify(zoomMetrics)}`).toBeLessThanOrEqual(zoomMetrics.viewport + 1)
    await page.screenshot({ path: testInfo.outputPath(`browser-scale-${level}.png`), fullPage: true, scale: 'device' })
  }
  await zoomSession.send('Emulation.clearDeviceMetricsOverride')
  await zoomSession.detach()

  const scaleBrowser = context.browser()
  const authenticatedState = await context.storageState()
  for (const scale of [1, 1.25, 1.5]) {
    const scaleContext = await scaleBrowser!.newContext({ viewport: { width: 1024, height: 900 }, deviceScaleFactor: scale, storageState: authenticatedState })
    const scalePage = await scaleContext.newPage()
    await scalePage.goto('/')
    await expect(scalePage.getByRole('main')).toBeVisible()
    const scaleMetrics = await scalePage.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
    expect(scaleMetrics.content, `overflow horizontal com deviceScaleFactor ${scale}: ${JSON.stringify(scaleMetrics)}`).toBeLessThanOrEqual(scaleMetrics.viewport + 1)
    if (scale === 1.5) {
      const contextItems = await scalePage.locator('.conversation-list .conversation-bottom > span').evaluateAll(elements => elements.map(element => ({
        textOverflow: getComputedStyle(element).textOverflow,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        right: element.getBoundingClientRect().right,
        itemRight: element.closest('.conversation')!.getBoundingClientRect().right,
      })))
      for (const item of contextItems) {
        expect(item.right, `contexto de Recentes saiu do item: ${JSON.stringify(item)}`).toBeLessThanOrEqual(item.itemRight + 1)
        if (item.scrollWidth > item.clientWidth) expect(item.textOverflow).toBe('ellipsis')
      }
    }
    await scalePage.screenshot({ path: testInfo.outputPath(`device-scale-${Math.round(scale * 100)}.png`), fullPage: true })
    await scaleContext.close()
  }

  await page.setViewportSize({ width: 1024, height: 900 })
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
  await expect(page.getByPlaceholder('Buscar conversas e mensagens')).toBeFocused()
  await page.getByPlaceholder('Buscar conversas e mensagens').fill('temporário')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
  await expect(page.getByPlaceholder('Buscar conversas e mensagens')).toHaveValue('temporário')

  await page.locator('.rail').getByRole('button', { name: 'Comunidades' }).click()
  let communityName = `Comunidade ${stamp}`
  const communityCard = page.locator('.community-card-heading').filter({ hasText: communityName })
  const inviteCode = await page.locator('.community-panel .invite-code-row code').textContent()
  expect(inviteCode).toBeTruthy()
  async function createFixtureMember(username: string, displayName: string) {
    const result = await request.post(`${apiBase}/auth/register`, { data: { username, displayName, password: 'SenhaSegura!2026QA' } })
    expect(result.status()).toBe(201)
    return (await result.json()).token as string
  }
  const adminUsername = `qa_admin_${stamp.slice(-8)}`
  const adminName = `QA Admin ${stamp.slice(-8)}`
  const memberUsername = `qa_member_${stamp.slice(-8)}`
  const memberName = `QA Pessoa ${stamp.slice(-8)}`
  const removalUsername = `qa_remove_${stamp.slice(-8)}`
  const removalName = `QA Remoção ${stamp.slice(-8)}`
  const adminToken = await createFixtureMember(adminUsername, adminName)
  const memberToken = await createFixtureMember(memberUsername, memberName)
  const removalToken = await createFixtureMember(removalUsername, removalName)
  for (const token of [adminToken, memberToken, removalToken]) {
    const joined = await request.post(`${apiBase}/communities/join`, { headers: { authorization: `Bearer ${token}` }, data: { inviteCode } })
    expect(joined.status()).toBe(200)
  }
  await communityCard.click()
  await page.locator('.community-admin > summary').click()
  const adminRow = page.locator('.community-panel .person-row').filter({ hasText: adminUsername })
  const memberRow = page.locator('.community-panel .person-row').filter({ hasText: memberUsername })
  await expect(adminRow.getByRole('button', { name: 'Promover admin' })).toBeVisible()
  await adminRow.getByRole('button', { name: 'Promover admin' }).click()
  await expect(adminRow).toContainText('administrador')
  await expect(adminRow.getByRole('button', { name: 'Remover admin' })).toBeVisible()
  await expect(memberRow.getByRole('button', { name: 'Remover' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Excluir comunidade e canais' })).toBeVisible()
  await expectNoA11yViolations(page, 'Administração de comunidade como responsável')

  const browser = page.context().browser()
  expect(browser).toBeTruthy()
  const adminContext = await browser!.newContext({ viewport: { width: 1024, height: 900 } })
  const adminPage = await adminContext.newPage()
  await adminPage.goto('/')
  await adminPage.getByRole('button', { name: 'Entrar', exact: true }).click()
  await adminPage.getByLabel('Nome de usuário').fill(adminUsername)
  await adminPage.getByLabel('Senha').fill('SenhaSegura!2026QA')
  await adminPage.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(adminPage.locator('.rail').getByRole('button', { name: 'Comunidades' })).toBeVisible()
  await adminPage.locator('.rail').getByRole('button', { name: 'Comunidades' }).click()
  const adminCommunity = adminPage.locator('.community-card-heading').filter({ hasText: communityName })
  await expect(adminCommunity).toBeVisible()
  await adminCommunity.click()
  const adminPanel = adminPage.locator('.community-panel')
  await adminPanel.locator('.community-admin > summary').click()
  await expect(adminPanel.getByRole('heading', { name: `Novo canal em ${communityName}` })).toBeVisible()
  await expect(adminPanel.getByRole('button', { name: 'Renovar' })).toBeVisible()
  await expect(adminPanel.getByRole('button', { name: 'Promover admin' })).toHaveCount(0)
  await expect(adminPanel.getByRole('button', { name: 'Remover admin' })).toHaveCount(0)
  await expectNoA11yViolations(adminPage, 'Painel de comunidade como administrador')
  const adminChannel = `moderacao-${stamp.slice(-8)}`
  await adminPanel.getByLabel(/Nome do canal/).fill(adminChannel)
  await adminPanel.getByRole('button', { name: 'Criar canal' }).click()
  await expect(adminPanel.getByRole('button', { name: new RegExp(`# ${adminChannel}`) })).toBeVisible()
  await adminCommunity.click()
  const removalRow = adminPanel.locator('.person-row').filter({ hasText: removalUsername })
  await expect(removalRow.getByRole('button', { name: 'Remover' })).toBeVisible()
  let adminRemovalConfirmation = ''
  adminPage.once('dialog', dialog => { adminRemovalConfirmation = dialog.message(); void dialog.accept() })
  await removalRow.getByRole('button', { name: 'Remover' }).click()
  expect(adminRemovalConfirmation).toContain(`@${removalUsername}`)
  await expect(removalRow).toHaveCount(0)

  const memberContext = await browser!.newContext({ viewport: { width: 1024, height: 900 } })
  const memberPage = await memberContext.newPage()
  await memberPage.goto('/')
  await memberPage.getByRole('button', { name: 'Entrar', exact: true }).click()
  await memberPage.getByLabel('Nome de usuário').fill(memberUsername)
  await memberPage.getByLabel('Senha').fill('SenhaSegura!2026QA')
  await memberPage.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(memberPage.locator('.rail').getByRole('button', { name: 'Comunidades' })).toBeVisible()
  await memberPage.locator('.rail').getByRole('button', { name: 'Comunidades' }).click()
  const memberCommunity = memberPage.locator('.community-card-heading').filter({ hasText: communityName })
  await expect(memberCommunity).toBeVisible()
  await memberCommunity.click()
  const memberPanel = memberPage.locator('.community-panel')
  await expect(memberPanel.getByRole('button', { name: 'Sair da comunidade' })).toBeVisible()
  await expect(memberPanel.getByRole('heading', { name: `Novo canal em ${communityName}` })).toHaveCount(0)
  await expect(memberPanel.getByRole('button', { name: /Promover admin|Remover admin|Remover/ })).toHaveCount(0)
  await expect(memberPanel.locator('.community-admin')).toHaveCount(0)
  await expectNoA11yViolations(memberPage, 'Painel de comunidade como participante')
  let leaveConfirmation = ''
  memberPage.once('dialog', dialog => { leaveConfirmation = dialog.message(); void dialog.accept() })
  await memberPanel.getByRole('button', { name: 'Sair da comunidade' }).click()
  expect(leaveConfirmation).toContain(communityName)
  await expect(memberCommunity).toHaveCount(0)
  await adminContext.close()
  await memberContext.close()

  const ownerAdminRow = page.locator('.community-panel .person-row').filter({ hasText: adminUsername })
  await expect(ownerAdminRow.getByRole('button', { name: 'Remover', exact: true })).toBeVisible()
  let ownerRemovalConfirmation = ''
  page.once('dialog', dialog => { ownerRemovalConfirmation = dialog.message(); void dialog.accept() })
  await ownerAdminRow.getByRole('button', { name: 'Remover', exact: true }).click()
  expect(ownerRemovalConfirmation).toContain(`@${adminUsername}`)
  await expect(ownerAdminRow).toHaveCount(0)

  const renamedCommunity = `${communityName} editada`
  await page.locator('.community-admin').getByLabel('Novo nome').fill(renamedCommunity)
  await page.locator('.community-admin').getByRole('button', { name: 'Salvar nome' }).click()
  communityName = renamedCommunity
  await expect(page.locator('.community-details h3')).toContainText(communityName)
  await expect(page.locator('.community-card-heading').filter({ hasText: communityName })).toBeVisible()
  const communityDeleteButton = page.getByRole('button', { name: 'Excluir comunidade e canais' })
  let deletePrompt = ''
  page.once('dialog', dialog => { deletePrompt = dialog.message(); void dialog.dismiss() })
  await communityDeleteButton.click()
  expect(deletePrompt).toContain(communityName)
  await expect(page.locator('.community-card-heading').filter({ hasText: communityName })).toBeVisible()
  page.once('dialog', dialog => { void dialog.accept() })
  await communityDeleteButton.click()
  await expect(page.locator('.community-card-heading').filter({ hasText: communityName })).toHaveCount(0)

  await page.locator('.rail').getByRole('button', { name: /Abrir opções da conta/ }).click()
  await expect(page.getByRole('button', { name: 'Sair da conta' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Sair da conta' })).toBeHidden()

  await page.locator('.rail').getByRole('button', { name: 'Mensagens' }).click()
  await context.setOffline(true)
  await expect(page.getByText('Sem conexão · verifique a rede para enviar e receber mensagens')).toBeVisible()
  await context.setOffline(false)
  await expect(page.getByText('Conectado · mensagens sincronizadas em tempo real')).toBeVisible({ timeout: 15_000 })

  await expectNoA11yViolations(page, 'Interface autenticada desktop')
  await page.emulateMedia({ forcedColors: 'active' })
  const focusedOutlineWidth = await page.locator('.rail').getByRole('button', { name: 'Mensagens' }).evaluate((button) => {
    button.focus()
    return Number.parseFloat(getComputedStyle(button).outlineWidth)
  })
  expect(focusedOutlineWidth).toBeGreaterThanOrEqual(2)
  await page.emulateMedia({ forcedColors: 'none' })

  await page.locator('.rail').getByRole('button', { name: /Abrir opções da conta/ }).click()
  await page.getByRole('button', { name: 'Sair da conta' }).click()
  await expect(page.getByRole('heading', { name: 'Seu espaço começa aqui.' })).toBeVisible()
  expect((await context.cookies(registrationResponse.url())).some(cookie => cookie.name === 'prosa_session')).toBe(false)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.getByLabel('Nome de usuário').fill(username)
  await page.getByLabel('Senha').fill('SenhaSegura!2026QA')
  const loginResponsePromise = page.waitForResponse(response => response.url().endsWith('/api/auth/login'))
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  const loginResponse = await loginResponsePromise
  expect((await loginResponse.json()).token).toBeUndefined()
  await expect(page.locator('.rail').getByRole('button', { name: 'Mensagens' })).toBeVisible()
  await expect(page.evaluate(() => localStorage.getItem('prosa.session'))).resolves.toBeNull()
  expect((await context.cookies(loginResponse.url())).find(cookie => cookie.name === 'prosa_session')?.httpOnly).toBe(true)
})
