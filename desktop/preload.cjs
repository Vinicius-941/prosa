const { contextBridge } = require('electron')

const apiArgument = process.argv.find(argument => argument.startsWith('--prosa-api='))
if (apiArgument) contextBridge.exposeInMainWorld('prosaDesktop', { apiUrl: apiArgument.slice('--prosa-api='.length) })
