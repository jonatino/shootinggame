'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright-core');
const {projectRoot} = require('./game-runtime.cjs');
const {startStaticServer} = require('./static-server.cjs');

const browserCandidates = [
  process.env.GAME_TEST_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);

function findBrowserExecutable() {
  const executable = browserCandidates.find(candidate => fs.existsSync(candidate));
  if (!executable) {
    throw new Error('No supported local Chrome or Edge executable was found. Set GAME_TEST_BROWSER.');
  }
  return executable;
}

async function openGamePage() {
  const server = await startStaticServer(projectRoot);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: findBrowserExecutable(),
      headless: true
    });
    const context = await browser.newContext({viewport: {width: 480, height: 270}});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const localThree = require.resolve('three/build/three.min.js');
    await page.route('https://cdnjs.cloudflare.com/**/three.min.js', route => route.fulfill({
      path: localThree,
      contentType: 'text/javascript; charset=utf-8'
    }));
    const startedAt = performance.now();
    await page.goto(`${server.origin}/index.html`, {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => {
      const canvas = document.querySelector('canvas');
      return !!canvas && canvas.width > 0 && canvas.height > 0;
    }, null, {timeout: 15000});
    await page.waitForTimeout(32);
    const readyMs = performance.now() - startedAt;
    await page.addScriptTag({path: path.join(projectRoot, 'tests', 'browser', 'direct-control.js')});
    return {
      browser,
      context,
      page,
      server,
      errors,
      readyMs,
      async close() {
        await browser.close();
        await server.close();
      }
    };
  } catch (error) {
    if (browser) await browser.close();
    await server.close();
    throw error;
  }
}

module.exports = {findBrowserExecutable, openGamePage};
