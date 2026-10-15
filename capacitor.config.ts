import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.prosa.mobile',
  appName: 'Prosa',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
}

export default config
