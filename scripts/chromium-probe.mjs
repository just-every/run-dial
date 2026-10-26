import { chromium } from '@playwright/test';

// Use this checkout's bundled headless shell and Playwright's default arguments.
// A real launch catches missing shared libraries that a download cannot detect.
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    timeout: 30_000,
    args: ['--use-mock-keychain', '--password-store=basic'],
  });
  const page = await browser.newPage();
  await page.setContent('<title>Chromium dependency probe</title>');
  if (await page.title() !== 'Chromium dependency probe') throw new Error('Chromium probe did not render');
} finally {
  await browser?.close();
}
