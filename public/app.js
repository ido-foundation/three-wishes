import { api, ApiError } from './api.js';
import { h, dotsRow, lockup, seal, wordmark, backButton, wishOrbit, thinkingDial, watermark, KIND_LABEL } from './ui.js';
import { mountLever } from './lever-view.js';
import { native } from './native.js';
import { leverModel, fmtDate, percent } from './lib/lever.js';

const app = document.getElementById('app');
const standalone = () => navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

const state = { me: null, cancel: null, draft: '' };

// The iPhone app hands over its push token through this, once it knows the person is signed in.
window.nativePush = (token, env) => api.device(token, env).catch(() => {});

function mount(view) {
  document.body.dataset.wm = view.classList.contains('nowm') ? '0' : '1';
  state.cancel?.();
  state.cancel = null;
  app.replaceChildren(view);
  window.scrollTo(0, 0);
  const focus = view.querySelector('[data-autofocus]');
  if (focus && !isIos()) focus.focus();
}

/** Calls fn every `ms` while this view is on screen and the page is visible. */
function every(ms, fn) {
  const t = setInterval(() => document.visibilityState === 'visible' && fn(), ms);
  state.cancel = () => clearInterval(t);
}

const view = (cls, ...kids) => h('section', { class: `view ${cls}`.trim() }, ...kids);
const errText = (e) => (e instanceof ApiError ? e.message : 'Something went wrong.');

async function loadMe() {
  state.me = await api.me();
  native.ready();
  return state.me;
}

/* ───────── invitation ───────── */

function gateView({ prefill = '', error = '' } = {}) {
  const input = h('input', {
    class: 'field code', type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off',
    spellcheck: 'false', maxlength: '9', placeholder: 'XXXX-XXXX', 'aria-label': 'Invitation code', 'data-autofocus': '', value: prefill,
  });
  const msg = h('p', { class: 'error', role: 'alert' }, error);
  const go = h('button', { class: 'btn', type: 'submit' }, 'Enter');
  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    go.disabled = true;
    msg.textContent = '';
    try {
      await api.redeem(input.value);
      await loadMe();
      homeView();
    } catch (err) {
      msg.textContent = errText(err);
      go.disabled = false;
    }
  } }, input, msg, go);
  const kids = [lockup(), form];
  kids[0].classList.add('rise');
  if (isIos() && !standalone() && !native.available) kids.push(installHint());
  mount(view('center', ...kids));
}

function installView(code) {
  const shown = code.replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{0,4}).*$/, (_, a, b) => (b ? `${a}-${b}` : a));
  mount(
    view('center',
      lockup(),
      h('div', { class: 'stack center' }, h('p', { class: 'label' }, 'Your code'), h('p', { class: 'title code-show' }, shown)),
      installHint(),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => homeView() }, 'Continue here'),
    ),
  );
}

function installHint() {
  const hint = h('div', { class: 'install' });
  hint.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';
  hint.append(h('span', { class: 'label' }, 'Add to Home Screen'));
  return hint;
}

/* ───────── home ───────── */

