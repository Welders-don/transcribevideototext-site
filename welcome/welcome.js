// Онбординг Капитана на сайте (с 1.3.8, Денис 31.10): после установки расширение открывает
// эту страницу вместо своей onboarding.html, чтобы каждая установка была заходом на .app.
// Вёрстка 1:1 как в расширении (extension-src/onboarding/onboarding.html), тексты берём
// у самого расширения через externally_connectable: у него язык Chrome юзера и все переводы.
// Расширение не ответило (зашли не из него, другой браузер): английский из вёрстки.
// Umami здесь нет: страница открывается сама после установки, счёт ведёт расширение
// (onboarding_shown / onboarding_done с site:true), как у welcome Image Enhancer.
const EXT = new URLSearchParams(location.search).get('x') || 'mgblgaahjeahphiahfakjiabnheanbhj';

function show() { document.documentElement.classList.remove('wait'); }
setTimeout(show, 1500); // молчащее расширение не должно оставить пустую страницу

function ask(msg) {
  return new Promise(resolve => {
    if (!window.chrome?.runtime?.sendMessage) return resolve(null);
    try {
      chrome.runtime.sendMessage(EXT, msg, r => resolve(chrome.runtime.lastError ? null : r));
    } catch { resolve(null); }
  });
}

const titleKey = document.documentElement.dataset.i18nTitle;
const keys = [...new Set([...document.querySelectorAll('[data-i18n]')].map(el => el.dataset.i18n))];
ask({ type: 'WELCOME_OPEN', keys: [...keys, titleKey] }).then(r => {
  if (r && r.strings) {
    for (const el of document.querySelectorAll('[data-i18n]')) {
      const msg = r.strings[el.dataset.i18n];
      if (msg) el.textContent = msg;
    }
    if (r.strings[titleKey]) document.title = r.strings[titleKey];
    if (r.lang) document.documentElement.lang = r.lang;
  }
  show();
});

// Кнопка «Попробовать на YouTube» остаётся обычной ссылкой, клик только считаем.
for (const cta of document.querySelectorAll('.cta-btn')) {
  cta.addEventListener('click', () => ask({ type: 'WELCOME_CTA', place: cta.dataset.place || 'bottom' }));
}
