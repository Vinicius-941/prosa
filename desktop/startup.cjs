function quoteDesktopExec(value) { return `"${value.replace(/[\\"`$]/g, '\\$&')}"` }

function linuxAutostartDesktopFile(executable, appPath) {
  return `[Desktop Entry]\nType=Application\nName=Prosa\nComment=Conversas que aproximam\nExec=${quoteDesktopExec(executable)} ${quoteDesktopExec(appPath)}\nTerminal=false\nX-GNOME-Autostart-enabled=true\nX-Prosa-Autostart=true\n`
}

module.exports = { linuxAutostartDesktopFile }
