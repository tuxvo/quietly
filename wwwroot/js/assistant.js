// The AI helper: a round button at the bottom right that opens a small chat panel.
//
// Privacy rules this file keeps:
//  - Only the messages typed into this chat are sent (to our own server, which asks Google's Gemini).
//    Saved answers, checklists, the journal and the username are never included.
//  - The conversation lives in this variable only. It is not saved, and resetAssistant() clears it on sign-out.
//  - The first time, the person must agree to what is sent (stored with their encrypted settings, or in memory for guests).
//  - Replies are drawn with DOM nodes, never innerHTML, so nothing in a reply can run as code.

import { h, icon } from './dom.js';
import { api } from './api.js';
import { C } from './content.js';
import { store, touch } from './store.js';

const MAX_SEND = 12;          // most recent turns sent with each question
const MAX_USER = 2000;        // characters in one message (the server enforces the same)
const MAX_MODEL = 8000;

const state = { enabled: false, open: false, busy: false, turns: [] };
let epoch = 0;   // bumped on sign-out, so a reply still in flight can never land in someone else's session
let fab = null;
let panel = null;
let body = null;
let composer = null;
let input = null;
let sendBtn = null;
let ctxRef = null;

export function isAssistantEnabled() { return state.enabled; }

/** Asks the server whether a Gemini key has been set up. If not, the button is never shown. */
export async function loadAssistant() {
  try {
    const res = await api.assistantStatus();
    state.enabled = Boolean(res && res.enabled);
  } catch {
    state.enabled = false;
  }
}

export function initAssistant(ctx) {
  ctxRef = ctx;
  if (fab) return;

  fab = h('button', {
    type: 'button', class: 'ai-fab', id: 'ai-fab', hidden: true,
    'aria-label': C.core.assistant.title, 'aria-expanded': 'false', 'aria-controls': 'ai-panel',
    onclick: () => (state.open ? closePanel() : openPanel()),
  }, icon('chat', 26));

  const closeBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => closePanel() }, icon('x', 18));
  body = h('div', { class: 'ai-body', 'aria-live': 'polite' });

  input = h('textarea', {
    class: 'ai-input', rows: '1', maxlength: String(MAX_USER), placeholder: C.core.assistant.placeholder,
    'aria-label': C.core.assistant.placeholder, spellcheck: 'true',
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });
  sendBtn = h('button', { type: 'button', class: 'ai-send', 'aria-label': 'Send', onclick: submit }, icon('send', 20));
  composer = h('div', { class: 'ai-composer' },
    h('div', { class: 'ai-row' }, input, sendBtn),
    h('p', { class: 'ai-notice', text: C.core.assistant.notice }));

  panel = h('section', { class: 'ai-panel', id: 'ai-panel', role: 'dialog', 'aria-label': C.core.assistant.title, hidden: true },
    h('header', { class: 'ai-head' },
      h('strong', { text: C.core.assistant.title }),
      h('span', { class: 'ai-badge', text: 'AI' }),
      closeBtn),
    body,
    composer);

  panel.addEventListener('keydown', (e) => {
    // One Esc closes the panel. It is not stopped, so pressing Esc three times still triggers Quick exit.
    if (e.key === 'Escape') closePanel();
  });

  document.body.append(fab, panel);
}

/** Show or hide the button depending on: key set up, signed in or guest, and the person's own setting. */
export function syncAssistant() {
  if (!fab) return;
  const allowed = state.enabled && store.mode !== 'none' && !(store.data.prefs && store.data.prefs.aiHide);
  fab.hidden = !allowed;
  if (!allowed) closePanel(false);
}

/** Forget the conversation and close the panel. Called whenever someone signs out. */
export function resetAssistant() {
  epoch += 1;
  state.turns = [];
  state.busy = false;
  if (panel) {
    closePanel(false);
    if (input) { input.value = ''; input.style.height = 'auto'; }
  }
  if (fab) fab.hidden = true;
}

// ---------------------------------------------------------------- open / close

function openPanel() {
  state.open = true;
  panel.hidden = false;
  fab.setAttribute('aria-expanded', 'true');
  draw();
  focusFirst();
}

function closePanel(returnFocus = true) {
  if (!panel) return;
  const wasOpen = state.open;
  state.open = false;
  panel.hidden = true;
  if (fab) fab.setAttribute('aria-expanded', 'false');
  if (wasOpen && returnFocus && fab && !fab.hidden) fab.focus();
}

function consented() {
  return Boolean(store.data.prefs && store.data.prefs.aiConsent);
}

function focusFirst() {
  const target = consented() ? input : body.querySelector('.btn.primary');
  if (target) target.focus();
}

// ---------------------------------------------------------------- drawing

