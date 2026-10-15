interface Window {
  prosaDesktop?: {
    apiUrl: string
    platform: 'win32' | 'linux' | 'darwin'
    getSessionToken(): Promise<string | null>
    setSessionToken(token: string): Promise<void>
    clearSessionToken(): Promise<void>
    getStartupEnabled(): Promise<boolean>
    setStartupEnabled(enabled: boolean): Promise<void>
  }
}
