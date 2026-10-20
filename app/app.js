/* Кабинет /app. Данные берём у бэкенда Капитана, живём на куке dvx_sid.
   Вход: ?state=<nonce> из расширения (билет) + ?t=<id> — какой транскрипт открыть. */

(function () {
  var API = 'https://api.transcribevideototext.app:8443/api/site';

  var el = {
    loading: document.getElementById('loading'),
    empty: document.getElementById('empty'),
    signinEmpty: document.getElementById('signinEmpty'),
    signinEmptyMsg: document.getElementById('signinEmptyMsg'),
    emptyNew: document.getElementById('emptyNew'),
    emptyBack: document.getElementById('emptyBack'),
    emptyCta: document.getElementById('emptyCta'),
    app: document.getElementById('app'),
    list: document.getElementById('list'),
    detail: document.getElementById('detail'),
    retention: document.getElementById('retention'),
    planLine: document.getElementById('planLine'),
    supportBox: document.getElementById('supportBox'),
    billingNote: document.getElementById('billingNote'),
    upgrade: document.getElementById('upgrade'),
    signin: document.getElementById('signin'),
    earlierNote: document.getElementById('earlierNote'),
  };

  var state = { items: [], gateAfter: 3, used: 0, minChars: 500, signedIn: false, openId: null, days: 30, daysSignedIn: 90,
                quota: 6, windowUsed: 0, nextReset: null, clientId: null, email: null, noStamps: false };
  var t = window.I18N.t;

  function api(path, opts) {
    return fetch(API + path, Object.assign({ credentials: 'include' }, opts || {}));
  }

  // Отметка «на этом браузере уже входили». Отпечаток для этого не годится: он плывёт
  // после обновления Chrome и совпадает у разных людей, поэтому в SAME_ACCOUNT его нет.
  var SEEN_KEY = 'dvx_signed_before';

  function wasSignedBefore() {
    try { return localStorage.getItem(SEEN_KEY) === '1'; } catch (e) { return false; }
  }

  function rememberSignedIn() {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* приватный режим — не беда */ }
  }

  function show(which) {
    el.loading.classList.toggle('hidden', which !== 'loading');
    el.empty.classList.toggle('hidden', which !== 'empty');
    el.app.classList.toggle('hidden', which !== 'app');
    // Вернувшемуся не нужны ни «что это за страница», ни кнопка «установить расширение» —
    // он всё это знает, ему нужен только вход.
    if (which === 'empty') {
      var back = wasSignedBefore();
      el.emptyNew.classList.toggle('hidden', back);
      el.emptyBack.classList.toggle('hidden', !back);
      el.emptyCta.classList.toggle('hidden', back);
    }
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' +
           d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  /* В базе транскрипт лежит одной строкой: расширение склеивает сегменты через пробел
     перед отправкой. Пока в записи нет сегментов, режем текст на абзацы сами —
     иначе это стена в 56 тысяч знаков без единого перевода строки (жалоба Дениса 19.09). */
  function sentences(text) {
    // Intl.Segmenter знает границы предложений в китайском и японском, где точки другие
    // и пробелов нет. Регулярка — запасной путь для браузеров постарше.
    if (window.Intl && Intl.Segmenter) {
      try {
        var seg = new Intl.Segmenter(window.I18N.lang, { granularity: 'sentence' });
        return [...seg.segment(String(text || ''))].map(function (s) { return s.segment; });
      } catch (e) { /* падаем на регулярку */ }
    }
    return String(text || '').split(/(?<=[.!?…。！？])\s+/);
  }

  function paragraphs(text) {
    var parts = sentences(text);
    var out = [];
    var cur = '';
    for (var i = 0; i < parts.length; i++) {
      cur += (cur ? ' ' : '') + parts[i];
      if (cur.length >= 420) { out.push(cur); cur = ''; }
    }
    if (cur) out.push(cur);
    return out;
  }

  /* Сегменты приходят по 3-5 секунд (у часового видео их под две тысячи), и строка на
     каждый — нечитаемо. Собираем в абзацы ровно по тем же правилам, что панель
     расширения в groupSegments: режем на конце предложения после 150 знаков, по паузе
     длиннее 8 секунд или по 300 знакам. Таймкод — начало абзаца. */
  function groupSegments(segs) {
    var out = [];
    var cur = null;
    var endsSentence = function (s) { return /[.?!…。！？]$/.test(s.replace(/\s+$/, '')); };

    segs.forEach(function (s) {
      var text = String(s.text || '').trim();
      if (!text) return;
      if (!cur) { cur = { t: s.t, text: text, end: s.t, s: s.s }; return; }

      var gap = s.t - cur.end;
      // смена говорящего рвёт абзац так же, как длинная пауза: иначе реплики двух людей
      // склеиваются в один кусок и метка врёт
      var speakerChanged = s.s != null && cur.s != null && s.s !== cur.s;
      if ((cur.text.length > 150 && endsSentence(cur.text)) || gap > 8 || cur.text.length > 300 || speakerChanged) {
        out.push(cur);
        cur = { t: s.t, text: text, end: s.t, s: s.s };
      } else {
        cur.text += ' ' + text;
        cur.end = s.t;
        if (cur.s == null) cur.s = s.s;
      }
    });

    if (cur) out.push(cur);
    return out;
  }

  function fmtTime(sec) {
    // floor, а не round: таймкод должен указывать на момент, который УЖЕ прозвучал,
    // иначе 75.5 сек показывается как 1:16 и перескакивает реплику
    var s = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var r = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(r).padStart(2, '0');
  }

  function fmtDur(sec) {
    if (!sec) return '';
    return t('minutes', { n: Math.round(sec / 60) });
  }

  /* ---------- список ---------- */

  function renderList() {
    el.list.textContent = '';
    if (!state.items.length) {
      var p = document.createElement('p');
      p.className = 'muted';
      p.style.padding = '16px';
      p.textContent = t('list_empty');
      el.list.appendChild(p);
      return;
    }

    state.items.forEach(function (it) {
      var btn = document.createElement('button');
      btn.className = 'item' + (it.id === state.openId ? ' on' : '');
      btn.type = 'button';

      var meta = document.createElement('div');
      meta.className = 'meta';
      var left = document.createElement('span');
      left.textContent = (it.platform || 'other') + ' · ' + fmtDate(it.created_at);
      var right = document.createElement('span');
      right.textContent = it.has_summary ? t('has_summary') : fmtDur(it.duration_sec);
      if (it.has_summary) right.className = 'dot-sum';
      meta.appendChild(left);
      meta.appendChild(right);

      var prev = document.createElement('div');
      prev.className = 'prev';
      prev.textContent = it.preview || '';

      btn.appendChild(meta);
      btn.appendChild(prev);
      btn.addEventListener('click', function () { open(it.id); });
      el.list.appendChild(btn);
    });
  }

  /* ---------- один транскрипт ---------- */

  function open(id, autoSummary) {
    state.openId = id;
    renderList();
    el.detail.textContent = '';
    var wait = document.createElement('p');
    wait.className = 'muted';
    wait.textContent = t('loading_short');
    el.detail.appendChild(wait);

    api('/transcriptions/' + id)
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (data) {
        // Старые саммари с меткой «Gist:» из промпта (сервер срезает с 06.10, в базе остались).
        if (data.summary_text) data.summary_text = data.summary_text.replace(/^\s*(?:\S{1,3}\s+)?(?:one[- ]sentence\s+)?gist\w{0,2}\s*:\s*/i, '');
        renderDetail(data);
        if (autoSummary && !data.summary_text) summarize(id);
      })
      .catch(function () {
        el.detail.textContent = '';
        var p = document.createElement('p');
        p.className = 'err';
        p.textContent = t('load_fail');
        el.detail.appendChild(p);
      });
  }

  function renderDetail(data) {
    el.detail.textContent = '';

    // Заголовок появился только в записях с 1.2.8 — у прежних названия взять неоткуда,
    // и тогда шапка остаётся как была, без пустой строки (запрос Дениса 19.09).
    if (data.title) {
      var h = document.createElement('h2');
      h.className = 'detail-title';
      h.textContent = data.title;
      el.detail.appendChild(h);
    }

    var head = document.createElement('div');
    head.className = 'detail-head';

    var meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = (data.platform || 'other') + ' · ' + fmtDate(data.created_at) +
                       (data.duration_sec ? ' · ' + fmtDur(data.duration_sec) : '');

    var actions = document.createElement('div');
    actions.className = 'actions';

    // Огрызок в пару фраз саммари не улучшит (аудит 24.09) — вместо кнопки честная подсказка.
    if (!data.summary_text && (data.transcript_text || '').length < state.minChars) {
      var short = document.createElement('span');
      short.className = 'muted small-note';
      short.textContent = t('too_short');
      actions.appendChild(short);
    } else if (!data.summary_text) {
      var sumBtn = document.createElement('button');
      sumBtn.className = 'btn small js-sum';
      sumBtn.type = 'button';
      sumBtn.textContent = t('summarize');
      var badge = document.createElement('span');
      badge.className = 'beta';
      badge.textContent = t('beta');
      sumBtn.appendChild(badge);
      sumBtn.addEventListener('click', function () { summarize(data.id); });
      actions.appendChild(sumBtn);
    }

    // Выбор вида выгрузки есть у конкурента и оказался нужен (Денис, 19.09).
    // Показываем только там, где он что-то меняет — то есть когда таймкоды вообще есть.
    if (data.segments && data.segments.length) {
      var lab = document.createElement('label');
      lab.className = 'stamp-toggle';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !state.noStamps;
      cb.addEventListener('change', function () {
        state.noStamps = !cb.checked;
        try { localStorage.setItem('dvx_no_stamps', state.noStamps ? '1' : ''); } catch (e) {}
      });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(' ' + t('with_stamps')));
      actions.appendChild(lab);
    }

    // Конспект «Study notes» на месте причёски (10.10: причёску взял 1 живой из 58 нажавших
    // Summarize). Отдельной кнопкой рядом с саммари, без «beta»: она говорит «может не сработать».
    // Подпись под шапкой объясняет отличие от саммари. Старый сервер блока notes не отдаёт: кнопки нет.
    var pitch = null;
    if (state.notesOn && !data.notes_text && (data.transcript_text || '').length >= state.minChars) {
      var notesBtn = document.createElement('button');
      notesBtn.className = 'btn small js-notes';
      notesBtn.type = 'button';
      notesBtn.textContent = '📝 ' + t('tab_notes');
      pitch = document.createElement('p');
      pitch.className = 'muted small-note notes-pitch';
      // Без имени кнопки подпись читалась как пояснение к саммари: она стоит под ним (Денис, 10.10).
      var pitchName = document.createElement('b');
      pitchName.textContent = '📝 ' + t('tab_notes');
      pitch.appendChild(pitchName);
      pitch.appendChild(document.createTextNode(' · ' + t('notes_pitch')));
      notesBtn.addEventListener('click', function () { makeNotes(data, notesBtn, pitch); });
      actions.appendChild(notesBtn);
    }

    actions.appendChild(downloadBtn('TXT', data, 'txt'));
    actions.appendChild(downloadBtn('Word', data, 'doc'));

    head.appendChild(meta);
    head.appendChild(actions);
    el.detail.appendChild(head);
    if (pitch) el.detail.appendChild(pitch);

    if (data.summary_text) notesUnder(el.detail.appendChild(summaryBlock(data.summary_text, data.id, data.summary_vote)));

    var body = document.createElement('div');
    body.className = 'js-body';
    body.appendChild(data.notes_text ? viewTabs(data) : transcriptBlock(data));
    el.detail.appendChild(body);
  }

  /* ---------- Study notes (конспект, 10.10) ---------- */

  // Вкладки появляются, только когда конспект уже есть: он открыт первым, транскрипт рядом.
  // До этого на месте вкладки кнопка в ряду действий.
  function viewTabs(data) {
    var wrap = document.createElement('div');
    var bar = document.createElement('div');
    bar.className = 'tabs';
    bar.setAttribute('role', 'tablist');

    var tabT = tabBtn(t('tab_transcript'), false);
    var tabN = tabBtn(t('tab_notes'), true);
    bar.appendChild(tabT);
    bar.appendChild(tabN);

    var paneT = transcriptBlock(data);
    var paneN = notesBlock(data);
    paneT.classList.add('hidden');

    tabT.addEventListener('click', function () { select(tabT, tabN, paneT, paneN); });
    tabN.addEventListener('click', function () { select(tabN, tabT, paneN, paneT); });

    wrap.appendChild(bar);
    wrap.appendChild(paneT);
    wrap.appendChild(paneN);
    return wrap;
  }

  function tabBtn(label, on) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab' + (on ? ' on' : '');
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.textContent = label;
    return b;
  }

  function select(onTab, offTab, onPane, offPane) {
    onTab.classList.add('on');
    onTab.setAttribute('aria-selected', 'true');
    offTab.classList.remove('on');
    offTab.setAttribute('aria-selected', 'false');
    onPane.classList.remove('hidden');
    offPane.classList.add('hidden');
  }

  // Метки Overview / Key takeaways / Terms сервер пишет по-английски (Haiku их не переводит),
  // здесь они на языке интерфейса. Тот же текст уходит в копию и в файл.
  var NOTE_LABELS = { 'Overview': 'notes_overview', 'Key takeaways': 'notes_takeaways', 'Terms': 'notes_terms' };

  function notesText(text) {
    return text.replace(/^(Overview|Key takeaways|Terms):[ \t]*$/gm, function (m, k) { return t(NOTE_LABELS[k]) + ':'; });
  }

  function notesBlock(data) {
    var text = notesText(data.notes_text);
    var box = document.createElement('div');
    var body = document.createElement('div');
    body.className = 'notes';
    data.notes_text.split('\n').forEach(function (line) {
      line = line.trim();
      if (!line) return;
      var label = /^(Overview|Key takeaways|Terms):$/.exec(line);
      var topic = /^\((\d{1,2}:\d{2}(?::\d{2})?)\)\s*(.*)$/.exec(line);
      var row;
      if (label) {
        row = document.createElement('h3');
        row.textContent = t(NOTE_LABELS[label[1]]);
      } else if (topic) {
        row = document.createElement('h4');
        var time = document.createElement('span');
        time.className = 'seg-time';
        time.textContent = topic[1];
        row.appendChild(time);
        row.appendChild(document.createTextNode(topic[2]));
      } else {
        row = document.createElement('p');
        row.textContent = line;
      }
      body.appendChild(row);
    });
    box.appendChild(body);

    var dl = document.createElement('button');
    dl.className = 'btn ghost small';
    dl.type = 'button';
    dl.textContent = t('notes_download');
    dl.addEventListener('click', function () {
      var blob = new Blob(
        [(data.title ? data.title + '\n' + fmtDate(data.created_at) + '\n\n' : '') + text],
        { type: 'text/plain;charset=utf-8' }
      );
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'transcript-' + data.id + '-notes.txt';
      a.click();
      URL.revokeObjectURL(url);
      sendFeedback(data.id, 'download', '/notes/feedback');
    });
    box.appendChild(summaryFoot(text, data.id, data.notes_vote, '/notes/feedback', dl));
    return box;
  }

  // Конспект предлагаем под готовым саммари (13.10: из 59 дошедших из панели саммари взяли 28,
  // кнопку конспекта в ряду с TXT/Word нажал 1). Саммари из панели стартует само, и человек,
  // получив его, уходит: предложение «подробнее» должно стоять там, куда он смотрит.
  function notesUnder(summaryEl) {
    var btn = el.detail.querySelector('.js-notes');
    var pitch = el.detail.querySelector('.notes-pitch');
    if (!btn || !pitch) return;
    pitch.textContent = '';
    pitch.className = 'notes-cta';
    pitch.appendChild(btn);
    var why = document.createElement('span');
    why.className = 'muted';
    why.textContent = t('notes_pitch');
    pitch.appendChild(why);
    summaryEl.parentNode.insertBefore(pitch, summaryEl.nextSibling);
  }

  function makeNotes(data, btn, pitch) {
    // Клик по кнопке = спрос, пишем до генерации: так в дайджесте видны и те,
    // кто упёрся в лимит или не дождался.
    api('/notes/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcription_id: data.id }),
    }).catch(function () {});

    btn.disabled = true;
    btn.textContent = t('summarizing_btn');
    var body = el.detail.querySelector('.js-body');
    var placeholder = document.createElement('div');
    placeholder.className = 'summary working';
    var label = document.createElement('div');
    label.textContent = t('notes_working');
    var bar = document.createElement('div');
    bar.className = 'progress';
    bar.appendChild(document.createElement('span'));
    var hint = document.createElement('div');
    hint.className = 'muted hint';
    hint.textContent = t('summarizing_hint');
    placeholder.appendChild(label);
    placeholder.appendChild(bar);
    placeholder.appendChild(hint);
    el.detail.insertBefore(placeholder, body);

    api('/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcription_id: data.id }),
    })
      .then(function (r) {
        if (r.status === 422) throw 'SHORT';
        if (r.status === 402) return r.json().then(function (d) {
          if (d && d.next_reset) state.notesNext = d.next_reset;
          throw (d && d.error === 'QUOTA') ? 'QUOTA' : 'GATE';
        });
        if (!r.ok) throw 'FAIL';
        return r.json();
      })
      .then(function (d) {
        data.notes_text = d.text;
        placeholder.remove();
        btn.remove();
        if (pitch) pitch.remove();
        body.textContent = '';
        body.appendChild(viewTabs(data));
        var item = state.items.filter(function (i) { return i.id === data.id; })[0];
        if (item) item.has_notes = true;
      })
      .catch(function (why) {
        el.detail.replaceChild(
          why === 'GATE' ? gateBlock(t('notes_gate_title', { n: state.notesGate }))
            : why === 'QUOTA' ? quotaBlock(t('notes_quota_title'), t('notes_quota_body', { date: fmtDay(state.notesNext) }))
            : why === 'SHORT' ? noteBlock(t('notes_too_short'))
            : failBlock(t('notes_fail')),
          placeholder
        );
        // сбой лечится повтором, лимит и длина — нет
        if (why === 'FAIL') {
          btn.disabled = false;
          btn.textContent = '📝 ' + t('tab_notes');
        } else {
          btn.remove();
          if (pitch) pitch.remove();
        }
      });
  }

  /* Две дороги: у новых записей есть сегменты с таймкодами — показываем как в панели;
     у старых их нет, и текст режется на абзацы на лету. */
  /* Метка говорящего только при смене (Денис 06.10: «Speaker 4» на каждом абзаце монолога
     выглядит как поломка). Один говорящий на всю запись: меток нет вовсе. */
  function speakerMarks(groups) {
    var seen = {};
    groups.forEach(function (p) { if (p.s != null) seen[p.s] = 1; });
    groups.multi = Object.keys(seen).length > 1;
    var prev = null;
    groups.forEach(function (p) {
      p.mark = groups.multi && p.s != null && p.s !== prev;
      if (p.s != null) prev = p.s;
    });
    return groups;
  }

  function transcriptBlock(data) {
    var box = document.createElement('div');
    box.className = 'transcript';

    if (data.segments && data.segments.length) {
      var groups = speakerMarks(groupSegments(data.segments));
      groups.forEach(function (p) {
        var row = document.createElement('div');
        row.className = 'seg';
        var time = document.createElement('span');
        time.className = 'seg-time';
        time.textContent = fmtTime(p.t);
        var txt = document.createElement('span');
        txt.textContent = p.text;
        row.appendChild(time);
        if (p.s != null && groups.multi) {
          var who = document.createElement('span');
          who.className = 'seg-speaker';
          who.textContent = t('speaker', { n: p.s + 1 });
          // тот же говорящий: метку прячем, но место держим, иначе текст скачет по ширине
          if (!p.mark) who.style.visibility = 'hidden';
          row.appendChild(who);
        }
        row.appendChild(txt);
        box.appendChild(row);
      });
      return box;
    }

    paragraphs(data.transcript_text).forEach(function (p) {
      var el = document.createElement('p');
      el.className = 'para';
      el.textContent = p;
      box.appendChild(el);
    });
    return box;
  }

  function summaryBlock(text, id, vote) {
    var box = document.createElement('div');
    box.className = 'summary';
    var h = document.createElement('h3');
    h.textContent = t('summary_title');
    var p = document.createElement('div');
    p.textContent = text;
    box.appendChild(h);
    box.appendChild(p);
    box.appendChild(summaryFoot(text, id, vote));
    return box;
  }

  // Единственный сигнал качества саммари (до 24.09 кабинет не слал ни одного события).
  function sendFeedback(id, kind, path) {
    return api(path || '/summary/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcription_id: id, kind: kind }),
    }).catch(function () { /* отклик не стоит ошибки на экране */ });
  }

  function summaryFoot(text, id, vote, path, extra) {
    var foot = document.createElement('div');
    foot.className = 'sum-foot';

    var copy = document.createElement('button');
    copy.className = 'btn ghost small';
    copy.type = 'button';
    copy.textContent = t('sum_copy');
    copy.addEventListener('click', function () {
      navigator.clipboard.writeText(text).then(function () {
        copy.textContent = t('sum_copied');
        setTimeout(function () { copy.textContent = t('sum_copy'); }, 1500);
        sendFeedback(id, 'copy', path);
      });
    });
    foot.appendChild(copy);
    if (extra) foot.appendChild(extra);

    // вопрос и обе кнопки держим одной группой: на 360 px 👎 отрывался на новую строку
    var group = document.createElement('span');
    group.className = 'sum-vote';
    var ask = document.createElement('span');
    ask.className = 'muted';
    ask.textContent = t('sum_useful');
    group.appendChild(ask);

    var up = voteBtn('👍', vote === 1);
    var down = voteBtn('👎', vote === -1);
    up.addEventListener('click', function () { pick(up, down, 'up'); });
    down.addEventListener('click', function () { pick(down, up, 'down'); });
    group.appendChild(up);
    group.appendChild(down);
    foot.appendChild(group);

    function pick(on, off, kind) {
      on.classList.add('on');
      on.setAttribute('aria-pressed', 'true');
      off.classList.remove('on');
      off.setAttribute('aria-pressed', 'false');
      sendFeedback(id, kind, path);
    }
    return foot;
  }

  function voteBtn(label, on) {
    var b = document.createElement('button');
    b.className = 'vote' + (on ? ' on' : '');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    return b;
  }

  /* ---------- саммари ---------- */

  function summarize(id) {
    // Саммари длинного видео идёт до минуты. Без движущегося индикатора это читается
    // как «залипло» (Денис, 19.09), поэтому: кнопка гаснет, полоска едет, срок назван.
    var btn = el.detail.querySelector('.js-sum');
    if (btn) {
      btn.disabled = true;
      btn.textContent = t('summarizing_btn');
    }

    var placeholder = document.createElement('div');
    placeholder.className = 'summary working';

    var label = document.createElement('div');
    label.textContent = t('summarizing');
    var bar = document.createElement('div');
    bar.className = 'progress';
    bar.appendChild(document.createElement('span'));
    var hint = document.createElement('div');
    hint.className = 'muted hint';
    hint.textContent = t('summarizing_hint');

    placeholder.appendChild(label);
    placeholder.appendChild(bar);
    placeholder.appendChild(hint);
    el.detail.insertBefore(placeholder, el.detail.children[1] || null);

    api('/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcription_id: id }),
    })
      .then(function (r) {
        if (r.status === 422) throw 'SHORT';
        if (r.status === 402) return r.json().then(function (d) {
          if (d && d.next_reset) state.nextReset = d.next_reset;
          throw (d && d.error === 'QUOTA') ? 'QUOTA' : 'GATE';
        });
        if (!r.ok) throw 'FAIL';
        return r.json();
      })
      .then(function (data) {
        var sumEl = summaryBlock(data.summary, id, null);
        el.detail.replaceChild(sumEl, placeholder);
        notesUnder(sumEl);
        if (btn) btn.remove(); // саммари уже есть — предлагать сделать его ещё раз незачем
        state.used += 1;
        var item = state.items.filter(function (i) { return i.id === id; })[0];
        if (item) { item.has_summary = true; renderList(); }
      })
      .catch(function (why) {
        // Автозапуск из панели по короткой записи: подсказка «слишком коротко» уже стоит
        // у кнопок, второй раз её не рисуем (запрос всё равно нужен — сервер считает отказ).
        if (why === 'SHORT' && !btn) { placeholder.remove(); return; }
        el.detail.replaceChild(
          why === 'GATE' ? gateBlock() : why === 'QUOTA' ? quotaBlock()
            : why === 'SHORT' ? shortBlock() : failBlock(),
          placeholder
        );
        // отказ по лимиту и по длине повтором не лечится, а вот сбой — да, поэтому кнопку возвращаем
        if (btn && why !== 'GATE' && why !== 'QUOTA' && why !== 'SHORT') {
          btn.disabled = false;
          btn.textContent = t('summarize');
        } else if (btn) {
          btn.remove();
        }
      });
  }

  function gateBlock(title) {
    var box = document.createElement('div');
    box.className = 'gate';
    var b = document.createElement('b');
    b.textContent = title || t('gate_title', { n: state.gateAfter });
    var p = document.createElement('div');
    p.textContent = t('gate_body', { days: state.daysSignedIn || 90 });
    box.appendChild(b);
    box.appendChild(p);

    // Гейт — единственное место, где вход человеку реально нужен прямо сейчас,
    // поэтому кнопка стоит тут же, а не только в шапке.
    var here = document.createElement('div');
    here.className = 'gate-signin';
    box.appendChild(here);
    renderSignIn(here);

    return box;
  }

  function quotaBlock(title, body) {
    var box = document.createElement('div');
    box.className = 'gate';
    var b = document.createElement('b');
    b.textContent = title || t('quota_title');
    var p = document.createElement('div');
    p.textContent = body || t('quota_body', { date: fmtDay(state.nextReset) });
    box.appendChild(b);
    box.appendChild(p);
    return box;
  }

  // Платный тариф (12.10): одна строка минут под заголовком. Месячная подписка: сброс минут
  // и продление в один день, пишем только сброс. Годовая: минуты помесячно, продление отдельно.
  // Отменённая (20.10): последний месяц = «ends <дата>» вместо новых минут, у годовой вместо продления.
  function renderPlan(p) {
    el.planLine.classList.toggle('hidden', !p);
    if (!p) return;
    var name = p.name === 'pro' ? 'Pro' : 'Lite';
    var parts = [name, t('plan_left', { left: p.left, total: p.minutes })];
    if (p.ending) parts.push(t('plan_ends', { date: fmtDay(p.resets_at) }));
    else {
      parts.push(t('plan_reset', { date: fmtDay(p.resets_at) }));
      if (p.interval === 'year' && p.renews_at) parts.push(t(p.cancelled ? 'plan_ends' : 'plan_renews', {
        date: new Date(p.renews_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }));
    }
    el.planLine.textContent = parts.join(' · ') + ' · ';
    // Отмена, карта, чеки: кабинет подписчика эквайринга по разовой ссылке с нашего сервера.
    // У Freemius (Live, 20.10) такого кабинета нет: сервер отвечает cancel:true, отменяем здесь.
    var link = document.createElement('a');
    link.href = '#'; link.className = 'plan-manage'; link.textContent = t('plan_manage');
    link.addEventListener('click', function (e) {
      e.preventDefault();
      link.textContent = t('loading_short');
      api('/billing/portal', { method: 'POST' })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function (d) {
          if (!d.cancel) { window.location.href = d.url; return; }
          var vars = { plan: name, date: fmtDay(d.ends_at) };
          if (d.cancelled) { link.replaceWith(document.createTextNode(t('cancel_already', vars))); return; }
          confirmCancel(link, vars);
        })
        .catch(function () { link.textContent = t('plan_manage_fail'); });
    });
    el.planLine.appendChild(link);
    el.planLine.appendChild(document.createTextNode(' · '));
    el.planLine.appendChild(supportLink(name));
  }

  // Подтверждение отмены на месте ссылки: без модалок, одна строка с двумя кнопками.
  function confirmCancel(link, vars) {
    var box = document.createElement('span'); box.className = 'plan-cancel';
    box.appendChild(document.createTextNode(t('cancel_confirm', vars) + ' '));
    var yes = document.createElement('a'); yes.href = '#'; yes.className = 'plan-manage'; yes.textContent = t('cancel_yes');
    var keep = document.createElement('a'); keep.href = '#'; keep.className = 'plan-manage'; keep.textContent = t('cancel_keep');
    box.appendChild(yes); box.appendChild(document.createTextNode(' · ')); box.appendChild(keep);
    link.replaceWith(box);
    keep.addEventListener('click', function (e) { e.preventDefault(); loadMe(state.openId); });
    yes.addEventListener('click', function (e) {
      e.preventDefault();
      yes.textContent = t('loading_short');
      api('/billing/cancel', { method: 'POST' })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function (d) {
          box.replaceWith(document.createTextNode(t('cancel_done', { plan: vars.plan, date: fmtDay(d.ends_at) || vars.date })));
        })
        .catch(function () { yes.textContent = t('cancel_fail'); });
    });
  }

  // Поддержка прямо в кабинете (13.10, Денис: «у подписки негде оставить обращение», mailto не форма).
  // Форма шлёт в тот же /api/feedback, что панель и сайт: алерт Денису в Telegram, ответ на почту входа.
  // category support = сервер ещё заводит тикет в «Поддержке пейволлов» monetize (модерация 15.10).
  var FEEDBACK_URL = 'https://api.transcribevideototext.app:8443/api/feedback';
  function supportLink(planName) {
    var a = document.createElement('a');
    a.href = '#'; a.className = 'plan-support'; a.textContent = t('plan_support');
    a.addEventListener('click', function (e) { e.preventDefault(); openSupport(planName); });
    return a;
  }
  function openSupport(planName) {
    var box = el.supportBox;
    box.innerHTML = '';
    box.classList.remove('hidden');
    var h = document.createElement('p'); h.className = 'support-h'; h.textContent = t('support_h', { email: state.email || '' });
    var ta = document.createElement('textarea'); ta.rows = 4; ta.placeholder = t('support_ph');
    var row = document.createElement('div'); row.className = 'support-row';
    var send = document.createElement('button'); send.type = 'button'; send.className = 'btn small'; send.textContent = t('support_send');
    var cancel = document.createElement('a'); cancel.href = '#'; cancel.textContent = t('support_cancel');
    var st = document.createElement('span'); st.className = 'muted support-st';
    row.appendChild(send); row.appendChild(cancel); row.appendChild(st);
    box.appendChild(h); box.appendChild(ta); box.appendChild(row);
    ta.focus();
    cancel.addEventListener('click', function (e) { e.preventDefault(); box.classList.add('hidden'); });
    send.addEventListener('click', function () {
      var msg = ta.value.trim();
      if (msg.length < 3) { st.textContent = t('support_empty'); return; }
      send.disabled = true; st.textContent = t('loading_short');
      fetch(FEEDBACK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, email: state.email || null, category: 'support', pageUrl: location.origin + location.pathname + '#cabinet-' + planName }) })
        .then(function (r) { if (!r.ok) throw new Error(r.status); box.innerHTML = ''; var ok = document.createElement('p'); ok.className = 'support-ok'; ok.textContent = t('support_ok', { email: state.email || '' }); box.appendChild(ok); })
        .catch(function () { send.disabled = false; st.textContent = t('support_fail'); });
    });
  }

  // Выбор тарифа (12.10, пейвол для заявки monetize). Цены = /pricing и кабинет monetize.
  // Касса открыта только тем, кому сервер вернул billing_open (до запуска = тестеры).
  var PRICES = {
    lite: { minutes: 150, month: '$7.99', year: '$4.99', billed: '$59.88' },
    pro: { minutes: 500, month: '$14.99', year: '$9.99', billed: '$119.88' },
  };
  var paidPolls = 0;

  function renderUpgrade(data) {
    // Вернулись с кассы: вебхук monetize приходит через ~30 с после оплаты (замер 12.10), ждём до минуты.
    if (state.paidBack) {
      el.billingNote.classList.remove('hidden');
      if (data.plan) { el.billingNote.textContent = t('paid_ok', { plan: data.plan.name === 'pro' ? 'Pro' : 'Lite' }); state.paidBack = false; }
      else if (paidPolls < 20) {
        el.billingNote.textContent = t('paid_wait'); paidPolls++;
        // Сначала просим сервер сразу перечитать статус у monetize (их вебхук идёт 30-60 с), потом /me.
        setTimeout(function () {
          api('/billing/sync', { method: 'POST' }).catch(function () {}).then(function () { loadMe(state.openId); });
        }, paidPolls === 1 ? 1500 : 3000);
      }
      else el.billingNote.textContent = t('paid_slow');
    }
    if (!data.plan && data.billing_open) {
      el.planLine.classList.remove('hidden');
      el.planLine.textContent = t('plan_free') + ' · ';
      var a = document.createElement('a');
      a.href = '#'; a.className = 'plan-manage'; a.textContent = t('upgrade_link');
      a.addEventListener('click', function (e) { e.preventDefault(); state.upgrade = true; renderUpgrade(data); });
      el.planLine.appendChild(a);
      el.planLine.appendChild(document.createTextNode(' · '));
      el.planLine.appendChild(supportLink('free'));
    }
    var showPicker = state.upgrade && !data.plan && (data.billing_open || !data.signed_in);
    el.upgrade.classList.toggle('hidden', !showPicker);
    if (!showPicker) return;
    el.upgrade.innerHTML = '';
    var fu = data.free_usage;
    var h = document.createElement('h2'); h.textContent = t(fu && fu.remaining === 0 ? 'up_h_out' : 'upgrade_h'); el.upgrade.appendChild(h);
    // Личная статистика + соцдоказательство (12.10, данные RevenueCat/RocketShip: контекст и
    // доверие поднимают покупку). Цифры WAU и рейтинга сверены 13.10: 1 802 в неделю, 4.8 ★ (21).
    if (fu && fu.minutes > 0) {
      var me = document.createElement('p'); me.className = 'up-you';
      var hrs = Math.floor(fu.minutes / 60), mins = fu.minutes % 60;
      me.textContent = t('up_you_used', { time: (hrs ? hrs + ' ' + t('up_h') + ' ' : '') + mins + ' ' + t('up_min') });
      el.upgrade.appendChild(me);
    }
    var proof = document.createElement('p'); proof.className = 'muted up-proof'; proof.textContent = t('up_social');
    el.upgrade.appendChild(proof);
    if (!data.signed_in) {
      var p = document.createElement('p'); p.className = 'muted'; p.textContent = t('upgrade_signin'); el.upgrade.appendChild(p);
      var box = document.createElement('div'); el.upgrade.appendChild(box); renderSignIn(box);
      return;
    }
    var interval = 'year', chosen = 'pro';
    var compare = document.createElement('a');
    compare.href = '/pricing/'; compare.target = '_blank'; compare.rel = 'noopener';
    compare.className = 'up-compare'; compare.textContent = t('up_compare');
    h.appendChild(compare);
    var tog = document.createElement('div'); tog.className = 'up-toggle';
    ['year', 'month'].forEach(function (iv) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'tab'; b.dataset.iv = iv;
      b.textContent = t(iv === 'year' ? 'up_yearly_save' : 'up_monthly');
      b.addEventListener('click', function () { interval = iv; paint(); });
      tog.appendChild(b);
    });
    el.upgrade.appendChild(tog);
    // Карточка = выбор (рамка переезжает по клику), оплата одной кнопкой под ними:
    // 12.10 Денис кликал по карточке Lite, ждал, что рамка переключится, а рамка Pro стояла как «выбранная».
    var cards = document.createElement('div'); cards.className = 'up-cards'; cards.setAttribute('role', 'radiogroup');
    el.upgrade.appendChild(cards);
    var go = document.createElement('button'); go.type = 'button'; go.className = 'btn up-go';
    el.upgrade.appendChild(go);
    var guar = document.createElement('p'); guar.className = 'muted up-guar'; guar.textContent = t('up_guarantee');
    el.upgrade.appendChild(guar);
    var carry = document.createElement('p'); carry.className = 'muted up-carry hidden'; el.upgrade.appendChild(carry);

    var err = document.createElement('p'); err.className = 'up-err hidden'; el.upgrade.appendChild(err);
    var FEATURES = {
      lite: ['up_f_courses', 'up_f_2h', 'up_f_unlim', 'up_f_free'],
      pro: ['up_f_courses', 'up_f_2h', 'up_f_unlim', 'up_f_support', 'up_f_free'],
    };
    function paint() {
      tog.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('on', b.dataset.iv === interval); });
      cards.innerHTML = '';
      // Карточка Free (13.10, Денис): что остаётся бесплатно и когда вернутся ИИ-кредиты.
      // Выбирается как тариф: кнопка становится «Stay on Free» с датой возврата кредитов.
      var fc = document.createElement('div'); fc.className = 'up-card up-free' + (chosen === 'free' ? ' on' : '');
      fc.dataset.plan = 'free'; fc.tabIndex = 0;
      fc.setAttribute('role', 'radio'); fc.setAttribute('aria-checked', String(chosen === 'free'));
      fc.innerHTML = '<div class="up-top"><span class="up-name">Free</span><span class="up-cur"></span></div>' +
        '<div class="up-price"><b>$0</b></div><div class="muted up-billed"></div><ul class="up-feat"></ul>';
      fc.querySelector('.up-cur').textContent = t('up_current');
      fc.querySelector('.up-billed').textContent = fu && fu.reset_date
        ? t(fu.remaining === 0 ? 'up_free_back' : 'up_free_left', { n: fu.remaining, date: fmtDay(fu.reset_date) }) : '';
      ['up_free_yt', 'up_free_ai', 'up_free_export', 'up_free_sum'].forEach(function (k) {
        var li = document.createElement('li'); li.textContent = t(k); fc.querySelector('.up-feat').appendChild(li);
      });
      fc.addEventListener('click', function () { chosen = 'free'; paint(); });
      fc.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chosen = 'free'; paint(); } });
      cards.appendChild(fc);
      ['lite', 'pro'].forEach(function (plan) {
        var pr = PRICES[plan], c = document.createElement('div');
        c.className = 'up-card' + (plan === chosen ? ' on' : '');
        c.dataset.plan = plan; c.tabIndex = 0;
        c.setAttribute('role', 'radio'); c.setAttribute('aria-checked', String(plan === chosen));
        c.innerHTML = '<div class="up-top"><span class="up-name"></span><span class="up-badge hidden"></span></div>' +
          '<div class="up-price"><b></b> <span class="muted"></span></div><div class="muted up-billed"></div><ul class="up-feat"></ul>';
        c.querySelector('.up-name').textContent = plan === 'pro' ? 'Pro' : 'Lite';
        if (plan === 'pro') { var bd = c.querySelector('.up-badge'); bd.textContent = t('up_recommended'); bd.classList.remove('hidden'); }
        c.querySelector('.up-price b').textContent = interval === 'year' ? pr.year : pr.month;
        c.querySelector('.up-price span').textContent = t('up_per_month');
        c.querySelector('.up-billed').textContent = interval === 'year' ? t('up_billed_year', { sum: pr.billed }) : t('up_billed_month');
        var ul = c.querySelector('.up-feat');
        [t('up_f_minutes', { n: pr.minutes, h: t(plan === 'pro' ? 'up_f_hours_pro' : 'up_f_hours_lite') })]
          .concat(FEATURES[plan].map(function (k) { return t(k); }))
          .forEach(function (txt) { var li = document.createElement('li'); li.textContent = txt; ul.appendChild(li); });
        function pick() { chosen = plan; paint(); }
        c.addEventListener('click', pick);
        c.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
        cards.appendChild(c);
      });
      go.disabled = false;
      var free = chosen === 'free';
      go.classList.toggle('ghost', free);
      go.textContent = free ? t('up_stay') : t('up_continue_plan', { plan: chosen === 'pro' ? 'Pro' : 'Lite' });
      guar.textContent = free ? freeNote() : t('up_guarantee');
      // 16.10 Денис: «Осталось кредитов: 10» на Free + «Всё, что есть в бесплатном» на Lite читается
      // как 150 минут плюс кредиты. Сервер с подпиской считает только минуты тарифа (usage.js).
      carry.textContent = t('up_no_carry', { n: fu ? fu.remaining : 0 });
      carry.classList.toggle('hidden', free || !(fu && fu.remaining > 0));
    }
    function freeNote() {
      return fu && fu.reset_date ? t('up_free_note', { date: fmtDay(fu.reset_date) }) : t('up_free_note_nodate');
    }
    go.addEventListener('click', function () {
      if (chosen === 'free') {
        state.upgrade = false; el.upgrade.classList.add('hidden');
        el.billingNote.textContent = freeNote(); el.billingNote.classList.remove('hidden');
        return;
      }
      go.disabled = true; go.textContent = t('loading_short'); err.classList.add('hidden');
      api('/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: chosen, interval: interval }) })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function (d) { window.location.href = d.url; })
        .catch(function () { paint(); err.textContent = t('up_fail'); err.classList.remove('hidden'); });
    });
    paint();
  }

  function fmtDay(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function shortBlock() {
    var p = document.createElement('div');
    p.className = 'summary';
    p.textContent = t('too_short');
    return p;
  }

  function noteBlock(text) {
    var p = document.createElement('div');
    p.className = 'summary';
    p.textContent = text;
    return p;
  }

  function failBlock(text) {
    var p = document.createElement('div');
    p.className = 'summary err';
    p.textContent = text || t('summary_fail');
    return p;
  }

  /* ---------- скачивание ---------- */

  function downloadBtn(label, data, kind) {
    var b = document.createElement('button');
    b.className = 'btn ghost small';
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', function () { download(data, kind); });
    return b;
  }

  // В файл уходит тот же читаемый вид, что на экране: с таймкодами, если они есть,
  // иначе абзацами. Скачанная стена в 56 тысяч знаков одной строкой — то, с чего начали.
  function bodyForFile(data) {
    if (data.segments && data.segments.length && !state.noStamps) {
      // абзац и его таймкод разными строками: в Word это читается как текст с метками,
      // а не как расшифровка субтитров по одному предложению
      return speakerMarks(groupSegments(data.segments))
        .map(function (p) {
          var who = p.mark ? ' ' + t('speaker', { n: p.s + 1 }) : '';
          return '[' + fmtTime(p.t) + ']' + who + '\n' + p.text;
        })
        .join('\n\n');
    }
    // Без таймкодов текст всё равно должен делиться на абзацы — у конкурента с 200k
    // установок ровно два вида выгрузки, и второй это не сплошняк (Денис, 19.09).
    if (data.segments && data.segments.length) {
      return groupSegments(data.segments).map(function (p) { return p.text; }).join('\n\n');
    }
    return paragraphs(data.transcript_text).join('\n\n');
  }

  function download(data, kind) {
    var name = 'transcript-' + data.id;
    var blob;

    if (kind === 'doc') {
      // .doc как HTML-обёртка — так же, как делает панель расширения: сверху название
      // и дата, дальше текст. До 19.09 файл начинался прямо с голого текста.
      var esc = document.createElement('div');
      esc.textContent = (data.summary_text ? t('summary_title') + '\n' + data.summary_text + '\n\n' : '') + bodyForFile(data);
      var head = document.createElement('div');
      head.textContent = data.title || '';
      blob = new Blob(
        ['<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"></head><body>' +
         (data.title ? '<h2>' + head.innerHTML + '</h2>' : '') +
         '<p style="color:#888">' + fmtDate(data.created_at) + '</p>' +
         '<pre>' + esc.innerHTML + '</pre></body></html>'],
        { type: 'application/msword' }
      );
      name += '.doc';
    } else {
      blob = new Blob(
        [(data.title ? data.title + '\n' + fmtDate(data.created_at) + '\n\n' : '') +
         (data.summary_text ? t('summary_title').toUpperCase() + '\n' + data.summary_text + '\n\n---\n\n' : '') + bodyForFile(data)],
        { type: 'text/plain;charset=utf-8' }
      );
      name += '.txt';
    }

    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ---------- вход через Google ---------- */

  /* Скрипт GIS грузится асинхронно и может опоздать к первой отрисовке — ждём его,
     но не вечно: без кнопки кабинет остаётся рабочим, просто без входа. */
  function withGsi(cb, tries) {
    if (window.google && window.google.accounts && window.google.accounts.id) return cb();
    if ((tries || 0) > 20) return;
    setTimeout(function () { withGsi(cb, (tries || 0) + 1); }, 250);
  }

  var gsiReady = false;

  // Вход с устройства, где расширения нет: билета взять неоткуда, человек доказывает,
  // что он это он, самим входом в Google. Без этого библиотека читалась только с той
  // машины, где стоит панель (Денис, 19.09).
  function onLoginCredential(resp) {
    el.signinEmptyMsg.classList.add('hidden');
    api('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: resp.credential }),
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status === 404 ? 'NO_ACCOUNT' : 'FAIL'); })
      .then(function () { show('loading'); loadMe(); })
      .catch(function (why) {
        // «мы тебя не знаем» — не ошибка человека, он просто здесь впервые: красный тут
        // лишняя тревога (Денис, 19.09). Красным остаётся только настоящий сбой входа.
        var unknown = why === 'NO_ACCOUNT';
        el.signinEmptyMsg.textContent = t(unknown ? 'login_no_account' : 'sign_in_fail');
        el.signinEmptyMsg.className = unknown ? 'muted' : 'err';
      });
  }

  function onCredential(resp) {
    api('/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: resp.credential }),
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function () { loadMe(state.openId); })
      .catch(function () {
        var box = document.getElementById('signin');
        if (box) { box.textContent = ''; box.appendChild(errSpan(t('sign_in_fail'))); }
      });
  }

  function errSpan(text) {
    var s = document.createElement('span');
    s.className = 'err';
    s.textContent = text;
    return s;
  }

  // Кнопку рисует сам Google в наш контейнер — свой стиль ей не навязываем,
  // иначе она перестаёт быть узнаваемой (и это против правил бренда Google).
  function renderSignIn(box) {
    if (!box || !state.clientId || state.signedIn) return;
    drawGoogleButton(box, onCredential);
  }

  // На пустом экране и в кабинете обработчики разные (там вход без билета, тут привязка
  // к текущей установке), поэтому initialize зовём перед каждой отрисовкой.
  function drawGoogleButton(box, callback) {
    if (!box || !state.clientId) return;
    withGsi(function () {
      window.google.accounts.id.initialize({ client_id: state.clientId, callback: callback });
      gsiReady = true;
      box.textContent = '';
      window.google.accounts.id.renderButton(box, { type: 'standard', size: 'medium', locale: window.I18N.lang });
    });
  }

  // На пустом экране сессии нет, а значит нет и ответа /me с client_id — берём его
  // отдельным публичным запросом, чтобы не держать копию в статике сайта.
  function offerLogin() {
    if (state.clientId) return drawGoogleButton(el.signinEmpty, onLoginCredential);
    api('/config')
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (cfg) {
        if (!cfg.client_id) return;
        state.clientId = cfg.client_id;
        drawGoogleButton(el.signinEmpty, onLoginCredential);
      })
      .catch(function () { /* без кнопки страница остаётся рабочей */ });
  }

  function loadMe(openId, auto) {
    var q = state.upgrade && !state.upgradeLogged ? '?upgrade=1' : '';
    if (q) state.upgradeLogged = true;
    return api('/me' + q)
      .then(function (r) {
        if (r.status === 401) { show('empty'); offerLogin(); return null; }
        if (!r.ok) throw new Error('me failed');
        return r.json();
      })
      .then(function (data) {
        if (!data) return;
        state.items = data.transcriptions || [];
        state.gateAfter = data.gate_after || 3;
        state.used = data.summaries_used || 0;
        state.minChars = data.summary_min_chars || 500;
        state.signedIn = !!data.signed_in;
        // одна точка на оба пути входа: и по билету из расширения, и кнопкой на пустом экране
        if (state.signedIn) rememberSignedIn();
        state.days = data.retention_days || 30;
        state.daysSignedIn = data.retention_signed_in || 90;
        state.quota = data.signed_quota || 6;
        state.windowUsed = data.window_used || 0;
        state.nextReset = data.next_reset || null;
        state.notesOn = !!data.notes;
        state.notesGate = (data.notes && data.notes.gate_after) || 2;
        state.notesNext = (data.notes && data.notes.next_reset) || null;
        state.clientId = data.client_id || null;
        state.email = data.email || null;
        el.retention.textContent = t('retention', { n: state.days });
        if (!state.signedIn) el.retention.title = t('retention_hint', { n: state.daysSignedIn });
        // Переустановка: записи прежней установки на этом компьютере здесь не видны
        // (по отпечатку их не отдаём). Честно говорим, куда делись и как не терять дальше.
        el.earlierNote.classList.toggle('hidden', !(data.earlier_install && !state.signedIn));
        renderPlan(data.plan);
        renderUpgrade(data);
        el.signin.textContent = '';
        if (state.signedIn) el.signin.textContent = t('signed_as', { email: state.email || '' });
        else renderSignIn(el.signin);
        show('app');
        renderList();

        var first = openId || (state.items[0] && state.items[0].id);
        if (first) open(first, auto === true);
      })
      .catch(function () { show('empty'); });
  }

  function start() {
    // выбор вида выгрузки живёт между визитами: выбрал раз — больше не переключаешь
    try { state.noStamps = localStorage.getItem('dvx_no_stamps') === '1'; } catch (e) {}
    window.I18N.apply();
    document.title = t('title');
    var q = new URLSearchParams(location.search);
    var nonce = q.get('state');
    var wanted = Number(q.get('t')) || null;
    var auto = q.get('summary') === '1'; // из панели нажали Summary — считаем сразу
    state.upgrade = q.get('upgrade') === '1';       // из панели нажали Upgrade
    state.paidBack = q.get('billing') === 'success'; // вернулись с кассы

    // билет из адреса убираем сразу, чтобы он не оседал в истории и реферерах
    if (nonce || wanted || auto || state.upgrade || state.paidBack) history.replaceState(null, '', location.pathname);

    if (!nonce) return loadMe(wanted, auto);

    api('/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce: nonce }),
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (data) { return loadMe(wanted || data.transcription_id || null, auto); })
      .catch(function () { return loadMe(wanted, auto); });
  }

  // Список не живой: новая запись из панели появлялась только после F5 (Денис 13.10).
  // Вернулся на вкладку кабинета = перечитать список, открытую запись не трогаем.
  // Не дёргаем, пока открыт выбор тарифа или форма поддержки (их бы сбросило перерисовкой).
  // Плюс раз в 20 с, пока вкладка на экране: панель стоит сбоку той же вкладки, и переключения
  // вкладки может не быть вовсе (Денис записал в соседней вкладке и смотрел сюда же).
  var lastLoad = Date.now();
  function refreshList() {
    if (document.visibilityState !== 'visible' || Date.now() - lastLoad < 5000) return;
    if (state.upgrade || state.paidBack || !el.supportBox.classList.contains('hidden')) return;
    lastLoad = Date.now();
    // только список: открытая запись и её саммари/конспект не перегружаются
    api('/me').then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
      if (!data || !data.transcriptions) return;
      state.items = data.transcriptions;
      renderList();
    }).catch(function () {});
  }
  document.addEventListener('visibilitychange', refreshList);
  window.addEventListener('focus', refreshList);
  setInterval(refreshList, 20000);

  start();
})();
