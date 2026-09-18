const { app, BrowserWindow, session } = require('electron');

// The Buzzheavier mirror link for Dishwashing Simulator
const TARGET_URL = 'https://bzzhr.to/k32b35vnnr1c';
const REFERER = 'https://steamrip.com/dishwashing-simulator-free-download/';

app.whenReady().then(async () => {
  console.log('[Bypass] Starting Electron browser instance...');

  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    show: true, // Set to true so we can watch it bypass the challenge in real-time
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Relay console logs from the webpage back to our terminal
  win.webContents.on('console-message', (event, level, message) => {
    console.log(`[Browser] ${message}`);
  });

  // INTERCEPTOR: This catches the actual file download!
  session.defaultSession.on('will-download', (event, item, webContents) => {
    // Stop Electron from saving the 30GB file to disk
    event.preventDefault();
    
    const finalUrl = item.getURL();
    const filename = item.getFilename();
    
    console.log('\n======================================================');
    console.log('🎉 SUCCESS! Captured Raw Download Link 🎉');
    console.log('Filename: ', filename);
    console.log('Raw URL:  ', finalUrl);
    console.log('======================================================\n');
    
    // We successfully extracted the raw link! Close the app.
    app.quit();
  });

  console.log(`[Bypass] Navigating to ${TARGET_URL} (Spoofing Referer...)`);
  await win.loadURL(TARGET_URL, {
    httpReferrer: REFERER,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  console.log('[Bypass] Landed on page. Waiting for Cloudflare to verify our residential IP...');

  // Inject a script into the page that waits for Cloudflare to clear, 
  // then automatically clicks the Download button.
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      console.log('Auto-clicker script active. Polling page state...');
      
      const interval = setInterval(() => {
        // If Cloudflare "Just a moment..." is still active, wait.
        if (document.title.includes('Just a moment') || document.title.includes('security')) {
          return;
        }

        // Challenge passed! Look for the Buzzheavier htmx download button
        const btn = document.querySelector('a[hx-get*="/download"]');
        if (btn) {
          console.log('Found htmx download button! Clicking it automatically...');
          btn.click();
          clearInterval(interval);
          resolve();
          return;
        }

        // Fallback: look for a generic download button
        const links = Array.from(document.querySelectorAll('a'));
        for (const link of links) {
          const text = (link.textContent || '').toLowerCase().trim();
          if (text === 'download' || text === 'download now' || text === 'direct download') {
            console.log('Found generic download link! Clicking automatically...');
            link.click();
            clearInterval(interval);
            resolve();
            return;
          }
        }
      }, 1000); // Check every 1 second
    });
  `);
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  app.quit();
});
