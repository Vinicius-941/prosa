import { useState, type FormEvent } from 'react'
import { api, type ProsaUser } from './api'

export function AccountDataControls({ user, onDeleted, onNotice }: {
  user: ProsaUser
  onDeleted: () => Promise<void>
  onNotice: (message: string) => void
}) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)

  async function exportData() {
    setBusy(true)
    try {
      await api.exportAccount()
      onNotice('A cópia dos dados da conta foi preparada para baixar.')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Não foi possível exportar seus dados.')
    } finally {
      setBusy(false)
    }
  }

  async function deleteAccount(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await api.deleteAccount(password, confirmation)
      await onDeleted()
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Não foi possível excluir sua conta.')
      setBusy(false)
    }
  }

  return <section className="people-section account-data-section">
    <h3>Seus dados</h3>
    <p>Baixe uma cópia do perfil, conexões, comunidades, sessões e conversas acessíveis à sua conta.</p>
    <button className="person-action primary" disabled={busy} onClick={() => void exportData()}>{busy ? 'Aguarde…' : 'Baixar meus dados'}</button>
    <details className="account-delete">
      <summary>Excluir minha conta</summary>
      <p>A exclusão remove seu perfil, sessões e mensagens associadas. Nas comunidades que você administra, a responsabilidade passa para o membro mais antigo; comunidades sem outros membros serão removidas.</p>
      <form className="password-form" onSubmit={deleteAccount}>
        <label>Senha atual<input type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /></label>
        <label>Digite <strong>@{user.username}</strong> para confirmar<input autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={24} required value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
        <button className="person-action danger" disabled={busy || confirmation.trim().toLocaleLowerCase('pt-BR') !== user.username}>{busy ? 'Excluindo…' : 'Excluir definitivamente'}</button>
      </form>
    </details>
  </section>
}
