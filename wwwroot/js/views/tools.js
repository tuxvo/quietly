// The "in the moment" tools: urge help, "they contacted me", and the private journal.

import { h, icon, confirmDialog, toast, todayString, fmtDay } from '../dom.js';
import { C } from '../content.js';
import { touch, addNote, removeNote } from '../store.js';
import { scriptBlock } from './home.js';

// ---------------------------------------------------------------- editable list (reasons, reality)

function listEditor({ items, max, placeholder, label, onChange }) {
  const wrap = h('div', { class: 'list-editor' });
  function draw() {
    const input = h('input', { type: 'text', maxlength: '300', placeholder, 'aria-label': label });
    const add = () => {
      const v = input.value.trim();
      if (!v) return;
      if (items.length >= max) { toast('That’s the maximum for this list.', 'err'); return; }
      items.push(v);
      onChange();
      draw();
      wrap.querySelector('input').focus();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    wrap.replaceChildren(
      items.length ? h('ol', { class: 'items' }, items.map((t, i) => h('li', {},
        h('span', { text: t }),
        h('button', {
          type: 'button', class: 'icon-btn', 'aria-label': 'Remove: ' + t,
          onclick: () => { items.splice(i, 1); onChange(); draw(); },
        }, icon('x', 16))))) : h('p', { class: 'muted empty', text: 'Nothing here yet.' }),
      h('div', { class: 'add-row' }, input, h('button', { type: 'button', class: 'btn', onclick: add }, icon('plus', 16), 'Add')));
  }
  draw();
  return wrap;
}

// ---------------------------------------------------------------- urge help

export function urgeView(ctx) {
  const d = ctx.store.data;
  const urge = C.core.urge;
  let end = 0;
  let tick = null;

  const clock = h('div', { class: 'clock', 'aria-hidden': 'true', text: '10:00' });
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  const bar = h('div', { class: 'bar' });
  const timerNote = h('p', { class: 'muted' }, 'Most urges rise, peak and fall on their own. Give this one ten minutes.');
  const timerActions = h('div', { class: 'actions' });
  const counter = h('p', { class: 'muted' });

  function updateCounter() {
    counter.textContent = d.urges ? 'Urges you’ve waited out: ' + d.urges : '';
  }

  function drawActions(state) {
    if (state === 'idle') {
      timerActions.replaceChildren(h('button', { type: 'button', class: 'btn primary', onclick: start }, icon('clock', 16), 'Start 10 minutes'));
    } else if (state === 'running') {
      timerActions.replaceChildren(
        h('button', { type: 'button', class: 'btn', onclick: passed }, 'It’s passed'),
        h('button', { type: 'button', class: 'btn ghost', onclick: stop }, 'Stop timer'));
    } else {
      timerActions.replaceChildren(
        h('button', { type: 'button', class: 'btn primary', onclick: passed }, 'It’s passed'),
        h('button', { type: 'button', class: 'btn', onclick: start }, 'Still strong: 10 more minutes'));
    }
  }

  function render() {
    const left = Math.max(0, end - Date.now());
    const s = Math.ceil(left / 1000);
    clock.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    bar.style.width = (100 - Math.round((left / 600000) * 100)) + '%';
    if (left === 0 && tick) {
      clearInterval(tick); tick = null;
      timerNote.textContent = 'Time’s up. How strong is the urge now?';
      live.textContent = 'Ten minutes are up.';
      drawActions('done');
    }
  }

  function start() {
    end = Date.now() + 600000;
    clearInterval(tick);
    tick = setInterval(render, 250);
    timerNote.textContent = 'You don’t have to do anything right now. Read your reasons, or try one thing below.';
    drawActions('running');
    render();
  }
  function stop() {
    clearInterval(tick); tick = null;
    clock.textContent = '10:00'; bar.style.width = '0%';
    timerNote.textContent = 'Most urges rise, peak and fall on their own. Give this one ten minutes.';
    drawActions('idle');
  }
  function passed() {
    clearInterval(tick); tick = null;
    d.urges = (d.urges || 0) + 1;
    touch(); updateCounter();
    clock.textContent = '10:00'; bar.style.width = '0%';
    timerNote.textContent = 'That’s one more urge waited out. It really does get easier.';
    toast('One more waited out. Well done.');
    drawActions('idle');
  }
  drawActions('idle');
  updateCounter();

  // what's underneath
  const feelingOut = h('div', { class: 'feeling-out', 'aria-live': 'polite' });
  const chips = h('div', { class: 'chips' }, urge.feelings.map((f) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': 'false',
    onclick: (e) => {
      chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
      e.currentTarget.setAttribute('aria-pressed', 'true');
      feelingOut.replaceChildren(h('p', {}, h('strong', { text: f.note })), h('p', {}, h('span', { class: 'tag', text: 'Try this' }), ' ', f.instead));
    },
  }, f.label)));

  // unsent message
  const unsent = h('textarea', { rows: '5', maxlength: '2000', placeholder: 'Say all of it here. Nothing is saved or sent.', 'aria-label': 'Unsent message' });

  const root = h('div', { class: 'stack-lg' },
    h('header', { class: 'page-head' },
      h('h1', { tabindex: '-1', text: 'I want to reach out' }),
      h('p', { class: 'lead', text: urge.intro })),
    h('section', { class: 'card timer' },
      clock, h('div', { class: 'progress' }, bar), timerNote, live, timerActions, counter),
    h('section', { class: 'card' },
      h('h2', { text: 'Five steps' }),
      h('ol', { class: 'routine' }, urge.routine.map((r) => h('li', {}, h('strong', { text: r.title }), ' ', r.body)))),
    h('section', { class: 'card' },
      h('h2', { text: 'What’s underneath it?' }), chips, feelingOut),
    h('section', { class: 'card', id: 'reasons' },
      h('h2', { text: 'Your reasons' }),
      h('p', { class: 'muted', text: 'Specific things that happened, and how they made you feel. Read this when the pull gets strong.' }),
      listEditor({ items: d.reasons, max: 30, placeholder: 'e.g. “On my birthday they didn’t show up and blamed me.”', label: 'Add a reason', onChange: touch })),
    h('section', { class: 'card', id: 'reality' },
      h('h2', { text: 'What it was really like' }),
      h('p', { class: 'muted', text: 'The unglamorous parts that nostalgia leaves out.' }),
      listEditor({ items: d.reality, max: 30, placeholder: 'e.g. “I felt anxious every time my phone buzzed.”', label: 'Add something real', onChange: touch })),
    h('section', { class: 'card' },
      h('h2', { text: 'Write it, don’t send it' }),
      h('p', { class: 'muted', text: 'Get every word out. When you’re done, let it go.' }),
      unsent,
      h('div', { class: 'actions' }, h('button', {
        type: 'button', class: 'btn', onclick: () => { unsent.value = ''; toast('Gone. Nothing was saved or sent.'); },
      }, 'Let it go'))),
    h('section', { class: 'card' },
      h('h2', { text: 'Do something different' }),
      h('ul', { class: 'ideas' }, urge.ideas.map((t) => h('li', { text: t })))));

  root._cleanup = () => clearInterval(tick);
  return root;
}

