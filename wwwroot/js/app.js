import { h } from './dom.js';
import { api, logoutNow } from './api.js';
import { loadContent, C } from './content.js';
import { store, startAccount, wipe, flush, DEFAULT_EXIT } from './store.js';
import { gateView } from './views/gate.js';
import { intakeView } from './views/intake.js';
import { homeView } from './views/home.js';
import { urgeView, contactView, journalView } from './views/tools.js';
import { safetyView, resourcesView } from './views/safety.js';
import { settingsView } from './views/settings.js';
import { loadAssistant, initAssistant, syncAssistant, resetAssistant } from './assistant.js';
import { env } from './env.js';

const VIEWS = {
  gate: gateView,
  intake: intakeView,
  home: homeView,
  urge: urgeView,
  contact: contactView,
  journal: journalView,
  safety: safetyView,
  resources: resourcesView,
  settings: settingsView,
};

const NAV = [
  ['home', 'Guide'],
  ['urge', 'Urge help'],
  ['contact', 'They contacted me'],
  ['journal', 'Journal'],
  ['safety', 'Safety'],
  ['resources', 'Resources'],
  ['settings', 'Settings'],
];

const main = document.getElementById('view');
const nav = document.getElementById('nav');
const statusEl = document.getElementById('save-status');
let current = { view: 'gate', params: {} };
let currentNode = null;

// ------------------------------------------------------------ navigation

function go(view, params = {}) {
  current = { view, params };
  render();
}

function render() {
  if (currentNode && currentNode._cleanup) currentNode._cleanup();
  const build = VIEWS[current.view];
  currentNode = build(ctx, current.params);
  main.replaceChildren(currentNode);
  drawNav();
  syncAssistant();

  const section = current.params.section && document.getElementById(current.params.section);
  if (section) {
    section.scrollIntoView({ block: 'start' });
  } else {
    window.scrollTo(0, 0);
    const heading = main.querySelector('h1');
    if (heading) heading.focus({ preventScroll: true });
  }
}

function drawNav() {
  const show = store.mode !== 'none' && store.data.rel && current.view !== 'intake' && current.view !== 'gate';
  nav.hidden = !show;
  if (!show) { nav.replaceChildren(); return; }
  nav.replaceChildren(...NAV.map(([id, label]) => h('button', {
    type: 'button', class: 'nav-btn', 'aria-current': current.view === id ? 'page' : null,
    onclick: () => go(id),
  }, label)));
}

// ------------------------------------------------------------ session

function enter() {
  watchIdle();
  go(store.data.rel ? 'home' : 'intake');
}

async function signOut(notice = '', { server = true } = {}) {
  try { await flush(); } catch { /* ignore */ }
  resetAssistant();
  if (server && store.mode === 'account') {
    try { await api.logout(); } catch { /* the cookie will expire on its own */ }
  }
  stopIdle();
  wipe();
  statusEl.textContent = '';
  go('gate', { notice });
}

// ------------------------------------------------------------ quick exit

// Settings only accepts https addresses, but this checks again at the moment of use, so a damaged or hand-edited
// saved value can never send the browser anywhere else (javascript:, data:, http:).
function exitAddress() {
  try {
    const url = new URL((store.data.prefs && store.data.prefs.exitUrl) || DEFAULT_EXIT);
    return url.protocol === 'https:' ? url.href : DEFAULT_EXIT;
  } catch {
    return DEFAULT_EXIT;
  }
}

function quickExit() {
  const url = exitAddress();
  if (store.mode === 'account') logoutNow();
  resetAssistant();
  wipe();
  document.body.replaceChildren();
  document.title = '';
  location.replace(url);
}

document.getElementById('quick-exit').addEventListener('click', quickExit);

let escTimes = [];
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const now = Date.now();
  escTimes = escTimes.filter((t) => now - t < 1500);
  escTimes.push(now);
  if (escTimes.length >= 3) quickExit();
});

// ------------------------------------------------------------ sign out when idle

let idleTimer = null;
let idleBound = false;

function idleMs() {
  const m = Number(store.data.prefs && store.data.prefs.lockMin) || 10;
  return m * 60 * 1000;
}

function bump() {
  if (store.mode === 'none') return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(onIdle, idleMs());
}

async function onIdle() {
  if (store.mode === 'account') {
    await signOut('You were signed out after a period of inactivity, to keep your notes private.');
  } else if (store.mode === 'guest') {
    resetAssistant();
    main.replaceChildren(h('section', { class: 'card gate-card center stack' },
      h('h1', { text: 'Still there?' }),
      h('p', { text: 'The screen is hidden for your privacy.' }),
      h('button', { type: 'button', class: 'btn primary', onclick: () => { render(); bump(); } }, 'Show it again')));
  }
}

function watchIdle() {
  if (!idleBound) {
    ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) => document.addEventListener(ev, bump, { passive: true }));
    idleBound = true;
  }
  bump();
}

function stopIdle() { clearTimeout(idleTimer); }

// ------------------------------------------------------------ save status

store.onStatus = (state) => {
  if (store.mode !== 'account') { statusEl.textContent = ''; return; }
  statusEl.textContent = state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : 'Not saved. Retrying…';
  statusEl.classList.toggle('err', state === 'error');
  if (state === 'error') setTimeout(flush, 4000);
};

// If the server says the session ended, return to the sign-in screen.
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason && e.reason.status === 401 && store.mode === 'account') {
    e.preventDefault();
    signOut('Your session ended. Please sign in again.', { server: false });
  }
});

// ------------------------------------------------------------ start

const ctx = { store, go, enter, signOut, refreshIdle: bump, syncAssistant };

// Is the Quietly server there? On a plain web host there is no /api, so the request fails or comes back as a web page, not JSON.
async function detectServer() {
  try {
    const res = await fetch('api/me', { cache: 'no-store', credentials: 'same-origin', referrerPolicy: 'no-referrer' });
    return res.ok && (res.headers.get('content-type') || '').includes('application/json');
  } catch {
    return false;
  }
}

async function boot() {
  const [loaded, server] = await Promise.all([loadContent().then(() => true, () => false), detectServer()]);
  if (!loaded) {
    main.replaceChildren(h('p', { class: 'notice', text: 'Could not load the guide. Please refresh.' }));
    return;
  }
  env.staticSite = !server;
  if (server) await loadAssistant();
  document.title = C.core.app.name;
  document.getElementById('brand-name').textContent = C.core.app.name;
  initAssistant(ctx);

  if (env.staticSite) {
    wipe();
    go('gate');
    return;
  }

  try {
    const me = await api.me();
    if (!me || !me.username) throw new Error('signed out');
    await startAccount(me.username);
    enter();
  } catch (e) {
    wipe();
    go('gate');
  }
}

boot();
