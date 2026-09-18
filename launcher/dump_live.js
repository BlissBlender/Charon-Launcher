const { app, BrowserWindow } = require('electron');
const fs = require('fs');

app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false });
  win.loadURL('https://steamrip.com/');
  
  win.webContents.on('did-finish-load', async () => {
    // Wait a sec for Cloudflare
    setTimeout(async () => {
      const html = await win.webContents.executeJavaScript(`
        Array.from(document.querySelectorAll('.post-item')).slice(0, 5).map(el => el.innerHTML)
      `);
      fs.writeFileSync('live_html_dump.json', JSON.stringify(html, null, 2));
      app.quit();
    }, 8000);
  });
});