// ---------------------------------------------------------------- they contacted me

const DID = [
  'I ignored it',
  'I blocked or muted',
  'I told someone',
  'I reported it',
  'I replied briefly',
  'I reached out to them first',
];

export function contactView(ctx) {
  const d = ctx.store.data;
  const contact = C.core.contact;
  const types = contact.types.filter((t) => !t.only || t.only.includes(d.rel));
  let selected = null;

  const detail = h('div', { 'aria-live': 'polite' });
  const logHolder = h('section', { class: 'card' });

  function drawLog() {
    const list = d.contacts || [];
    logHolder.replaceChildren(
      h('h2', { text: 'Your contact log' }),
      h('p', { class: 'muted', text: 'Private, and only for you. Patterns show up here, and a record helps if you ever need to report something.' }),
      list.length ? h('ul', { class: 'log' }, list.slice().reverse().map((e, ri) => {
        const i = list.length - 1 - ri;
        return h('li', {},
          h('div', {}, h('strong', { text: fmtDay(e.at) }), ' · ', e.type, ' · ', h('em', { text: e.did })),
          e.note ? h('p', { class: 'muted', text: e.note }) : null,
          h('button', {
            type: 'button', class: 'icon-btn', 'aria-label': 'Delete this log entry',
            onclick: () => { d.contacts.splice(i, 1); touch(); drawLog(); },
          }, icon('trash', 16)));
      })) : h('p', { class: 'muted empty', text: 'Nothing logged yet.' }));
  }

  function drawDetail() {
    if (!selected) { detail.replaceChildren(); return; }
    const t = selected;
    const scripts = (t.scripts || []).filter((s) => !s.for || s.for.includes(d.rel));
    const didSel = h('select', { id: 'did', 'aria-label': 'What I did' }, DID.map((x) => h('option', { value: x, text: x })));
    const note = h('textarea', { rows: '3', maxlength: '500', placeholder: 'Optional: what they said, or how you felt.', 'aria-label': 'Note' });
    const msg = h('div', { 'aria-live': 'polite' });

    detail.replaceChildren(h('div', { class: 'card stack' },
      h('h2', { text: t.label }),
      h('p', { class: 'quote', text: t.looksLike }),
      h('p', { text: t.whatItIs }),
      h('h3', { text: 'What you can do' }),
      h('ul', { class: 'how' }, t.do.map((x) => h('li', { text: x }))),
      scripts.length ? h('h3', { text: 'If you want to say something' }) : null,
      scripts.map(scriptBlock),
      h('h3', { text: 'Log it' }),
      h('div', { class: 'field' }, h('label', { for: 'did' }, 'What did you do?'), didSel),
      note,
      h('div', { class: 'actions' }, h('button', {
        type: 'button', class: 'btn primary',
        onclick: () => {
          if (!d.contacts) d.contacts = [];
          if (d.contacts.length >= 200) d.contacts.shift();
          d.contacts.push({ at: todayString(), type: t.label, did: didSel.value, note: note.value.trim() });
          touch(); drawLog(); toast('Logged');
          msg.replaceChildren();
          if (didSel.value === 'I reached out to them first') {
            msg.replaceChildren(h('div', { class: 'callout' }, icon('shield', 18), h('div', {},
              h('strong', { text: 'That doesn’t erase your progress. ' }),
              'Slips are common, and what you’ve learned stays. Be kind to yourself, and decide what you’d like to do next.',
              h('div', { class: 'step-actions' }, h('button', {
                type: 'button', class: 'btn sm', onclick: () => { d.startDate = todayString(); touch(); toast('Day count reset to day 1'); },
              }, 'Reset my day count')))));
          }
        },
      }, 'Save to log')),
      msg));
    detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  const list = h('div', { class: 'choices' }, types.map((t) => h('button', {
    type: 'button', class: 'choice-btn', 'aria-pressed': 'false',
    onclick: (e) => {
      list.querySelectorAll('.choice-btn').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      e.currentTarget.setAttribute('aria-pressed', 'true');
      selected = t; drawDetail();
    },
  }, h('strong', { text: t.label }), h('span', { class: 'note', text: t.looksLike }))));

  drawLog();
  return h('div', { class: 'stack-lg' },
    h('header', { class: 'page-head' },
      h('h1', { tabindex: '-1', text: 'They contacted me' }),
      h('p', { class: 'lead', text: contact.intro })),
    h('div', { class: 'callout warn' }, icon('alert', 18), h('div', {},
      contact.safetyFirst,
      h('div', { class: 'step-actions' }, h('button', { type: 'button', class: 'btn sm', onclick: () => ctx.go('safety') }, 'Open the safety page')))),
    h('section', { class: 'stack' }, h('h2', { text: 'What did they send, or do?' }), list),
    detail,
    logHolder);
}

// ---------------------------------------------------------------- journal

const PROMPTS = [
  'What I’m feeling right now',
  'Why I’m doing this',
  'One thing I’m proud of today',
  'What I’d say if I could say anything',
  'What I need this week',
];

export function journalView(ctx) {
  const { store } = ctx;
  const holder = h('section', { class: 'stack' });
  const area = h('textarea', { rows: '6', maxlength: '8000', placeholder: 'Write whatever you need to. Only you can read this.', 'aria-label': 'New note' });
  const msg = h('p', { class: 'form-msg', role: 'alert' });
  const saveBtn = h('button', { type: 'button', class: 'btn primary' }, 'Save note');

  saveBtn.addEventListener('click', async () => {
    const text = area.value.trim();
    msg.textContent = '';
    if (!text) { msg.textContent = 'Write something first.'; return; }
    saveBtn.disabled = true;
    try {
      await addNote(text, todayString());
      area.value = '';
      drawList();
      toast('Saved');
    } catch (e) {
      msg.textContent = e.message;
    } finally {
      saveBtn.disabled = false;
    }
  });

  function drawList() {
    const notes = store.journal;
    holder.replaceChildren(...(notes.length
      ? notes.map((n) => {
        const del = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Delete this note' }, icon('trash', 16));
        let armed = false;
        del.addEventListener('click', async () => {
          if (!armed) { armed = true; del.classList.add('armed'); del.setAttribute('aria-label', 'Click again to delete this note'); toast('Click the bin again to delete'); setTimeout(() => { armed = false; del.classList.remove('armed'); }, 3000); return; }
          try { await removeNote(n.id); drawList(); } catch (e) { toast(e.message, 'err'); }
        });
        return h('article', { class: 'card note-card' },
          h('div', { class: 'row between' }, h('strong', { text: fmtDay(n.at) }), del),
          h('p', { class: 'note-text', text: n.text }));
      })
      : [h('p', { class: 'muted empty', text: 'No notes yet.' })]));
  }
  drawList();

  return h('div', { class: 'stack-lg' },
    h('header', { class: 'page-head' },
      h('h1', { tabindex: '-1', text: 'Journal' }),
      h('p', { class: 'lead', text: store.mode === 'account'
        ? 'Private notes, encrypted with your passphrase.'
        : 'Guest mode: these notes are not saved and disappear when you close this tab.' })),
    h('section', { class: 'card stack' },
      h('div', { class: 'chips' }, PROMPTS.map((p) => h('button', {
        type: 'button', class: 'chip',
        onclick: () => { area.value = (area.value ? area.value + '\n\n' : '') + p + ':\n'; area.focus(); },
      }, p))),
      area, msg, h('div', { class: 'actions' }, saveBtn)),
    holder);
}