function homeView({ text = state.draft, error = '' } = {}) {
  const me = state.me;
  const limited = me.left !== null;
  const kids = [
    wishOrbit(me.left, me.total),
    limited ? h('p', { class: 'label centered' }, me.left > 0 ? `${['No questions', 'One question', 'Two questions', 'Three questions'][Math.min(me.left, 3)]} left` : '') : null,
  ];

  if (me.left !== 0) {
    const ta = h('textarea', {
      class: 'field', rows: '3', maxlength: '300', placeholder: 'Ask about the future', 'aria-label': 'Your question',
      enterkeyhint: 'go', 'data-autofocus': '',
    });
    ta.value = text;
    const ask = h('button', { class: 'btn', type: 'submit', disabled: text.trim().length < 8 }, 'Ask');
    ta.addEventListener('input', () => {
      state.draft = ta.value;
      ask.disabled = ta.value.trim().length < 8;
    });
    const msg = h('p', { class: 'error', role: 'alert' }, error);
    kids.push(
      h('form', { class: 'stack ask', onsubmit: (e) => { e.preventDefault(); if (!ask.disabled) checkFlow(ta.value); } },
        ta, msg, ask),
    );
  } else {
    kids.push(h('p', { class: 'title' }, "You've asked all three."));
  }

  if (me.wishes.length) {
    const list = h('ul', { class: 'list', 'aria-label': 'Your questions' });
    for (const w of me.wishes) list.append(h('li', {}, wishRow(w)));
    kids.push(h('p', { class: 'label' }, 'Your questions'), list);
  }
  mount(view('home stack', ...kids));

  if (me.wishes.some((w) => w.status === 'running')) {
    every(10_000, async () => {
      const before = me.wishes.filter((w) => w.status === 'running').length;
      try {
        await loadMe();
      } catch {
        return;
      }
      const after = state.me.wishes.filter((w) => w.status === 'running').length;
      if (after !== before) homeView({ text: state.draft });
    });
  }
}

function wishRow(w) {
  const fig =
    w.status === 'ready'
      ? w.revealed
        ? h('span', { class: 'fig' }, (({ figure, unit }) => (unit ? `${figure} ${unit}` : figure))(leverModel(w.question, w.answer)))
        : h('span', { class: 'fig state' }, 'Reveal')
      : w.status === 'failed'
        ? h('span', { class: 'fig state' }, state.me.left === null ? 'Couldn’t answer' : 'Returned')
        : h('span', { class: 'fig state pulse' }, 'Thinking');
  return h('button', { class: 'row', type: 'button', onclick: () => openWish(w) }, h('span', { class: 'q' }, w.question?.title ?? ''), fig);
}

function openWish(w) {
  if (w.status === 'ready') return leverView(w);
  if (w.status === 'failed') return failedView(w);
  return waitingView(w);
}

/* ───────── the check ───────── */

async function checkFlow(text) {
  state.draft = text;
  mount(
    view('center nowm', thinkingDial(true), h('p', { class: 'label pulse', role: 'status' }, 'Thinking')),
  );
  let r;
  try {
    r = await api.check(text);
  } catch (e) {
    return homeView({ text, error: errText(e) });
  }
  if (r.verdict === 'ok') return reviewView(text, r);
  return refusedView(text, r);
}

function refusedView(text, r) {
  mount(
    view('stack',
      backButton(() => homeView({ text })),
      h('div', { class: 'grow' }),
      h('p', { class: 'label' }, 'Not quite'),
      h('p', { class: 'title' }, r.message),
      r.hints?.length ? h('ul', { class: 'body' }, r.hints.map((t) => h('li', {}, t))) : null,
      h('p', { class: 'body' }, text),
      h('div', { class: 'grow' }),
      h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => homeView({ text }) }, 'Change it')),
    ),
  );
}

