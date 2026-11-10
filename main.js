const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1020, height: 780, minWidth: 820, minHeight: 620,
    title: 'BM Coder', autoHideMenuBar: true, backgroundColor: '#F6FBFF',
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  win.loadFile('index.html');
});
app.on('window-all-closed', () => app.quit());
