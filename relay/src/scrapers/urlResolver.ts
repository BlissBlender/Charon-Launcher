/**
 * Relay — URL Resolver
 *
 * Two-step resolution:
 *   1. Fast fetch + HTML parse on the SteamRIP game page → extract bzzhr.to link
 *   2. Puppeteer browser session → navigate to buzz page with correct Referer →
 *      find the htmx download button → fetch the hx-get endpoint → grab HX-Redirect
 *      header which contains the final direct download URL
 */
import puppeteer, { Browser } from '@cloudflare/puppeteer';
import { parse } from 'node-html-parser';
import type { Env, ResolvedUrl } from '../types';
import { setResolvedUrl, markPending } from '../services/cache';

export async function resolveDownloadUrl(
  slug: string,
  gamePageUrl: string,
  env: Env,
): Promise<ResolvedUrl> {
  console.log(`[Resolver] Starting resolve for: ${slug} → ${gamePageUrl}`);

  await markPending(env, slug);

  const mirrorUrls: string[] = [];
  let browser: Browser | null = null;

  try {
    // ──────────────────────────────────────────────
    // STEP 1: Fast fetch the SteamRIP game page, extract mirror links
    // ──────────────────────────────────────────────
    console.log(`[Resolver] Step 1: Fetching game page...`);
    const response = await fetch(gamePageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch game page: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const root = parse(html);

    // Find all links with class .shortc-button
    const buttons = root.querySelectorAll('a.shortc-button');

    for (const btn of buttons) {
      const href = btn.getAttribute('href');
      if (href && href !== '#' && !href.startsWith('javascript:')) {
        let fullLink = href;
        if (fullLink.startsWith('//')) {
          fullLink = 'https:' + fullLink;
        }
        mirrorUrls.push(fullLink);
      }
    }

    console.log(`[Resolver] Found ${mirrorUrls.length} mirror links: ${mirrorUrls.join(', ')}`);

    if (mirrorUrls.length === 0) {
      throw new Error('Could not find any .shortc-button links on the game page');
    }

    // ──────────────────────────────────────────────
    // STEP 2: Find the buzzheavier link and resolve it via Puppeteer
    // ──────────────────────────────────────────────
    const buzzLink = mirrorUrls.find(u => u.includes('bzzhr.to') || u.includes('buzzheavier.com'));

    if (!buzzLink) {
      // No buzz link found — just return the first mirror as-is
      console.log(`[Resolver] No buzz link found, returning first mirror`);
      return await buildAndCacheResult(slug, mirrorUrls[0], mirrorUrls, env);
    }

    console.log(`[Resolver] Step 2: Opening buzz link in browser: ${buzzLink}`);

    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();

    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Set extra headers including Referer from steamrip
    await page.setExtraHTTPHeaders({
      'Referer': gamePageUrl,
    });

    // Navigate to the buzz page
    await page.goto(buzzLink, {
      waitUntil: 'networkidle0',
      timeout: 30_000,
    });

    // Wait for Cloudflare challenge to auto-solve
    // Poll until the page title changes from "Just a moment..."
    console.log(`[Resolver] Waiting for Cloudflare challenge to clear...`);
    let challengeCleared = false;
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(3000);
      const title = await page.title();
      const url = page.url();
      console.log(`[Resolver] Poll ${i + 1}: title="${title}", url="${url}"`);
      if (!title.includes('Just a moment') && !title.includes('security')) {
        challengeCleared = true;
        break;
      }
    }

    const currentUrl = page.url();
    console.log(`[Resolver] Browser landed on: ${currentUrl}, challenge cleared: ${challengeCleared}`);

    // Check if we got redirected back to steamrip (dead link)
    if (currentUrl.includes('steamrip.com')) {
      console.log(`[Resolver] Buzz link is dead (redirected to steamrip), falling back to other mirrors`);
      const fallback = mirrorUrls.find(u => !u.includes('bzzhr.to') && !u.includes('buzzheavier.com'));
      if (fallback) {
        return await buildAndCacheResult(slug, fallback, mirrorUrls, env);
      }
      throw new Error('Buzz link is dead and no other mirrors available');
    }

    // ──────────────────────────────────────────────
    // STEP 3: Find the download button and get the final URL
    // ──────────────────────────────────────────────
    console.log(`[Resolver] Step 3: Looking for download button...`);

    // Strategy A: Look for htmx download button (a[hx-get*="/download"])
    // First, dump what we can see on the page for debugging
    const pageDebug = await page.evaluate(() => {
      const allLinks = Array.from(document.querySelectorAll('a')).map(a => ({
        text: (a.textContent || '').trim().substring(0, 80),
        href: a.getAttribute('href'),
        hxGet: a.getAttribute('hx-get'),
        classes: a.className,
      }));
      const allButtons = Array.from(document.querySelectorAll('button')).map(b => ({
        text: (b.textContent || '').trim().substring(0, 80),
        hxGet: b.getAttribute('hx-get'),
        classes: b.className,
      }));
      const hxElements = Array.from(document.querySelectorAll('[hx-get]')).map(el => ({
        tag: el.tagName,
        text: (el.textContent || '').trim().substring(0, 80),
        hxGet: el.getAttribute('hx-get'),
      }));
      return { 
        title: document.title,
        linkCount: allLinks.length,
        links: allLinks.slice(0, 20),
        buttonCount: allButtons.length,
        buttons: allButtons.slice(0, 10),
        hxElements,
        bodySnippet: document.body?.innerHTML?.substring(0, 500) || 'empty',
      };
    });
    console.log(`[Resolver] Page title: ${pageDebug.title}`);
    console.log(`[Resolver] Links (${pageDebug.linkCount}): ${JSON.stringify(pageDebug.links)}`);
    console.log(`[Resolver] Buttons (${pageDebug.buttonCount}): ${JSON.stringify(pageDebug.buttons)}`);
    console.log(`[Resolver] HX elements: ${JSON.stringify(pageDebug.hxElements)}`);
    console.log(`[Resolver] Body snippet: ${pageDebug.bodySnippet}`);

    const hxGetEndpoint = await page.evaluate(() => {
      const btn = document.querySelector('a[hx-get*="/download"]');
      if (btn) {
        return btn.getAttribute('hx-get');
      }
      return null;
    });

    if (hxGetEndpoint) {
      console.log(`[Resolver] Found htmx download endpoint: ${hxGetEndpoint}`);

      // Build the full URL for the hx-get endpoint
      const buzzOrigin = new URL(currentUrl).origin;
      const downloadEndpoint = hxGetEndpoint.startsWith('http')
        ? hxGetEndpoint
        : `${buzzOrigin}${hxGetEndpoint}`;

      // Fetch the endpoint to get the HX-Redirect header
      // We need to do this in the browser context to pass cookies/CF challenge
      const finalDownloadUrl = await page.evaluate(async (endpoint: string) => {
        try {
          const resp = await fetch(endpoint, {
            method: 'GET',
            headers: {
              'HX-Request': 'true',
              'HX-Current-URL': window.location.href,
            },
            redirect: 'manual',
          });

          // Check for HX-Redirect header
          const hxRedirect = resp.headers.get('HX-Redirect');
          if (hxRedirect) return hxRedirect;

          // Check for Location header (302 redirect)
          const location = resp.headers.get('Location');
          if (location) return location;

          // If the response itself is a redirect URL in the body
          const body = await resp.text();
          if (body.startsWith('http')) return body.trim();

          return null;
        } catch (e) {
          return null;
        }
      }, downloadEndpoint);

      if (finalDownloadUrl) {
        console.log(`[Resolver] ✅ Got final download URL: ${finalDownloadUrl}`);
        return await buildAndCacheResult(slug, finalDownloadUrl, mirrorUrls, env);
      }

      // If in-page fetch didn't work, try clicking the button and intercepting navigation
      console.log(`[Resolver] htmx fetch didn't return URL, trying click...`);
    }

    // Strategy B: Click the download button and capture where it navigates
    const downloadUrl = await page.evaluate(() => {
      // Look for various download button patterns
      const selectors = [
        'a[hx-get*="/download"]',
        'a[href*="/download"]',
        'a[download]',
        'a.download',
        'button.download',
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const href = el.getAttribute('href');
          if (href && href.startsWith('http')) return href;
        }
      }

      // Look for any <a> with "download" text
      const links = Array.from(document.querySelectorAll('a'));
      for (const link of links) {
        const text = (link.textContent || '').toLowerCase().trim();
        if (text === 'download' || text === 'download now' || text === 'direct download') {
          if (link.href && !link.href.includes('javascript:')) return link.href;
        }
      }

      return null;
    });

    if (downloadUrl) {
      console.log(`[Resolver] ✅ Found download URL from page: ${downloadUrl}`);
      return await buildAndCacheResult(slug, downloadUrl, mirrorUrls, env);
    }

    // Strategy C: Click the htmx button and watch for network redirect
    const hxButton = await page.$('a[hx-get*="/download"]');
    if (hxButton) {
      console.log(`[Resolver] Clicking htmx download button...`);

      // Listen for redirects
      let redirectUrl: string | null = null;
      page.on('response', (resp) => {
        const headers = resp.headers();
        if (headers['hx-redirect']) {
          redirectUrl = headers['hx-redirect'];
        }
        if (headers['location'] && resp.status() >= 300 && resp.status() < 400) {
          redirectUrl = headers['location'];
        }
        // Also capture any direct file download responses
        const url = resp.url();
        if (url.includes('/dl/') || url.includes('/download/') || url.includes('.rar') || url.includes('.zip') || url.includes('.7z')) {
          redirectUrl = url;
        }
      });

      await hxButton.click();
      await page.waitForTimeout(5000);

      if (redirectUrl) {
        console.log(`[Resolver] ✅ Captured redirect URL: ${redirectUrl}`);
        return await buildAndCacheResult(slug, redirectUrl, mirrorUrls, env);
      }

      // Check if page navigated
      const newUrl = page.url();
      if (newUrl !== currentUrl && !newUrl.includes('steamrip.com')) {
        console.log(`[Resolver] ✅ Page navigated to: ${newUrl}`);
        return await buildAndCacheResult(slug, newUrl, mirrorUrls, env);
      }
    }

    // Strategy D: Just return the buzz page URL itself (user can open it)
    console.log(`[Resolver] Could not extract final download, returning buzz page URL`);
    return await buildAndCacheResult(slug, buzzLink, mirrorUrls, env);

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Resolver] Error resolving ${slug}: ${errorMsg}`);

    const failed: ResolvedUrl = {
      slug,
      downloadUrl: '',
      mirrorUrls,
      resolvedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      status: 'failed',
      error: errorMsg,
    };
    await setResolvedUrl(env, slug, failed);
    return failed;

  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}

async function buildAndCacheResult(
  slug: string,
  downloadUrl: string,
  mirrorUrls: string[],
  env: Env,
): Promise<ResolvedUrl> {
  const ttl = parseInt(env.CACHE_TTL) || 86400;
  const result: ResolvedUrl = {
    slug,
    downloadUrl,
    mirrorUrls,
    resolvedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    status: 'resolved',
  };
  await setResolvedUrl(env, slug, result);
  return result;
}
