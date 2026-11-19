// The person's data in memory, and saving it. In "account" mode it is saved (encrypted by the server).
// In "guest" mode it is never saved anywhere: it lives only in this tab and disappears when it closes.

import { api } from './api.js';

export const DEFAULT_EXIT = 'https://www.google.com';

export function defaultState() {
  return {
    v: 1,
    rel: null,              // ex | parent | friend | other
    answers: {},            // answers to the follow-up questions for that path
    stage: null,            // stage_deciding | stage_preparing | stage_started
    safety: null,           // yes | unsure | no
    startDate: null,        // yyyy-MM-dd, the first day of no contact
    done: {},               // step id -> true
    checks: {},             // safety checklist item id -> true
    reasons: [],
    reality: [],
    urges: 0,               // urges waited out
    contacts: [],           // contact log
    prefs: { exitUrl: DEFAULT_EXIT, lockMin: 10, aiConsent: false, aiHide: false },
  };
}

export const store = {
  mode: 'none',             // none | guest | account
  username: null,
  data: defaultState(),
  journal: [],
  onStatus: () => {},
  _timer: null,
  _dirty: false,
  _guestId: 0,
};

function merge(saved) {
  const base = defaultState();
  return { ...base, ...saved, prefs: { ...base.prefs, ...(saved && saved.prefs ? saved.prefs : {}) } };
}

export async function startAccount(username) {
  store.mode = 'account';
  store.username = username;
  const res = await api.getState();
  store.data = res && res.state ? merge(res.state) : defaultState();
  const j = await api.journalList();
  store.journal = (j && j.entries) || [];
}

export function startGuest() {
  store.mode = 'guest';
  store.username = null;
  store.data = defaultState();
  store.journal = [];
}

export function wipe() {
  clearTimeout(store._timer);
  store.mode = 'none';
  store.username = null;
  store.data = defaultState();
  store.journal = [];
  store._dirty = false;
}

/** Call after changing store.data. Saves a moment later (account mode only). */
export function touch() {
  if (store.mode !== 'account') return;
  store._dirty = true;
  store.onStatus('saving');
  clearTimeout(store._timer);
  store._timer = setTimeout(flush, 700);
}

export async function flush() {
  clearTimeout(store._timer);
  if (store.mode !== 'account' || !store._dirty) return;
  store._dirty = false;
  try {
    await api.putState(JSON.stringify(store.data));
    store.onStatus('saved');
  } catch (e) {
    store._dirty = true;
    store.onStatus('error', e);
  }
}

// ---- journal ----

export async function addNote(text, day) {
  if (store.mode === 'account') {
    const entry = await api.journalAdd(text, day);
    store.journal.unshift(entry);
    return entry;
  }
  store._guestId -= 1;
  const entry = { id: store._guestId, text, at: day };
  store.journal.unshift(entry);
  return entry;
}

export async function removeNote(id) {
  if (store.mode === 'account') await api.journalDelete(id);
  store.journal = store.journal.filter((n) => n.id !== id);
}
