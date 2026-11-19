import { h, icon } from '../dom.js';
import { isAssistantEnabled } from '../assistant.js';
import { api } from '../api.js';
import { startAccount, startGuest } from '../store.js';
import { env } from '../env.js';

const ADJECTIVES = ['quiet', 'calm', 'still', 'soft', 'gentle', 'steady', 'kind', 'bright', 'warm', 'slow'];
const NOUNS = ['otter', 'river', 'pine', 'harbor', 'meadow', 'lantern', 'willow', 'sparrow', 'pebble', 'cedar'];

function suggestName() {
  const r = new Uint32Array(3);
  crypto.getRandomValues(r);
  return ADJECTIVES[r[0] % ADJECTIVES.length] + '-' + NOUNS[r[1] % NOUNS.length] + '-' + (100 + (r[2] % 900));
}

/** The sign-in page when there is no server: nothing to sign in to, so just a Start button. */
function staticGate(ctx, params) {
  const promises = [
    ['No account, email or real name.', 'There is nothing to sign up for.'],
    ['Nothing is saved.', 'Your answers, checklist and notes stay in this browser tab and are erased when you close it. Nothing you type is sent anywhere.'],
    ['No ads, trackers or analytics.', 'Nothing is loaded from other websites.'],
    ['Quick exit.', 'The button at the top right, or Esc three times, wipes this page and jumps to another site. The screen also hides itself after 10 minutes idle.'],
  ];
  return h('section', { class: 'gate start-first' },
    h('div', { class: 'gate-copy' },
      h('h1', { tabindex: '-1' }, 'A private place to plan stepping away.'),
      h('p', { class: 'lead' }, 'A step-by-step guide to going no contact with an ex, a parent, a friend, or anyone else, built to be quiet and private.'),
      h('ul', { class: 'promises' }, promises.map(([t, d]) => h('li', {}, icon('lock', 16), h('div', {}, h('strong', { text: t }), ' ', d)))),
      h('p', { class: 'fineprint' }, 'An honest limit: this can’t hide that you visited from someone who controls your device or network, and like any website, the company that hosts it can see that a visit happened. If that’s a risk, use a private window on a device they can’t access.')),
    h('div', { class: 'card gate-card stack' },
      params.notice ? h('p', { class: 'notice', role: 'status' }, params.notice) : null,
      h('h2', { text: 'Ready when you are' }),
      h('p', { class: 'muted', text: 'No sign-in needed. Answer a few questions and get a guide built for your situation.' }),
      h('button', { type: 'button', class: 'btn primary block', id: 'start-guest', onclick: () => { startGuest(); ctx.enter(); } }, 'Start the guide'),
      h('p', { class: 'hint center' }, 'Nothing is saved. Everything disappears when you close this tab.')));
}

export function gateView(ctx, params = {}) {
  if (env.staticSite) return staticGate(ctx, params);
  let mode = 'login';
  const formHolder = h('div');

  function drawForm() {
    const reg = mode === 'register';
    const user = h('input', {
      id: 'u', type: 'text', name: 'username', autocomplete: 'username', autocapitalize: 'none',
      spellcheck: 'false', required: true, maxlength: '32',
    });
    const pass = h('input', {
      id: 'p', type: 'password', name: 'passphrase', autocomplete: reg ? 'new-password' : 'current-password',
      required: true, maxlength: '200', minlength: reg ? '10' : null,
    });
    const agree = reg ? h('input', { id: 'agree', type: 'checkbox', required: true }) : null;
    const msg = h('p', { class: 'form-msg', role: 'alert' });
    const submit = h('button', { type: 'submit', class: 'btn primary block' }, reg ? 'Create private account' : 'Sign in');

    const form = h('form', {
      class: 'stack',
      novalidate: false,
      onsubmit: async (e) => {
        e.preventDefault();
        msg.textContent = '';
        submit.disabled = true;
        submit.textContent = reg ? 'Creating…' : 'Signing in…';
        try {
          const name = user.value.trim().toLowerCase();
          const res = reg ? await api.register(name, pass.value) : await api.login(name, pass.value);
          pass.value = '';
          await startAccount(res.username);
          ctx.enter();
        } catch (err) {
          msg.textContent = err.message;
          submit.disabled = false;
          submit.textContent = reg ? 'Create private account' : 'Sign in';
        }
      },
    },
    h('div', { class: 'field' },
      h('label', { for: 'u' }, 'Username'),
      user,
      reg ? h('div', { class: 'field-row' },
        h('p', { class: 'hint' }, 'Not your real name or email. Anything works.'),
        h('button', { type: 'button', class: 'link', onclick: () => { user.value = suggestName(); user.focus(); } }, 'Suggest one')) : null),
    h('div', { class: 'field' },
      h('label', { for: 'p' }, reg ? 'Passphrase' : 'Passphrase'),
      pass,
      reg ? h('p', { class: 'hint' }, 'At least 10 characters. Four random words is stronger than a short, complicated password.') : null),
    reg ? h('label', { class: 'check-row', for: 'agree' }, agree,
      h('span', {}, 'I understand there is no password reset. If I lose my passphrase, my saved notes can’t be recovered.')) : null,
    msg,
    submit);
    formHolder.replaceChildren(form);
  }

  function tab(id, label) {
    return h('button', {
      type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(mode === id), id: 'tab-' + id,
      onclick: () => { mode = id; drawTabs(); drawForm(); },
    }, label);
  }
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  function drawTabs() { tabs.replaceChildren(tab('login', 'Sign in'), tab('register', 'Create account')); }
  drawTabs();
  drawForm();

  const promises = [
    ['No email, phone or real name.', 'Pick any username.'],
    ['Encrypted with your passphrase.', 'Your answers, checklist and notes are scrambled with a key made from your passphrase. Someone who copies the database can’t read them.'],
    isAssistantEnabled()
      ? ['Nothing leaves this site, except what you choose to ask the AI helper.', 'No ads, trackers, analytics or outside fonts. The optional helper only sends what you type into it, and only after you agree. Your browser is told not to keep a copy.']
      : ['Nothing leaves this site.', 'No ads, trackers, analytics or outside fonts. Your browser is told not to keep a copy.'],
    ['Quick exit.', 'The button at the top right, or Esc three times, signs you out and jumps to another site. You’re also signed out after 10 minutes idle.'],
  ];

  return h('section', { class: 'gate start-first' },
    h('div', { class: 'gate-copy' },
      h('h1', { tabindex: '-1' }, 'A private place to plan stepping away.'),
      h('p', { class: 'lead' }, 'A step-by-step guide to going no contact with an ex, a parent, a friend, or anyone else, built to be quiet and private.'),
      h('ul', { class: 'promises' }, promises.map(([t, d]) => h('li', {}, icon('lock', 16), h('div', {}, h('strong', { text: t }), ' ', d)))),
      h('p', { class: 'fineprint' }, 'An honest limit: this can’t hide that you visited from someone who controls your device or network. If that’s a risk, use a private window on a device they can’t access.')),
    h('div', { class: 'card gate-card' },
      params.notice ? h('p', { class: 'notice', role: 'status' }, params.notice) : null,
      tabs,
      formHolder,
      h('div', { class: 'divider' }, h('span', {}, 'or')),
      h('button', { type: 'button', class: 'btn block', onclick: () => { startGuest(); ctx.enter(); } }, 'Continue without an account'),
      h('p', { class: 'hint center' }, 'Nothing is saved. Everything disappears when you close this tab.')));
}
