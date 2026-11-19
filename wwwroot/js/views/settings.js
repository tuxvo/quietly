import { h, toast, modal, confirmDialog, todayString } from '../dom.js';
import { C } from '../content.js';
import { api } from '../api.js';
import { touch, flush, DEFAULT_EXIT } from '../store.js';
import { isAssistantEnabled, resetAssistant } from '../assistant.js';
import { env } from '../env.js';

export function settingsView(ctx) {
  const { store } = ctx;
  const d = store.data;
  const track = C.tracks[d.rel];
  const isAccount = store.mode === 'account';

  const exitUrl = h('input', { type: 'url', id: 'exit-url', value: d.prefs.exitUrl || DEFAULT_EXIT, spellcheck: 'false', autocomplete: 'off' });
  const lock = h('select', { id: 'lock', 'aria-label': 'Sign out after being idle' },
    [[5, '5 minutes'], [10, '10 minutes'], [30, '30 minutes']].map(([v, t]) => h('option', { value: String(v), selected: Number(d.prefs.lockMin) === v ? true : null }, t)));
  const start = h('input', { type: 'date', id: 'start', max: todayString(), value: d.startDate || '' });

  const aiShow = h('input', { type: 'checkbox', id: 'ai-show', checked: d.prefs.aiHide ? null : true });
  aiShow.addEventListener('change', () => {
    d.prefs.aiHide = !aiShow.checked;
    if (d.prefs.aiHide) resetAssistant();
    touch();
    ctx.syncAssistant();
    toast('Saved');
  });

  function savePrefs() {
    let url;
    try {
      url = new URL(exitUrl.value.trim() || DEFAULT_EXIT);
      if (url.protocol !== 'https:') throw new Error('The quick exit address must start with https://');
    } catch (e) {
      toast(e.message || 'That doesn’t look like a web address.', 'err');
      return;
    }
    d.prefs.exitUrl = url.href;
    d.prefs.lockMin = Number(lock.value);
    d.startDate = /^\d{4}-\d{2}-\d{2}$/.test(start.value) ? start.value : null;
    touch();
    ctx.refreshIdle();
    toast('Saved');
  }

  function exportData() {
    const payload = { exportedOn: todayString(), guide: d.rel, progress: d, journal: store.journal };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'my-data.json' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function deleteAccount() {
    const pass = h('input', { type: 'password', id: 'del-pass', autocomplete: 'current-password', 'aria-label': 'Your passphrase' });
    const msg = h('p', { class: 'form-msg', role: 'alert' });
    const res = await modal({
      title: 'Delete everything?',
      body: h('div', { class: 'stack' },
        h('p', { text: 'This permanently deletes your account, progress, reasons, contact log and every note. It can’t be undone.' }),
        h('label', { for: 'del-pass' }, 'Enter your passphrase to confirm'), pass, msg),
      actions: [
        { label: 'Cancel' },
        { label: 'Delete everything', kind: 'danger', value: () => { if (!pass.value) { msg.textContent = 'Enter your passphrase.'; return false; } return pass.value; } },
      ],
    });
    if (!res || res === 'Cancel') return;
    try {
      await api.deleteAccount(res);
      ctx.signOut('Your account and everything in it has been deleted.', { server: false });
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function eraseGuest() {
    const yes = await confirmDialog({ title: 'Erase everything on this screen?', text: 'Your answers, progress and notes in this guest session will be erased.', confirmLabel: 'Erase', danger: true });
    if (yes) ctx.signOut('Everything from that guest session has been erased.', { server: false });
  }

  return h('div', { class: 'stack-lg' },
    h('header', { class: 'page-head' }, h('h1', { tabindex: '-1', text: 'Settings' })),

    h('section', { class: 'card stack' },
      h('h2', { text: 'Account' }),
      isAccount
        ? h('p', {}, 'Signed in as ', h('strong', { text: store.username }), '. Your data is saved, encrypted with your passphrase.')
        : env.staticSite
          ? h('p', {}, 'You’re using the guide without an account. Nothing is saved, so closing this tab erases everything.')
          : h('p', {}, 'You’re in guest mode. Nothing is saved. ', h('button', { type: 'button', class: 'link', onclick: () => ctx.signOut('', { server: false }) }, 'Create an account to keep your progress.')),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => ctx.signOut(isAccount ? 'You’re signed out.' : 'Everything from that session has been erased.') }, isAccount ? 'Sign out' : 'Leave'))),

    h('section', { class: 'card stack' },
      h('h2', { text: 'This guide' }),
      h('p', {}, 'Currently set up for: ', h('strong', { text: track ? track.label : 'not set' }), '.'),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => ctx.go('intake') }, 'Change who it’s about, or my answers')),
      h('div', { class: 'field' }, h('label', { for: 'start' }, 'First day of no contact'), start)),

    h('section', { class: 'card stack' },
      h('h2', { text: 'Privacy' }),
      h('div', { class: 'field' },
        h('label', { for: 'exit-url' }, 'Quick exit goes to'), exitUrl,
        h('p', { class: 'hint', text: 'Pick a site that looks ordinary on your screen. It signs you out first. It can’t clear your browser’s history, so a private window is still a good idea.' })),
      h('div', { class: 'field' }, h('label', { for: 'lock' }, 'Sign me out after being idle for'), lock),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn primary', onclick: savePrefs }, 'Save settings'))),

    isAssistantEnabled() ? h('section', { class: 'card stack' },
      h('h2', { text: 'AI helper' }),
      h('p', { class: 'muted', text: 'A round button at the bottom right opens a chat for questions the guide doesn’t answer. Only what you type there is sent, to Google’s Gemini. Your answers, journal and username are never sent, and the chat isn’t saved.' }),
      h('label', { class: 'check-row', for: 'ai-show' }, aiShow, h('span', {}, 'Show the helper button'))) : null,

    h('section', { class: 'card stack' },
      h('h2', { text: 'Your data' }),
      h('p', { class: 'muted', text: 'Download everything you’ve saved here as a file. Store it somewhere private.' }),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', onclick: exportData }, 'Download my data'),
        isAccount
          ? h('button', { type: 'button', class: 'btn danger', onclick: deleteAccount }, 'Delete my account and data')
          : h('button', { type: 'button', class: 'btn danger', onclick: eraseGuest }, 'Erase this session'))),

    h('p', { class: 'fineprint', text: C.core.disclaimer }));
}

export { flush };