function reviewView(text, r) {
  const q = r.question;
  const meta = [KIND_LABEL[q.kind], q.close_date ? `Resolves on ${fmtDate(q.close_date)}` : null].filter(Boolean).join(' · ');
  const left = state.me.left;
  const status = h('p', { class: 'error', role: 'alert' });
  const make = h('button', { class: 'btn', type: 'button' }, 'Yes, ask it');
  const stars = dotsRow(left, state.me.total);
  make.addEventListener('click', async () => {
    make.disabled = true;
    status.textContent = '';
    stars?.replaceWith(dotsRow(left, state.me.total, { spending: true }));
    try {
      const { wish } = await api.seal(r.checkId);
      await loadMe();
      waitingView(wish, { justSealed: true });
    } catch (e) {
      status.textContent = errText(e);
      if (e.code === 'expired') return setTimeout(() => homeView({ text, error: e.message }), 1200);
      if (e.code === 'none_left' || e.code === 'daily_cap') {
        await loadMe().catch(() => {});
        return setTimeout(() => homeView(), 1800);
      }
      make.disabled = false;
    }
  });
  mount(
    view('stack',
      backButton(() => homeView({ text })),
      h('div', { class: 'grow' }),
      h('p', { class: 'label lit' }, meta),
      h('p', { class: 'title' }, q.title),
      r.rewrite
        ? h('p', { class: 'reword' }, h('b', {}, 'You wrote: '), `\u201C${r.rewrite.from}\u201D. `, r.rewrite.reason)
        : null,
      q.criteria ? [h('p', { class: 'label crit-label' }, 'Resolution criteria'), h('p', { class: 'criteria' }, q.criteria)] : null,
      q.kind === 'categorical' && q.options?.length
        ? h('p', { class: 'body' }, q.options.join(' · '))
        : null,
      ...(r.notes ?? []).map((n) => h('p', { class: 'body note' }, n)),
      h('div', { class: 'grow' }),
      stars,
      left === null ? null : h('p', { class: 'body' }, left === 1 ? 'This is your last question.' : 'This uses one of your questions.'),
      status,
      h('div', { class: 'actions' }, make, h('button', { class: 'btn text', type: 'button', onclick: () => homeView({ text }) }, 'Change it')),
    ),
  );
}

/* ───────── waiting, failing ───────── */

function waitingView(wish, { justSealed = false } = {}) {
  const me = state.me;
  const kids = [
    backButton(() => homeView()),
    dotsRow(me.left, me.total),
    h('div', { class: 'grow' }),
    h('div', { class: 'center-ring' }, thinkingDial()),
    h('p', { class: 'label pulse', role: 'status' }, 'Thinking'),
    h('p', { class: 'title small' }, wish.question.title),
    h('p', { class: 'body' }, 'This can take a while. You can close the app.'),
    h('div', { class: 'grow' }),
  ];
  const canPush = me.push?.enabled && 'PushManager' in window && 'serviceWorker' in navigator && 'Notification' in window;
  if (canPush && Notification.permission === 'default' && (standalone() || !isIos())) {
    const b = h('button', { class: 'btn ghost', type: 'button' }, 'Tell me when it is ready');
    b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = (await enablePush(me.push.key)) ? 'We will tell you' : 'Notifications are off';
    });
    kids.push(h('div', { class: 'actions' }, b));
  }
  mount(view('stack nowm', ...kids));
  if (justSealed) native.requestPush(); // the natural moment to ask: they now have something to wait for

  const check = async () => {
    try {
      const { wish: w } = await api.wish(wish.id);
      if (w.status === 'ready') {
        await loadMe();
        leverView(w);
      } else if (w.status === 'failed') {
        await loadMe();
        failedView(w);
      }
    } catch {
      /* try again on the next beat */
    }
  };
  every(justSealed ? 4000 : 6000, check);
  if (!justSealed) check();
}

function failedView(wish) {
  mount(
    view('stack',
      backButton(() => homeView()),
      h('div', { class: 'grow' }),
      state.me.left === null ? null : h('p', { class: 'label' }, 'Returned'),
      h('p', { class: 'title' }, "That one couldn't be answered."),
      state.me.left === null ? null : h('p', { class: 'body' }, "You haven't used a question."),
      h('p', { class: 'body' }, wish.question?.title ?? ''),
      h('div', { class: 'grow' }),
      h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => homeView() }, 'Ask again')),
    ),
  );
}

async function enablePush(key) {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return false;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
    await api.push(sub.toJSON());
    return true;
  } catch {
    return false;
  }
}
function b64ToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/* ───────── the lever ───────── */