function draw() {
  const ai = C.core.assistant;
  if (!consented()) {
    composer.hidden = true;
    body.replaceChildren(consentCard(ai.consent));
    return;
  }
  composer.hidden = false;
  sendBtn.disabled = state.busy;

  const nodes = [];
  if (state.turns.length === 0) {
    nodes.push(h('p', { class: 'ai-intro', text: ai.intro }));
    nodes.push(h('div', { class: 'ai-chips' }, ai.chips.map((q) => h('button', {
      type: 'button', class: 'ai-chip', onclick: () => ask(q),
    }, q))));
  }
  for (const t of state.turns) {
    if (t.role === 'user') {
      nodes.push(h('div', { class: 'ai-msg user' }, h('p', { text: t.text })));
    } else if (t.role === 'model') {
      nodes.push(h('div', { class: 'ai-msg model' }, renderReply(t.text)));
    } else {
      nodes.push(h('div', { class: 'ai-msg err', role: 'alert' },
        h('p', { text: t.text }),
        h('button', { type: 'button', class: 'btn sm', onclick: retry }, 'Try again')));
    }
  }
  if (state.busy) {
    nodes.push(h('div', { class: 'ai-msg model typing' },
      h('span', { class: 'sr-only', text: 'Thinking…' }),
      h('span', { class: 'dot' }), h('span', { class: 'dot' }), h('span', { class: 'dot' })));
  }
  if (state.turns.length > 0) {
    nodes.push(h('button', { type: 'button', class: 'link ai-new', onclick: startOver }, 'Start a new chat'));
  }
  body.replaceChildren(...nodes);
  body.scrollTop = body.scrollHeight;
}

function consentCard(consent) {
  return h('div', { class: 'ai-consent' },
    h('h2', { text: consent.title }),
    h('ul', {}, consent.points.map((p) => h('li', { text: p }))),
    h('div', { class: 'actions' },
      h('button', {
        type: 'button', class: 'btn primary',
        onclick: () => { store.data.prefs.aiConsent = true; touch(); draw(); input.focus(); },
      }, consent.accept),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => closePanel() }, consent.decline)));
}

// ---------------------------------------------------------------- asking

function submit() {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  ask(text);
}

function ask(text) {
  if (state.busy) return;
  state.turns.push({ role: 'user', text: text.slice(0, MAX_USER) });
  requestReply();
}

function retry() {
  if (state.busy) return;
  state.turns = state.turns.filter((t) => t.role !== 'error');
  requestReply();
}

function startOver() {
  if (state.busy) return;
  state.turns = [];
  draw();
  input.focus();
}

/** Only real user/model turns are sent: the most recent ones, starting with a user message. */
function messagesToSend() {
  const real = state.turns.filter((t) => t.role === 'user' || t.role === 'model');
  let recent = real.slice(-MAX_SEND);
  while (recent.length && recent[0].role !== 'user') recent = recent.slice(1);
  return recent.map((t) => ({ role: t.role, text: t.text.slice(0, t.role === 'user' ? MAX_USER : MAX_MODEL) }));
}

async function requestReply() {
  const mine = epoch;
  state.busy = true;
  draw();
  let turn;
  try {
    const res = await api.assistantAsk(messagesToSend());
    const reply = res && typeof res.reply === 'string' ? res.reply.trim() : '';
    turn = reply ? { role: 'model', text: reply } : { role: 'error', text: 'The helper sent back nothing. Please try again.' };
  } catch (e) {
    turn = { role: 'error', text: e && e.message ? e.message : 'The helper couldn’t answer just now. Please try again.' };
  }
  if (mine !== epoch) return;   // signed out meanwhile: drop the reply
  state.turns.push(turn);
  state.busy = false;
  if (state.open) {
    draw();
    if (consented()) input.focus();
  }
}

// ---------------------------------------------------------------- showing a reply safely

// Handles the small subset of Markdown the model uses: paragraphs, bullet and numbered lists, **bold**, *italic*.
// Links are shown as plain text. Everything is created with createElement/textContent.
function inline(text) {
  const cleaned = text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
  return cleaned.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g).filter(Boolean).map((part) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return h('strong', { text: part.slice(2, -2) });
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return h('em', { text: part.slice(1, -1) });
    return part;
  });
}

export function renderReply(text) {
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push(list.el); list = null; } };

  for (const raw of String(text).replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim() || /^\s*([-*_]\s*){3,}$/.test(line)) { flush(); continue; }

    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d{1,2}[.)]\s+(.*)$/.exec(line);
    const item = bullet || numbered;
    if (item) {
      const kind = bullet ? 'ul' : 'ol';
      if (!list || list.kind !== kind) { flush(); list = { kind, el: h(kind, { class: 'ai-list' }) }; }
      list.el.append(h('li', {}, inline(item[1])));
      continue;
    }

    flush();
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    out.push(heading ? h('p', {}, h('strong', {}, inline(heading[1]))) : h('p', {}, inline(line.trim())));
  }
  flush();
  return out;
}
