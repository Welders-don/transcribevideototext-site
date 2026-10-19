# Сайт продукта на своём домене (модерация monetize 15.10): копия страниц TVT с devexthub
# без навигации студии. Разовый перенос; дальше страницы правятся здесь.
import re, os, shutil
SRC = os.path.expanduser('~/projects/Devexthub-site-cab')
PRIV = os.path.expanduser('~/projects/transcribe-video-to-text-privacy/index.html')
DOM = 'https://transcribevideototext.app'
STORE = 'https://chromewebstore.google.com/detail/mgblgaahjeahphiahfakjiabnheanbhj'
SL = f'class="btn btn-sm store-link" href="{STORE}" data-umami-event="store-click" data-umami-event-ext="transcribe"'
HEADER = f'''<header class="site-head sticky">
  <div class="wrap headrow">
    <a class="brand" href="/"><span class="dot"></span>Transcribe Video to Text</a>
    <nav class="nav">
      <a href="/#how">How it works</a>
      <a href="/pricing/">Pricing</a>
      <a href="/#contact">Support</a>
      <a {SL}>Add to Chrome</a>
    </nav>
  </div>
</header>'''
FOOTER = f'''<footer class="site-foot">
  <div class="wrap">
    <a class="store-link" href="{STORE}" data-umami-event="store-click" data-umami-event-ext="transcribe">Chrome Web Store</a>
    <a href="/pricing/">Pricing</a>
    <a href="/#contact">Contact</a>
    <a href="/terms/">Terms</a>
    <a href="/refund-policy/">Refunds</a>
    <a href="/privacy-policy/">Privacy</a>
    <span style="display:block;margin-top:12px;font-size:13px;">YouTube is a trademark of Google LLC, Vimeo is a trademark of Vimeo.com, Inc. All other product names belong to their owners. Transcribe Video to Text is an independent tool, not affiliated with or endorsed by Google, YouTube or Vimeo.</span>
    <span style="display:block;margin-top:12px;">&copy; 2026 Transcribe Video to Text</span>
    <span style="display:block;margin-top:4px;font-size:13px;">Legal address: Kobaltstack LLC, 447 Broadway, 2nd Floor, 3436, New York, NY 10013, US</span>
  </div>
</footer>'''
UMAMI_OLD = 'data-domains="www.devexthub.com,devexthub.com"'
UMAMI_NEW = 'data-domains="transcribevideototext.app"'

def one(s, old, new, n=1):
    assert s.count(old) == n, (old[:60], s.count(old))
    return s.replace(old, new)

def common(s, canonical):
    s = re.sub(r'<header class="site-head.*?</header>', HEADER, s, count=1, flags=re.S)
    s = re.sub(r'<footer class="site-foot">.*?</footer>', FOOTER, s, count=1, flags=re.S)
    s = re.sub(r'<link rel="canonical" href="[^"]*">', f'<link rel="canonical" href="{canonical}">', s)
    s = re.sub(r'href="(\.\./)+styles\.css"', 'href="/styles.css"', s)
    s = re.sub(r'(src|href)="(\.\./)+assets/', r'\1="/assets/', s)
    s = s.replace(' | Devexthub</title>', '</title>')
    s = s.replace(UMAMI_OLD, UMAMI_NEW)
    s = s.replace('href="../terms/"', 'href="/terms/"').replace('href="../refund-policy/"', 'href="/refund-policy/"')
    s = s.replace('href="../../terms/"', 'href="/terms/"').replace('href="../../refund-policy/"', 'href="/refund-policy/"')
    s = s.replace('href="../privacy-policy/"', 'href="/privacy-policy/"').replace('href="../../privacy-policy/"', 'href="/privacy-policy/"')
    s = s.replace('href="../transcribe-video-to-text/pricing/"', 'href="/pricing/"')
    assert 'Devexthub</a>' not in s and 'All tools' not in s
    return s

def write(path, s):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    open(path, 'w').write(s)

# Главная. canonical остаётся на devexthub: SEO-история там, тут копия для покупателей и модерации.
s = open(f'{SRC}/transcribe-video-to-text/index.html').read()
s = common(s, 'https://www.devexthub.com/transcribe-video-to-text/')
s = re.sub(r'\s*<section class="section reveal" id="guides">.*?</section>', '', s, count=1, flags=re.S)
s = s.replace(',"publisher":{"@id":"https://www.devexthub.com/#organization"}', '')
s = s.replace('"url":"https://www.devexthub.com/transcribe-video-to-text/"', f'"url":"{DOM}/"')
s = s.replace('https://www.devexthub.com/assets/tvt-og.jpg', f'{DOM}/assets/tvt-og.jpg')
s = one(s, 'var src = /\\/\\/(www\\.)?devexthub\\.com\\/app(\\/|\\?|#|$)/.test(document.referrer) ? "devexthub_app" : "devexthub_landing";',
        'var src = "tvt_site";')