function leverView(wish, { shared = false, token = null, back = () => homeView() } = {}) {
  const pullBtn = h('button', { class: 'btn', type: 'button' }, 'Reveal');
  const actions = h('div', { class: 'actions' });

  const startRevealed = shared ? false : wish.revealed;
  const how = wish.question.criteria
    ? h('details', { class: `how${startRevealed ? '' : ' hidden'}` }, h('summary', { class: 'label' }, 'How it resolves'), h('p', { class: 'criteria' }, wish.question.criteria))
    : null;
  const lever = mountLever({
    question: wish.question,
    answer: wish.answer,
    revealed: startRevealed,
    onReveal: () => {
      how?.classList.remove('hidden');
      actions.replaceChildren(...doneActions());
      if (!shared && !wish.revealed) {
        wish.revealed = true;
        api.reveal(wish.id).catch(() => {});
      }
    },
  });
  pullBtn.addEventListener('click', () => lever.pull());

  const doneActions = () => [h('button', { class: 'btn', type: 'button', onclick: (e) => share(e.currentTarget, wish, token) }, 'Share')];
  if (lever.revealed) actions.replaceChildren(...doneActions());
  else actions.replaceChildren(pullBtn);

  mount(
    view('stack nowm',
      shared ? seal() : backButton(back),
      h('p', { class: 'title small clamp' }, wish.question.title),
      (wish.demo ?? state.me?.demo) ? h('p', { class: 'label demo' }, 'Demo answer · not a real forecast') : null,
      h('div', { class: 'grow' }),
      lever.box,
      lever.slot,
      lever.rank,
      h('div', { class: 'grow' }),
      actions,
      how,
      shared ? wordmark() : null,
    ),
  );
}

async function share(button, wish, token) {
  const url = wish.share_url ?? `${location.origin}/w/${token}`;
  const cardUrl = `${url}/card.png`;
  const label = button.textContent;
  try {
    if (native.available) {
      native.share(url, cardUrl);
      return;
    }
    if (navigator.share) {
      let files;
      try {
        const blob = await (await fetch(cardUrl)).blob();
        const file = new File([blob], 'answer.png', { type: 'image/png' });
        if (navigator.canShare?.({ files: [file] })) files = [file];
      } catch {
        /* share the link alone */
      }
      await navigator.share(files ? { files, text: url } : { url });
      return;
    }
    await navigator.clipboard.writeText(url);
    button.textContent = 'Link copied';
    setTimeout(() => (button.textContent = label), 1800);
  } catch (e) {
    if (e?.name !== 'AbortError') {
      button.textContent = 'Could not share';
      setTimeout(() => (button.textContent = label), 1800);
    }
  }
}

/* ───────── a shared link ───────── */

async function shareView(token) {
  try {
    const w = await api.publicWish(token);
    leverView({ question: w.question, answer: w.answer, demo: w.demo, revealed: false, share_url: `${location.origin}/w/${token}` }, { shared: true, token });
  } catch {
    mount(view('center', lockup()));
  }
}

/* ───────── start ───────── */

async function boot() {
  document.body.prepend(watermark());
  if (!native.available && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  const path = location.pathname;
  const sharePath = /^\/w\/([A-Za-z0-9_-]{8,64})$/.exec(path);
  if (sharePath) return shareView(sharePath[1]);

  const invite = /^\/i\/([A-Za-z0-9-]{4,16})$/.exec(path);
  if (invite) {
    history.replaceState(null, '', '/');
    try {
      await api.redeem(invite[1]);
    } catch (e) {
      return gateView({ prefill: invite[1].toUpperCase(), error: errText(e) });
    }
  }

  try {
    await loadMe();
  } catch (e) {
    if (e.status === 401) return gateView();
    return mount(view('center', lockup(), h('p', { class: 'error' }, errText(e))));
  }

  // On an iPhone, the Home Screen app keeps its own storage, apart from Safari's. So after an
  // invitation link opens in Safari, show the code: typing it in the installed app works for a day.
  if (invite && isIos() && !standalone() && !native.available) return installView(invite[1].toUpperCase());

  const wishId = new URLSearchParams(location.search).get('w');
  if (wishId) {
    history.replaceState(null, '', '/');
    const w = state.me.wishes.find((x) => x.id === wishId);
    if (w) return openWish(w);
  }
  homeView();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.me && document.querySelector('.home')) {
    loadMe().then(() => homeView({ text: state.draft })).catch(() => {});
  }
});

boot();
