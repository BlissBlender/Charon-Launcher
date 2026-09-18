const fs = require('fs');
const content = fs.readFileSync('main.js', 'utf8');
const lines = content.split('\n');
// Find end of startBypass which is exactly at line 214 currently (or we can search)
// Just slice top 217 lines and write the rest.
let topHalf = lines.slice(0, 218).join('\n');

const newBottomHalf = `

// ===========================================================
// STEAM METADATA SCRAPER
// ===========================================================

const metaCache = {};

ipcMain.handle('fetch-metadata', async (event, searchQuery) => {
  if (metaCache[searchQuery]) return metaCache[searchQuery];
  
  return new Promise((resolve, reject) => {
    const searchUrl = \`https://store.steampowered.com/api/storesearch/?term=\${encodeURIComponent(searchQuery)}&l=english&cc=US\`;
    
    https.get(searchUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.total > 0 && result.items.length > 0) {
            const app = result.items[0];
            const metadata = {
              title: app.name,
              slug: app.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-free-download',
              cover: \`https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/\${app.id}/library_600x900.jpg\`,
              banner: \`https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/\${app.id}/header.jpg\`,
              logo: \`https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/\${app.id}/logo.png\`,
            };

            const detailsUrl = \`https://store.steampowered.com/api/appdetails?appids=\${app.id}\`;
            https.get(detailsUrl, (dRes) => {
              let dData = '';
              dRes.on('data', c => dData += c);
              dRes.on('end', () => {
                try {
                  const dParsed = JSON.parse(dData);
                  if (dParsed[app.id] && dParsed[app.id].success) {
                    const gameData = dParsed[app.id].data;
                    metadata.description = gameData.short_description;
                    metadata.developer = gameData.developers ? gameData.developers[0] : 'Unknown';
                  }
                  metaCache[searchQuery] = metadata;
                  resolve(metadata);
                } catch (e) { resolve(metadata); }
              });
            }).on('error', () => resolve(metadata));
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
});

ipcMain.handle('fetch-steamrip-page', async (event, params) => {
  const { page, search } = params || { page: 1, search: '' };
  let url = '';
  if (search && search.trim() !== '') {
    const q = encodeURIComponent(search.trim());
    url = page === 1 ? \`https://steamrip.com/?s=\${q}\` : \`https://steamrip.com/page/\${page}/?s=\${q}\`;
  } else {
    url = page === 1 ? 'https://steamrip.com/' : \`https://steamrip.com/page/\${page}/\`;
  }
  
  console.log('\\n[Backend] Fetching SteamRIP page:', url);

  return new Promise((resolve, reject) => {
    const scrapeWin = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    scrapeWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.log('[Backend] SteamRIP scrape timed out');
        try { scrapeWin.close(); } catch(e) {}
        resolve([]);
      }
    }, 30000);

    scrapeWin.webContents.on('dom-ready', () => {
      setTimeout(async () => {
        if (resolved) return;
        try {
          const html = await scrapeWin.webContents.executeJavaScript('document.documentElement.outerHTML');
          
          if (html.includes('Just a moment') || html.includes('Attention Required')) {
            console.log('[Backend] Still on Cloudflare challenge, waiting...');
            return;
          }

          const $ = cheerio.load(html);
          const games = [];
          
          $('.post-item').each((i, el) => {
            const a = $(el).find('a.post-thumb');
            const titleElem = $(el).find('.the-post-title').clone();
            
            titleElem.find('span').remove();
            let title = titleElem.text().trim();
            if (!title) title = $(el).find('.post-title a').text().trim();
            title = title.replace(/Free Download.*$/i, '').trim();

            let slug = a.attr('href');
            if (slug) slug = slug.replace(/^https?:\\/\\/[^\\/]+\\//, '').replace(/\\//g, '');

            let cover = $(el).find('img.thumbnail-image').attr('data-src-webp') 
                     || $(el).find('img.thumbnail-image').attr('src');

            const metaLine = $(el).find('.game-meta-line').text();
            const sizeMatch = metaLine.split('|')[1];
            const size = sizeMatch ? sizeMatch.trim() : 'Unknown Size';

            if (slug && title) {
              games.push({
                id: slug,
                title,
                slug,
                cover: cover || '',
                banner: cover || '',
                developer: 'SteamRIP',
                description: 'Pre-Installed Game from SteamRIP',
                size,
                progress: 0,
                enriched: false
              });
            }
          });

          console.log('[Backend] Scraped', games.length, 'games from URL', url);
          
          if (games.length > 0 || $('.post-item').length === 0) {
            resolved = true;
            clearTimeout(timeout);
            try { scrapeWin.close(); } catch(e) {}
            resolve(games);
          }
        } catch (err) {
          console.error('[Backend] Scrape JS error:', err);
        }
      }, 2000);
    });

    scrapeWin.loadURL(url, {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
  });
});
`;

fs.writeFileSync('main.js', topHalf + newBottomHalf, 'utf8');
console.log('Fixed main.js successfully');