s = s.replace('// as "devexthub_landing" in the CWS developer dashboard sources.', '// as "tvt_site" in the CWS developer dashboard sources.')
s = s.replace('category: "general", pageUrl: location.href', 'category: "support", pageUrl: location.href')
s = s.replace('href="pricing/"', 'href="/pricing/"')
write('index.html', s)

# Цены, условия, возвраты: на своём домене это и есть официальные страницы.
for src, dst in [('transcribe-video-to-text/pricing/index.html', 'pricing/index.html'),
                 ('terms/index.html', 'terms/index.html'), ('refund-policy/index.html', 'refund-policy/index.html')]:
    s = open(f'{SRC}/{src}').read()
    s = common(s, f'{DOM}/{os.path.dirname(dst)}/')
    s = s.replace('href="../"', 'href="/"')
    write(dst, s)

# Политика: та же, что в CWS (transcribe-video-to-text-privacy), сайт продукта вместо devexthub.
s = open(PRIV).read()
s = one(s, '<a href="https://www.devexthub.com/transcribe-video-to-text/">devexthub.com/transcribe-video-to-text</a>',
        f'<a href="{DOM}/">transcribevideototext.app</a>')
s = s.replace('&copy; 2026 Devexthub. ', '&copy; 2026 Transcribe Video to Text. ')
write('privacy-policy/index.html', s)

# Кабинет (16.10, модерация monetize: оплата, Manage subscription и Contact support на домене продукта).
# API на api.<домен>: кука сессии ставится на .transcribevideototext.app (site.js по Host).
API_OLD, API_NEW = 'https://transcribe.devexthub.com:8443', 'https://api.transcribevideototext.app:8443'
s = open(f'{SRC}/app/index.html').read()
s = one(s, '<a class="brand" href="/" target="_blank" rel="noopener"><span class="dot"></span>Devexthub</a>',
        '<a class="brand" href="/" target="_blank" rel="noopener"><span class="dot"></span>Transcribe Video to Text</a>')
s = one(s, 'href="/transcribe-video-to-text/" target="_blank" rel="noopener" data-i18n="cta_how"', 'href="/#how" target="_blank" rel="noopener" data-i18n="cta_how"')
# Соседние продукты остаются воронкой, но ведут на devexthub (у этого сайта своих страниц нет).
for slug in ['pdf-to-excel', 'extract-text-from-image', 'image-enhancer', 'convert-mov-to-mp4']:
    s = one(s, f'class="xp-card" href="/{slug}/"', f'class="xp-card" href="https://www.devexthub.com/{slug}/"')
s = re.sub(r'<footer class="site-foot">.*?</footer>', FOOTER, s, count=1, flags=re.S)
s = s.replace(UMAMI_OLD, UMAMI_NEW).replace(' — Devexthub</title>', ' — Transcribe Video to Text</title>')
write('app/index.html', s)
s = open(f'{SRC}/app/app.js').read()
s = one(s, API_OLD, API_NEW, 2)
s = one(s, "compare.href = '/transcribe-video-to-text/pricing/'", "compare.href = '/pricing/'")
write('app/app.js', s)
s = open(f'{SRC}/app/i18n.js').read()
s = s.replace(' — Devexthub', ' — Transcribe Video to Text').replace('team@devexthub.com', 'support@transcribevideototext.app')
write('app/i18n.js', s)
shutil.copy(f'{SRC}/app/app.css', 'app/app.css')

# Почта продукта: пересылка Dynadot support@ → team@devexthub.com (проверено Денисом 16.10).
for root, _, files in os.walk('.'):
    for f in files:
        if f.endswith('.html') and '.git' not in root:
            fp = os.path.join(root, f); t = open(fp).read()
            open(fp, 'w').write(t.replace('team@devexthub.com', 'support@transcribevideototext.app'))

shutil.copy(f'{SRC}/styles.css', 'styles.css')
os.makedirs('assets', exist_ok=True)
for a in ['pdf-to-excel-icon-128.png', 'extract-text-icon-128.png', 'image-enhancer-icon-128.png', 'convert-mov-icon-128.png', 'logo-mark.svg', 'logo-mark-32.png', 'logo-mark-180.png', 'tvt-demo.jpg', 'tvt-platforms.jpg', 'tvt-og.jpg']:
    shutil.copy(f'{SRC}/assets/{a}', f'assets/{a}')
write('CNAME', 'transcribevideototext.app')
write('.nojekyll', '')
write('robots.txt', f'User-agent: *\nAllow: /\nSitemap: {DOM}/sitemap.xml\n')
write('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + ''.join(f'  <url><loc>{DOM}/{p}</loc></url>\n' for p in ['pricing/', 'terms/', 'refund-policy/', 'privacy-policy/']) + '</urlset>\n')
print('built')
