// e2e YouTube-виджета на главной transcribevideototext.app в headless Chromium.
// Запуск: node tools/e2e_yt_widget.mjs  (сайт на http://localhost:8097, ходит в живой API yt-transcript)
import pw from '/home/client/workspace/tmp/pw/node_modules/playwright-core/index.js';
import fs from 'fs';
const { chromium } = pw;

const BASE = process.env.BASE || 'http://localhost:8097/';
const SHOTS = new URL('../.shots/yt-widget/', import.meta.url).pathname;
fs.mkdirSync(SHOTS, { recursive: true });

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };

const browser = await chromium.launch({
  executablePath: '/home/client/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell',
});

async function openPage(viewport = { width: 1280, height: 900 }, mock) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  const page = await ctx.newPage();
  await page.route(/api\.devexthub\.com/, (r) => r.abort());
  if (mock) await page.route(/\/yt\/transcript/, mock);
  await page.addInitScript(() => { window.__ev = []; window.umami = { track: (n, d) => window.__ev.push([n, d]) }; });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE);
  return { page, errors };
}
const events = (page) => page.evaluate(() => window.__ev);
async function submit(page, v) {
  await page.fill('#yt-url', v);
  await page.click('#yt-form button');
  await page.waitForSelector('#yt-done:not([hidden]), #yt-none:not([hidden]), #yt-error:not([hidden])', { timeout: 60000 });
}

// 1. Ссылка с субтитрами → текст, таймкоды, copy, .txt, .srt
{
  const { page, errors } = await openPage();
  ok(await page.locator('#yt-url').isVisible(), 'поле ссылки видно в первом экране');
  await submit(page, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s');
  const text = await page.inputValue('#yt-text');
  ok(/never gonna give you up/i.test(text), `текст получен (${text.length} симв.)`);
  ok(!/\[\d+:\d{2}\]/.test(text), 'по умолчанию без таймкодов');
  ok(/rick astley/i.test(await page.textContent('#yt-title')), 'заголовок = название видео');
  await page.screenshot({ path: `${SHOTS}/desktop-done.png` });
  await page.check('#yt-stamps');
  ok(/^\[0:0\d\] /.test(await page.inputValue('#yt-text')), 'Timestamps включают [m:ss]');
  await page.click('#yt-copy');
  ok((await page.evaluate(() => navigator.clipboard.readText())) === await page.inputValue('#yt-text'), 'Copy = текст поля');
  const [txt] = await Promise.all([page.waitForEvent('download'), page.click('#yt-txt')]);
  ok(/\.txt$/.test(txt.suggestedFilename()), `.txt: ${txt.suggestedFilename()}`);
  const [srt] = await Promise.all([page.waitForEvent('download'), page.click('#yt-srt')]);
  const s = fs.readFileSync(await srt.path(), 'utf8');
  ok(/^1\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\n/.test(s), `.srt формат: ${JSON.stringify(s.slice(0, 50))}`);
  const href = await page.getAttribute('#yt-done a.store-link', 'href');
  ok(/utm_content=yt-widget/.test(href) && /utm_source=tvt_site/.test(href), `ссылка в стор: ${href}`);
  const ev = await events(page);
  ok(ev.some(([n, d]) => n === 'yt-run' && d.result === 'ok'), 'событие yt-run ok');
  ok(ev.some(([n]) => n === 'yt-copy') && ev.filter(([n]) => n === 'yt-download').length === 2, 'события copy/download');
  ok(errors.length === 0, `без ошибок JS: ${errors.join(' | ')}`);
}

// 2. Не ссылка (живой API) → понятная ошибка
{
  const { page } = await openPage();
  await submit(page, 'how to make pancakes');
  ok(/doesn't look like a YouTube link/.test(await page.textContent('#yt-error-text')), 'мусор → bad_url текстом');
}

// 3. Нет субтитров (мок) → экран с расширением
{
  const { page } = await openPage(undefined, (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"no_captions","title":"x"}' }));
  await submit(page, 'https://youtu.be/aaaaaaaaaaa');
  ok(await page.locator('#yt-none').isVisible(), 'no_captions → экран «нет субтитров»');
  ok((await events(page)).some(([n, d]) => n === 'yt-run' && d.result === 'no_captions'), 'событие no_captions');
}

// 4. Сервер недоступен (мок)
{
  const { page } = await openPage(undefined, (r) => r.abort());
  await submit(page, 'https://youtu.be/dQw4w9WgXcQ');
  ok(/Couldn't reach our server/.test(await page.textContent('#yt-error-text')), 'сеть упала → понятная ошибка');
}

// 5. Мобильный
{
  const { page, errors } = await openPage({ width: 390, height: 844 });
  await submit(page, 'https://youtu.be/dQw4w9WgXcQ');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  ok(!overflow, 'мобильный 390: без горизонтальной прокрутки');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/mobile-done.png`, fullPage: false });
  ok(!(await page.locator('.sticky-cta.show').count()), 'плавающая кнопка не закрывает результат');
  ok(errors.length === 0, 'мобильный: без ошибок JS');
}

await browser.close();
console.log(fails ? `\n${fails} FAIL` : '\nвсё OK');
process.exit(fails ? 1 : 0);
