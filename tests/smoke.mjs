// Minimal smoke test for index.html: loads the page in headless Chromium,
// fails the build if there are JS errors or the core interactive elements
// (rails, dpad, mode buttons, settings modal, scroll indicator) are missing.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function startServer() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const file = await readFile(path.join(root, 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(file);
      } catch (e) {
        res.writeHead(500);
        res.end(String(e));
      }
    });
    server.listen(0, () => resolve(server));
  });
}

const REQUIRED_IDS = [
  'messages', 'scrollTrack', 'scrollThumb', 'textInput', 'sendBtn',
  'dpadUp', 'dpadDown', 'dpadTop', 'dpadBottom', 'stickSettingsBtn',
  'modeBtnClaude', 'modeBtnGpt', 'modeBtnBoth', 'modeBtnNewSession',
  'settingsBtn', 'webhookInput', 'accessKeyInput'
];

async function main() {
  const server = await startServer();
  const { port } = server.address();
  const browser = await chromium.launch();
  const errors = [];
  let failed = false;

  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(`http://localhost:${port}/`);
    await page.waitForTimeout(300);

    for (const id of REQUIRED_IDS) {
      const exists = await page.locator(`#${id}`).count();
      if (exists === 0) {
        console.error(`FAIL: missing required element #${id}`);
        failed = true;
      }
    }

    // Settings modal opens/closes.
    await page.click('#settingsBtn');
    const opened = await page.evaluate(() => document.getElementById('settingsOverlay').classList.contains('open'));
    if (!opened) { console.error('FAIL: settings modal did not open'); failed = true; }
    await page.click('#closeSettingsBtn');

    // Mode buttons set the input prefix.
    await page.click('#modeBtnClaude');
    const val = await page.inputValue('#textInput');
    if (val.indexOf('@claude') !== 0) { console.error('FAIL: modeBtnClaude did not prefix input'); failed = true; }

    // Real console/page errors (ignore expected network failures from the
    // sandboxed test env, e.g. fonts/webhook with no network).
    const realErrors = errors.filter((e) => !/net::ERR|Failed to load resource/i.test(e));
    if (realErrors.length) {
      console.error('FAIL: unexpected JS errors:', realErrors);
      failed = true;
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (failed) {
    process.exit(1);
  }
  console.log('Smoke test passed.');
}

main();
