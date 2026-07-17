// Minimal Electron shell for rendering design mocks to a real Chromium window.
const { app, BrowserWindow } = require('electron');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1320,
    height: 840,
    autoHideMenuBar: true,
    backgroundColor: '#f2f4f9',
    webPreferences: { contextIsolation: true },
  });
  win.loadURL('about:blank');
});

app.on('window-all-closed', () => app.quit());
