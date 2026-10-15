import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const { linuxAutostartDesktopFile } = createRequire(import.meta.url)('../desktop/startup.cjs') as { linuxAutostartDesktopFile: (executable: string, appPath: string) => string }

test('Linux startup entry quotes paths and escapes desktop Exec metacharacters', () => {
  const entry = linuxAutostartDesktopFile('/opt/Prosa App', '/home/user/Prosa $HOME')
  assert.match(entry, /^\[Desktop Entry\]/)
  assert.ok(entry.includes('Exec="/opt/Prosa App" "/home/user/Prosa \\$HOME"'))
  assert.ok(entry.includes('X-Prosa-Autostart=true'))
})
