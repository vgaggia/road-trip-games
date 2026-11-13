/**
 * Zero-dependency Real Headless Chrome E2E & Mobile Viewport Verifier
 * Tests:
 *  1. Mobile portrait layout (390x844), no horizontal overflow, big touch targets
 *  2. Standalone Pass-the-Phone mode across all 5 games (4 players)
 *  3. WiFi Hotspot mode across 4 simultaneous Chrome tabs (1 APK Host + 3 Browser Passengers)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHotspotServer } from './dev-hotspot-server.mjs';

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser'
];

function findBrowser() {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('No Chromium browser found for E2E test');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CdpTab {
  constructor(wsUrl, label) {
    this.wsUrl = wsUrl;
    this.label = label;
    this.ws = null;
    this.seq = 1;
    this.pending = new Map();
    this.errors = [];
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.errors.push(msg.params?.exceptionDetails?.text || 'Runtime exception');
      }
    };
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true
    });
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  }

  send(method, params = {}) {
    const id = this.seq++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  async goto(url) {
    await this.send('Page.navigate', { url });
    await sleep(350);
  }

  async eval(expr) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`[${this.label}] Eval error: ${res.exceptionDetails.text} in ${expr}`);
    }
    return res.result.value;
  }

  async clickSelector(sel) {
    const ok = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el || el.disabled) return false;
      el.click();
      return true;
    })()`);
    if (!ok) {
      const html = await this.eval(`document.body.innerText.slice(0, 400)`);
      throw new Error(`[${this.label}] Could not click ${sel}. Visible text:\n${html}`);
    }
    await sleep(90);
  }

  async assertMobileErgonomics(stageName) {
    if (this.errors.length > 0) {
      throw new Error(`[${this.label}] Console exceptions at ${stageName}: ${this.errors.join('; ')}`);
    }
    const metrics = await this.eval(`(() => {
      const docW = document.documentElement.scrollWidth;
      const winW = window.innerWidth;
      const buttons = Array.from(document.querySelectorAll('button:not(:disabled)')).filter(b => b.offsetParent !== null);
      const tooSmall = buttons
        .map(b => ({ text: b.innerText.trim().slice(0, 25), rect: b.getBoundingClientRect() }))
        .filter(x => x.rect.height < 36 || x.rect.width < 36);
      return { docW, winW, btnCount: buttons.length, tooSmall };
    })()`);
    if (metrics.docW > metrics.winW + 1) {
      throw new Error(`[${this.label}] Horizontal overflow at ${stageName}: scrollWidth=${metrics.docW} > innerWidth=${metrics.winW}`);
    }
    if (metrics.tooSmall.length > 0) {
      throw new Error(`[${this.label}] Small touch targets at ${stageName}: ${JSON.stringify(metrics.tooSmall)}`);
    }
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function createNewTab(debugPort, url, label) {
  const res = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const info = await res.json();
  const tab = new CdpTab(info.webSocketDebuggerUrl, label);
  await tab.connect();
  await sleep(350);
  return tab;
}

async function main() {
  const srv = createHotspotServer(0);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  console.log(`✓ Local Hotspot Server started on port ${port}`);

  const debugPort = 9345 + Math.floor(Math.random() * 400);
  const tmpProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'shotgun-chrome-'));
  const chrome = spawn(findBrowser(), [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${tmpProfile}`,
    `--remote-debugging-port=${debugPort}`,
    'about:blank'
  ], { stdio: 'ignore' });

  // Wait for DevTools endpoint
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (r.ok) break;
    } catch (_) {}
    await sleep(150);
  }

  try {
    // =====================================================================
    // PART 1: PASS-THE-PHONE STANDALONE E2E (4 Players, All 5 Games!)
    // =====================================================================
    // Open with ?standalone=1 on file-like or via native=1 choosing pass mode
    const passTab = await createNewTab(debugPort, `http://127.0.0.1:${port}/?native=1`, 'PassPhone');
    await passTab.assertMobileErgonomics('Home Screen');

    await passTab.clickSelector('[data-action="choose-pass"]');
    await passTab.assertMobileErgonomics('Pass Setup');

    await passTab.clickSelector('[data-action="start-pass-session"]');
    await passTab.assertMobileErgonomics('Game Dashboard');

    // 1A. Window Wars
    await passTab.clickSelector('[data-action="launch-game"][data-game="window-wars"]');
    await passTab.assertMobileErgonomics('Window Wars');
    await passTab.clickSelector('[data-action="tap-bingo-tile"][data-idx="0"]');
    await passTab.clickSelector('[data-action="confirm-bingo-claim"][data-pid="local_1"]');
    await passTab.clickSelector('[data-action="back-to-dashboard"]');
    console.log('✓ Pass-the-Phone Game 1 (Window Wars) verified');

    // 1B. Undercover Passenger (4 players peek -> discuss -> vote -> steal/result)
    await passTab.clickSelector('[data-action="launch-game"][data-game="undercover"]');
    for (let i = 0; i < 4; i++) {
      await passTab.assertMobileErgonomics(`Undercover Peek Shield ${i + 1}`);
      await passTab.clickSelector('[data-action="uc-pass-open"]');
      await passTab.assertMobileErgonomics(`Undercover Ticket ${i + 1}`);
      await passTab.clickSelector('[data-action="uc-pass-next"]');
    }
    await passTab.assertMobileErgonomics('Undercover Discuss');
    await passTab.clickSelector('[data-action="uc-open-voting"]');
    for (let i = 0; i < 4; i++) {
      await passTab.clickSelector('[data-action="uc-pass-open"]');
      await passTab.clickSelector('[data-action="uc-pass-vote"]'); // picks first available suspect
    }
    // If Impostor was caught, handle steal phase
    const hasSteal = await passTab.eval(`Boolean(document.querySelector('[data-action="uc-steal-pick"]'))`);
    if (hasSteal) {
      await passTab.clickSelector('[data-action="uc-steal-pick"]');
    }
    await passTab.assertMobileErgonomics('Undercover Result');
    await passTab.clickSelector('[data-action="back-to-dashboard"]');
    console.log('✓ Pass-the-Phone Game 2 (Undercover Passenger) verified');

    // 1C. Hot Seat Highway (Round 1 Majority + Round 2 Spotlight)
    await passTab.clickSelector('[data-action="launch-game"][data-game="hot-seat"]');
    for (let i = 0; i < 4; i++) {
      await passTab.clickSelector('[data-action="hs-pass-open"]');
      await passTab.clickSelector('[data-action="hs-pass-majority"]');
    }
    await passTab.assertMobileErgonomics('Hot Seat R1 Reveal');
    await passTab.clickSelector('[data-action="hs-next-round"]');
    for (let i = 0; i < 4; i++) {
      await passTab.clickSelector('[data-action="hs-pass-open"]');
      await passTab.clickSelector('[data-action="hs-pass-option"][data-opt="1"]');
    }
    await passTab.assertMobileErgonomics('Hot Seat R2 Spotlight Reveal');
    await passTab.clickSelector('[data-action="back-to-dashboard"]');
    console.log('✓ Pass-the-Phone Game 3 (Hot Seat Highway) verified');

    // 1D. Vibe Check 1-10
    await passTab.clickSelector('[data-action="launch-game"][data-game="vibe-check"]');
    await passTab.clickSelector('[data-action="vc-pass-open"]');
    await passTab.clickSelector('[data-action="vc-pass-start-guessing"]');
    for (let i = 0; i < 3; i++) {
      await passTab.clickSelector('[data-action="vc-pass-open"]');
      await passTab.clickSelector('[data-action="vc-pass-dial"][data-val="7"]');
    }
    await passTab.assertMobileErgonomics('Vibe Check Reveal');
    await passTab.clickSelector('[data-action="back-to-dashboard"]');
    console.log('✓ Pass-the-Phone Game 4 (Vibe Check 1-10) verified');

    // 1E. Speed Trap
    await passTab.clickSelector('[data-action="launch-game"][data-game="speed-trap"]');
    await passTab.clickSelector('[data-action="st-start"]');
    await passTab.assertMobileErgonomics('Speed Trap Active');
    await passTab.clickSelector('[data-action="st-outcome"][data-outcome="got"]');
    await passTab.clickSelector('[data-action="st-outcome"][data-outcome="buzz"]');
    await passTab.clickSelector('[data-action="nav-back"]');
    passTab.close();
    console.log('✓ Pass-the-Phone Game 5 (Speed Trap) verified');

    // =====================================================================
    // PART 2: WIFI HOTSPOT MULTI-PHONE E2E (1 Host + 3 Passengers = 4 Phones!)
    // =====================================================================
    const host = await createNewTab(debugPort, `http://127.0.0.1:${port}/?native=1`, 'HostAPK');
    await host.clickSelector('[data-action="choose-hotspot"]');
    await host.assertMobileErgonomics('Hotspot Host Lobby');

    // Verify QR SVG is rendered on Host Lobby!
    const qrPresent = await host.eval(`Boolean(document.querySelector('.qr-wrap svg path'))`);
    if (!qrPresent) throw new Error('QR Code SVG missing in Hotspot Host Lobby!');

    const p2 = await createNewTab(debugPort, `http://127.0.0.1:${port}/`, 'Passenger2');
    const p3 = await createNewTab(debugPort, `http://127.0.0.1:${port}/`, 'Passenger3');
    const p4 = await createNewTab(debugPort, `http://127.0.0.1:${port}/`, 'Passenger4');

    for (const [idx, tab] of [[2, p2], [3, p3], [4, p4]]) {
      await tab.assertMobileErgonomics(`Passenger ${idx} Auto-Join Screen`);
      await tab.eval(`(() => {
        const inp = document.querySelector('[data-input="client-name"]');
        inp.value = 'Rider${idx}';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await tab.clickSelector('[data-action="submit-client-join"]');
    }
    await sleep(250);

    const lobbyCount = await host.eval(`document.querySelectorAll('.status-pill.done').length`);
    if (lobbyCount !== 4) throw new Error(`Expected 4 connected players in Host Lobby, got ${lobbyCount}`);
    console.log('✓ Hotspot 4-Phone Lobby (1 Host + 3 Passengers) connected via WebSocket');

    await host.clickSelector('[data-action="host-enter-dashboard"]');
    await sleep(200);

    // Launch Undercover Passenger over Hotspot & verify secret role privacy!
    await host.clickSelector('[data-action="launch-game"][data-game="undercover"]');
    await sleep(250);

    const allTabs = [host, p2, p3, p4];
    let impostorCount = 0;
    let insiderCount = 0;
    for (const t of allTabs) {
      await t.assertMobileErgonomics('Hotspot Undercover Peek');
      const txt = await t.eval(`document.body.innerText`);
      if (txt.includes('YOU ARE THE IMPOSTOR')) impostorCount++;
      else insiderCount++;
      await t.clickSelector('[data-action="uc-hotspot-ready"]');
    }
    await sleep(250);
    if (impostorCount !== 1 || insiderCount !== 3) {
      throw new Error(`Role distribution error: impostors=${impostorCount}, insiders=${insiderCount}`);
    }
    console.log('✓ Hotspot Undercover secret role isolation verified (1 Impostor + 3 Insiders)');

    // Open voting & everyone votes
    await host.clickSelector('[data-action="uc-open-voting"]');
    await sleep(200);
    for (const t of allTabs) {
      await t.clickSelector('[data-action="uc-hotspot-vote"]');
    }
    await sleep(250);
    await host.clickSelector('[data-action="nav-back"]'); // back to dashboard
    await sleep(200);

    // Launch Speed Trap over Hotspot & verify 3 distinct roles (Speaker, Road Cop Buzzer, 2 Guessers!)
    await host.clickSelector('[data-action="launch-game"][data-game="speed-trap"]');
    await sleep(200);
    await host.clickSelector('[data-action="st-start"]');
    await sleep(250);

    let buzzers = 0;
    let guessScreens = 0;
    for (const t of allTabs) {
      await t.assertMobileErgonomics('Hotspot Speed Trap Active');
      const hasBuzzer = await t.eval(`Boolean(document.querySelector('.giant-buzzer'))`);
      const isGuesser = await t.eval(`document.body.innerText.includes('SHOUT OUT GUESSES!')`);
      if (hasBuzzer) buzzers++;
      if (isGuesser) guessScreens++;
    }
    if (buzzers !== 1 || guessScreens !== 2) {
      throw new Error(`Expected 1 Cop Buzzer & 2 Guesser screens in 4p Speed Trap, got buzzers=${buzzers}, guessers=${guessScreens}`);
    }
    console.log('✓ Hotspot Speed Trap 4-phone asymmetric roles verified (1 Speaker + 1 Live Buzzer Cop + 2 Guessers)');

    // Test Passenger Tab Refresh / Reconnect Resilience!
    await p3.goto(`http://127.0.0.1:${port}/`);
    await p3.clickSelector('[data-action="submit-client-join"]');
    await sleep(250);
    const p3InGame = await p3.eval(`document.body.innerText.includes('SHOUT OUT GUESSES!') || Boolean(document.querySelector('.giant-buzzer'))`);
    if (!p3InGame) throw new Error('Passenger 3 failed to resync into active game after browser reload!');
    console.log('✓ Hotspot Passenger browser reload & state resync verified');

    allTabs.forEach((t) => t.close());
    console.log('\n🎉 ALL E2E & MOBILE VIEWPORT TESTS PASSED WITH ZERO ERRORS!');
  } finally {
    chrome.kill();
    srv.close();
    setTimeout(() => {
      try { fs.rmSync(tmpProfile, { recursive: true, force: true }); } catch (_) {}
    }, 500);
  }
}

main().catch((err) => {
  console.error('❌ E2E Verification Failed:', err);
  process.exit(1);
});
