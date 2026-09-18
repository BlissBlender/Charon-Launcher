const fs = require('fs');

const codeToInsert = `
// ==========================================================
// STEAMUNLOCKED SCRAPER
// ==========================================================
ipcMain.handle('fetch-steamunlocked-page', async (event, url) => {
  console.log('[Backend] Fetching SteamUnlocked page:', url);
  
  // Create a hidden window to fetch
  const win = new BrowserWindow({ 
    show: false, 
    webPreferences: { 
      nodeIntegration: false, 
      contextIsolation: true 
    } 
  });
  
  try {
    await win.loadURL(url);
    const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML');
    win.destroy();
    
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);
    const games = [];

    // On SteamUnlocked home or search pages, games are in .su-cat__card
    $('.su-cat__card, .cover-item').each((i, el) => {
      let href = $(el).attr('href') || $(el).find('a').attr('href');
      let title = $(el).find('h2').text().trim() || $(el).find('.title').text().trim();
      let cover = $(el).find('img').attr('data-src') || $(el).find('img').attr('src');
      
      // Some templates might have .su-cat__card-body
      if (!title) {
         title = $(el).find('.su-cat__card-body h2').text().trim();
      }

      if (href && title) {
        let slug = href.replace(/^https?:\\/\\/[^\\/]+\\//, '').replace(/\\//g, '');
        
        // Ensure absolute cover URL
        if (cover && !cover.startsWith('http')) {
          cover = cover.startsWith('/') ? 'https://steamunlocked.org' + cover : 'https://steamunlocked.org/' + cover;
        }

        games.push({
          id: 'su-' + slug, // Prefix to avoid collisions
          title: title,
          slug: href, // For SteamUnlocked, we keep the full URL as slug so we can visit it later to get UploadHaven link
          cover: cover,
          banner: cover,
          developer: "SteamUnlocked",
          description: "Pre-Installed Game from SteamUnlocked",
          size: "Unknown", // SU doesn't show size on the card usually
          progress: 0,
          enriched: false,
          source: 'steamunlocked'
        });
      }
    });

    console.log(\`[Backend] Scraped \${games.length} games from \${url}\`);
    return games;
  } catch (error) {
    console.error('[Backend] SteamUnlocked Fetch Error:', error);
    if (!win.isDestroyed()) win.destroy();
    return [];
  }
});
`;

let content = fs.readFileSync('main.js', 'utf8');

if (!content.includes('fetch-steamunlocked-page')) {
  // Insert before the download manager
  const insertTarget = '// DOWNLOAD MANAGER';
  if (content.includes(insertTarget)) {
    content = content.replace(insertTarget, codeToInsert + '\n' + insertTarget);
    fs.writeFileSync('main.js', content, 'utf8');
    console.log('Successfully injected steamunlocked scraper into main.js');
  } else {
    console.log('Could not find insert target.');
  }
} else {
  console.log('SteamUnlocked scraper already present.');
}
