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

async function openGamePage({seed,voxelSourcePath,gameLoopSourcePath,scriptSourceRoot}={}) {
  const server = await startStaticServer(projectRoot);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: findBrowserExecutable(),
      headless: true
    });
    const context = await browser.newContext({viewport: {width: 480, height: 270}});
    /* This applies to every page/frame and every navigation, before game code.
       Never permit a test to call native pointer lock, including headless runs. */
    await context.addInitScript({path:path.join(projectRoot,'tests','browser','input-safety.js')});
    if(seed!==undefined)await context.addInitScript(seed=>{
      let value=seed>>>0;
      Math.random=()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;};
    },seed);
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
    if(scriptSourceRoot)await page.route(`${server.origin}/**/*.js*`,route=>{
      const root=path.resolve(scriptSourceRoot);
      const file=path.resolve(root,new URL(route.request().url()).pathname.slice(1));
      if(file.startsWith(root+path.sep)&&fs.existsSync(file))return route.fulfill({
        path:file,contentType:'text/javascript; charset=utf-8'
      });
      return route.continue();
    });
    if(voxelSourcePath)await page.route('**/voxel_physics.js*',route=>route.fulfill({
      path:path.resolve(voxelSourcePath),contentType:'text/javascript; charset=utf-8'
    }));
    if(gameLoopSourcePath)await page.route('**/js/game-loop.js*',route=>route.fulfill({
      path:path.resolve(gameLoopSourcePath),contentType:'text/javascript; charset=utf-8'
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
