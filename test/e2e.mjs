// لعبة كاملة بأربع متصفحات: رئيسين + عميلين. التشغيل: npm run e2e
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const PORT = 3123;
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOTS_DIR || 'test/screenshots';
mkdirSync(SHOTS, { recursive: true });

const srv = process.env.BASE_URL ? { kill() {} } : spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' }, stdio: 'inherit' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!process.env.BASE_URL) for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/health'); break; } catch { await sleep(100); } }

const browser = await chromium.launch();
const phone = devices['iPhone 13'];
async function player(name) {
  const ctx = await browser.newContext({ ...phone });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.error(name, 'pageerror', e); process.exitCode = 1; });
  return { name, page };
}
async function enterName(p) {
  await p.page.waitForSelector('#nameInput', { state: 'visible' });
  await p.page.fill('#nameInput', p.name);
  await p.page.click('#nameForm button[type=submit]');
  await p.page.waitForSelector('#nameModal', { state: 'hidden' });
}

try {
  const host = await player('سارة');
  await host.page.goto(BASE);
  await host.page.screenshot({ path: `${SHOTS}/01-home.png` });
  await host.page.click('#create');
  await host.page.waitForURL(/\/r\/[A-Z0-9]{6}$/);
  const url = host.page.url();
  await enterName(host);

  const others = [await player('خالد'), await player('نورة'), await player('فهد')];
  for (const p of others) { await p.page.goto(url); await enterName(p); }
  const all = [host, ...others];

  // الأدوار: سارة رئيس أحمر، خالد عميل أحمر، نورة رئيس أزرق، فهد عميل أزرق
  const setRole = async (p, team, role) => {
    const btn = p.page.locator(`#lobbyTeams [data-join="${team}"][data-role="${role}"]`);
    if (await btn.count()) await btn.first().click();
    await sleep(150);
  };
  await setRole(host, 'red', 'spymaster');
  await setRole(others[0], 'red', 'operative');
  await setRole(others[1], 'blue', 'spymaster');
  await setRole(others[2], 'blue', 'operative');
  await sleep(300);
  await host.page.screenshot({ path: `${SHOTS}/02-lobby.png`, fullPage: true });
  await host.page.click('#startBtn');
  await host.page.waitForSelector('#board .card');
  await sleep(300);

  // التحقق: العميل ما يشوف ألوان
  const leak = await others[0].page.locator('#board .card[class*="key-"]').count();
  if (leak) throw new Error('العميل يشوف المفتاح!');
  const spyKeys = await host.page.locator('#board .card[class*="key-"]').count();
  if (spyKeys !== 25) throw new Error('رئيس الجواسيس ما يشوف المفتاح كامل: ' + spyKeys);

  const roles = { red: { spy: host, op: others[0] }, blue: { spy: others[1], op: others[2] } };
  await host.page.screenshot({ path: `${SHOTS}/03-spymaster.png`, fullPage: true });

  let turns = 0;
  let n = 0;
  while (turns++ < 30) {
    const statusOver = await host.page.locator('#winner:not(.hidden)').count();
    if (statusOver) break;
    // مين دوره؟
    const turn = await host.page.locator('#gameTeams .team.active').getAttribute('class').then((c) => (c.includes('red') ? 'red' : 'blue'));
    const { spy, op } = roles[turn];
    await spy.page.waitForSelector('#clueForm');
    await spy.page.fill('#clueWord', 'تلميح' + 'ـ'.repeat(0) + ['أ','ب','ت','ث','ج','ح','خ','د','ذ','ر','ز','س','ش','ص','ض','ط','ظ','ع','غ','ف','ق','ك','ل','م','ن','ه','و','ي','ء','ئ'][n++ % 30] + 'ق');
    await spy.page.selectOption('#clueNum', '2');
    await spy.page.click('#clueForm button');
    await op.page.waitForSelector('#board .card.clickable');
    if (turns === 1) await op.page.screenshot({ path: `${SHOTS}/04-operative-guessing.png`, fullPage: true });
    // العميل يختار بطاقة فريقه حسب مفتاح رئيسه (للاختبار)، وفي الدور الثالث يختار محايدة
    const idxs = await spy.page.$$eval('#board .card', (els, t) => els.map((e, i) => (e.classList.contains('key-' + t) && !e.classList.contains('revealed') ? i : -1)).filter((i) => i >= 0), turn);
    const target = idxs[0];
    await op.page.locator(`#board .card[data-i="${target}"]`).click();
    await op.page.locator(`#board [data-reveal="${target}"]`).click();
    await sleep(250);
    const over = await op.page.locator('#winner:not(.hidden)').count();
    if (over) break;
    if (await op.page.locator("#passBtn:not([disabled])").count()) { await op.page.click("#passBtn"); await sleep(250); }
  }
  await sleep(300);
  const banner = await host.page.locator('#winner').textContent();
  if (!banner.includes('فاز')) throw new Error('اللعبة ما انتهت');
  console.log('✅ انتهت اللعبة:', banner.trim(), 'بعد', turns, 'دور');
  await others[0].page.screenshot({ path: `${SHOTS}/05-game-over.png`, fullPage: true });

  // QR
  const qrOk = await host.page.evaluate(async (u) => { const r = await fetch(u); return r.ok && (await r.text()).includes('<svg'); }, url.replace('/r/', '/qr/') + '.svg');
  if (!qrOk) throw new Error('QR فشل');
  console.log('✅ QR يعمل');

  // إعادة الاتصال: إعادة تحميل الصفحة ترجع نفس اللاعب
  await others[2].page.reload();
  await others[2].page.waitForSelector('#board .card');
  const names = await others[2].page.locator('.pill.me').allTextContents();
  if (!names.some((t) => t.includes('فهد'))) throw new Error('إعادة الاتصال فشلت');
  console.log('✅ إعادة الاتصال تعمل');
} catch (e) {
  console.error('❌', e);
  process.exitCode = 1;
} finally {
  await browser.close();
  srv.kill();
}
