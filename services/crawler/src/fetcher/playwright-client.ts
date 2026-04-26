import { chromium, Browser, Page } from 'playwright';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { FetchResult } from './index';

class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }
}

const pageSemaphore = new Semaphore(CONFIG.playwrightConcurrentPages);

let browser: Browser | null = null;
let browserPromise: Promise<Browser> | null = null;
let browserLaunchFailed = false;

export async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) {
    return browser;
  }
  
  if (browserLaunchFailed) {
    throw new Error('Browser launch previously failed');
  }
  
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: CONFIG.playwrightHeadless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      proxy: CONFIG.playwrightProxy ? { server: CONFIG.playwrightProxy } : undefined,
    }).then(b => {
      browser = b;
      browserPromise = null;
      return b;
    }).catch(err => {
      browserPromise = null;
      browserLaunchFailed = true;
      logger.error('Failed to launch Playwright browser', { error: err });
      throw err;
    });
  }
  
  return browserPromise;
}

export async function fetchWithPlaywright(url: string): Promise<FetchResult> {
  await pageSemaphore.acquire();

  try {
    const browser = await getBrowser();
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
    });

    // Set realistic user agent and headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Upgrade-Insecure-Requests': '1',
    });

    try {
      await page.goto(url, {
        timeout: CONFIG.playwrightTimeout,
        waitUntil: 'load',
      });

      await page.waitForTimeout(CONFIG.playwrightBufferMs);

      try {
        await page.waitForLoadState('networkidle', {
          timeout: CONFIG.playwrightNetworkidleTimeout
        });
      } catch {
        // Ignore timeout - continue with current DOM state
      }

      const html = await page.content();
      return { html, contentType: 'javascript' };
    } catch (error) {
      logger.error('Playwright fetch error', {
        url,
        error: error instanceof Error ? { message: error.message, stack: error.stack, name: error.name } : error,
      });
      throw error;
    } finally {
      await page.close();
    }
  } finally {
    pageSemaphore.release();
  }
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    try {
      await browser.close();
    } catch (error) {
      logger.error('Error closing browser', { error });
    }
    browser = null;
  }
  browserLaunchFailed = false;
}

process.on('exit', () => {
  if (browser) {
    try {
      browser.close().catch(() => {});
    } catch {}
  }
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, closing browser');
  await closeBrowser();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, closing browser');
  await closeBrowser();
  process.exit(0);
});