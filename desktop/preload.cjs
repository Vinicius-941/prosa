const { contextBridge, ipcRenderer } = require('electron')

const apiArgument = process.argv.find(argument => argument.startsWith('--prosa-api='))
if (apiArgument) contextBridge.exposeInMainWorld('prosaDesktop', {
  apiUrl: apiArgument.slice('--prosa-api='.length),
  platform: process.platform,
  getSessionToken: () => ipcRenderer.invoke('prosa:session:get'),
  setSessionToken: token => ipcRenderer.invoke('prosa:session:set', token),
  clearSessionToken: () => ipcRenderer.invoke('prosa:session:clear'),
  getStartupEnabled: () => ipcRenderer.invoke('prosa:startup:get'),
  setStartupEnabled: enabled => ipcRenderer.invoke('prosa:startup:set', enabled),
})
