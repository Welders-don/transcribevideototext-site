// YouTube-транскрипт по ссылке на главной. Субтитры достаёт наш сервис yt-transcript
// (Capitan/yt-transcript, yt-dlp на IONOS): браузер со страницы сайта в YouTube не пускают.
const API = 'https://api.transcribevideototext.app:8443/yt/transcript?v=';

const $ = (id) => document.getElementById(id);
const form = $('yt-form');
const url = $('yt-url');
const out = $('yt-text');
const stamps = $('yt-stamps');
const states = ['yt-busy', 'yt-done', 'yt-none', 'yt-error'];
let data = null;

function show(id) {
  states.forEach((s) => { $(s).hidden = s !== id; });
}

function track(name, props) {
  if (window.umami && typeof window.umami.track === 'function') window.umami.track(name, props);
}

function clock(sec, srt) {
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = Math.floor(sec % 60);
  const p = (n) => String(n).padStart(2, '0');
  if (srt) return `${p(h)}:${p(m)}:${p(s)},${String(Math.round((sec % 1) * 1000)).padStart(3, '0')}`;
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

// Без таймкодов: абзац рвётся на паузе больше 2 с или после ~600 символов на конце фразы.
function plain(segs) {
  const paras = [];
  let cur = '';
  segs.forEach((s, i) => {
    cur += (cur ? ' ' : '') + s.text;
    const next = segs[i + 1];
    const gap = next ? next.start - (s.start + s.dur) : 0;
    if (!next || gap > 2 || (cur.length > 600 && /[.!?]$/.test(s.text))) {
      paras.push(cur);
      cur = '';
    }
  });
  return paras.join('\n\n');
}

function render() {
  out.value = stamps.checked
    ? data.segments.map((s) => `[${clock(s.start)}] ${s.text}`).join('\n')
    : plain(data.segments);
}

function srt(segs) {
  return segs.map((s, i) => {
    const end = s.dur ? s.start + s.dur : (segs[i + 1] ? segs[i + 1].start : s.start + 2);
    return `${i + 1}\n${clock(s.start, true)} --> ${clock(end, true)}\n${s.text}\n`;
  }).join('\n');
}

function save(text, ext) {
  const name = (data.title || data.id).replace(/[\\/:*?"<>|]+/g, '').slice(0, 80).trim() || data.id;
  const href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = href;
  a.download = `${name}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  track('yt-download', { fmt: ext });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = url.value.trim();
  if (!v) return;
  show('yt-busy');
  const t0 = Date.now();
  let res, body;
  try {
    res = await fetch(API + encodeURIComponent(v));
    body = await res.json();
  } catch (err) {
    $('yt-error-text').textContent = "Couldn't reach our server. Check your connection and try again.";
    show('yt-error');
    track('yt-run', { result: 'network' });
    return;
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  if (res.ok) {
    data = body;
    $('yt-title').textContent = body.title || 'Transcript';
    const words = body.segments.reduce((n, s) => n + s.text.split(/\s+/).length, 0);
    $('yt-meta').textContent = `${words.toLocaleString('en-US')} words · ${body.kind === 'auto' ? 'auto-generated' : "creator's"} captions · ${body.lang}`;
    render();
    show('yt-done');
    track('yt-run', { result: 'ok', kind: body.kind, lang: body.lang, secs });
    return;
  }
  const code = body && body.error;
  if (code === 'no_captions') {
    show('yt-none');
    track('yt-run', { result: 'no_captions', secs });
    return;
  }
  const msg = {
    bad_url: "That doesn't look like a YouTube link. Paste the address of a video, like youtube.com/watch?v=… or youtu.be/…",
    unavailable: 'This video is private, removed or age-restricted, so its captions are not available.',
    rate_limited: "You've fetched a lot of transcripts in the last hour. Please try again a bit later.",
  }[code] || 'YouTube did not answer this time. Please try again in a minute.';
  $('yt-error-text').textContent = msg;
  show('yt-error');
  track('yt-run', { result: code || String(res.status), secs });
});

stamps.addEventListener('change', render);
$('yt-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(out.value);
  } catch (e) {
    out.select();
    document.execCommand('copy');
  }
  $('yt-copy').textContent = 'Copied';
  setTimeout(() => { $('yt-copy').textContent = 'Copy'; }, 1500);
  track('yt-copy');
});
$('yt-txt').addEventListener('click', () => save(out.value, 'txt'));
$('yt-srt').addEventListener('click', () => save(srt(data.segments), 'srt'));
