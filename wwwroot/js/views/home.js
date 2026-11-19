import { h, put, icon, copyText, confirmDialog, todayString, daysSince, fmtDay } from '../dom.js';
import { C, stepsFor } from '../content.js';
import { touch } from '../store.js';

const TOOLS = {
  reasons: ['urge', { section: 'reasons' }, 'Open my reasons'],
  urge: ['urge', {}, 'Open urge help'],
  contact: ['contact', {}, 'Open “They contacted me”'],
  safety: ['safety', {}, 'Open the safety page'],
  digital: ['safety', { section: 'digital' }, 'Open the digital checklist'],
  privacy: ['safety', { section: 'privacy' }, 'Open “Cover your tracks”'],
  journal: ['journal', {}, 'Open the journal'],
};

export function sourceLinks(ids) {
  const items = (ids || []).map((id) => C.sources[id]).filter(Boolean);
  if (!items.length) return null;
  const nodes = [];
  items.forEach((s, i) => {
    if (i > 0) nodes.push(', ');
    nodes.push(h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', title: s.title }, s.by));
  });
  return h('p', { class: 'src' }, 'Based on: ', nodes);
}

export function scriptBlock(script) {
  return h('div', { class: 'script' },
    h('div', { class: 'script-label', text: script.label }),
    h('blockquote', { text: script.text }),
    h('button', { type: 'button', class: 'btn ghost sm', onclick: () => copyText(script.text) }, icon('copy', 14), 'Copy'));
}

export function homeView(ctx) {
  const { store } = ctx;
  const d = store.data;
  const track = C.tracks[d.rel];
  const steps = stepsFor(d);
  const phases = C.core.phases;
  const open = new Set();
  const firstOpen = phases.find((p) => steps.some((s) => s.phase === p.id && !d.done[s.id]));
  open.add(firstOpen ? firstOpen.id : phases[0].id);

  const root = h('div', { class: 'stack-lg' });
  const progressText = h('span', { class: 'muted' });
  const progressBar = h('div', { class: 'bar' });
  const phaseSections = [];

  function updateProgress() {
    const done = steps.filter((s) => d.done[s.id]).length;
    progressText.textContent = done + ' of ' + steps.length + ' steps done';
    progressBar.style.width = (steps.length ? Math.round((done / steps.length) * 100) : 0) + '%';
    phaseSections.forEach(({ phase, count }) => {
      const list = steps.filter((s) => s.phase === phase.id);
      count.textContent = list.filter((s) => d.done[s.id]).length + '/' + list.length;
    });
  }

  function stepCard(step) {
    const body = h('div', { class: 'step-body', hidden: true },
      h('ul', { class: 'how' }, step.how.map((t) => h('li', { text: t }))),
      step.scripts.map(scriptBlock),
      step.tool && TOOLS[step.tool]
        ? h('div', { class: 'step-actions' }, h('button', {
          type: 'button', class: 'btn sm', onclick: () => ctx.go(TOOLS[step.tool][0], TOOLS[step.tool][1]),
        }, TOOLS[step.tool][2]))
        : null,
      sourceLinks(step.src));

    const check = h('input', { type: 'checkbox', 'aria-label': 'Mark done: ' + step.title, checked: d.done[step.id] ? true : null });
    const card = h('article', { class: 'step' + (d.done[step.id] ? ' done' : '') });
    check.addEventListener('change', () => {
      if (check.checked) d.done[step.id] = true; else delete d.done[step.id];
      card.classList.toggle('done', check.checked);
      touch();
      updateProgress();
    });

    const toggle = h('button', { type: 'button', class: 'step-toggle', 'aria-expanded': 'false' },
      h('span', { class: 'step-text' }, h('span', { class: 'step-title', text: step.title }), h('span', { class: 'step-summary', text: step.summary })),
      icon('chevron', 18));
    toggle.addEventListener('click', () => {
      const isOpen = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!isOpen));
      body.hidden = isOpen;
      card.classList.toggle('open', !isOpen);
    });

    card.append(h('div', { class: 'step-head' }, h('label', { class: 'check' }, check, h('span', { class: 'box' }, icon('check', 14))), toggle), body);
    return card;
  }

  function counterCard() {
    const n = daysSince(d.startDate);
    const box = h('div', { class: 'card counter' });
    if (n) {
      box.append(
        h('div', { class: 'big', 'aria-hidden': 'true', text: String(n) }),
        h('div', { class: 'counter-text' },
          h('strong', { text: 'Day ' + n }),
          h('p', { class: 'muted', text: 'since ' + fmtDay(d.startDate) + '. Every day counts, including the hard ones.' })),
        h('button', {
          type: 'button', class: 'btn ghost sm',
          onclick: async () => {
            const yes = await confirmDialog({
              title: 'Start the count again?',
              text: 'If you slipped, that doesn’t undo what you’ve done or learned. You can reset the counter to day 1 today and keep going.',
              confirmLabel: 'Reset to day 1',
            });
            if (yes) { d.startDate = todayString(); touch(); ctx.go('home'); }
          },
        }, 'Start again'));
    } else {
      box.append(
        h('div', { class: 'counter-text' },
          h('strong', { text: 'Ready when you are' }),
          h('p', { class: 'muted', text: 'When you stop contact, start a day count. It’s private, and you can reset it any time.' })),
        h('button', {
          type: 'button', class: 'btn primary sm',
          onclick: () => { d.startDate = todayString(); d.stage = 'stage_started'; touch(); ctx.go('home'); },
        }, 'Start day 1 today'));
    }
    return box;
  }

  const wantsSafety = d.safety === 'yes' || d.safety === 'unsure';

  put(root,
    h('header', { class: 'page-head' },
      h('h1', { tabindex: '-1', text: track.intro.title }),
      track.intro.body.map((t) => h('p', { class: 'lead', text: t }))),
    wantsSafety ? h('div', { class: 'callout warn' },
      icon('alert', 18),
      h('div', {},
        h('strong', { text: 'Safety comes first. ' }),
        'You said you may not be safe with this person. Before you block them or tell them anything, read the safety page and consider calling an advocate.',
        h('div', { class: 'step-actions' },
          h('button', { type: 'button', class: 'btn sm primary', onclick: () => ctx.go('safety') }, 'Open the safety page'),
          h('button', { type: 'button', class: 'btn sm', onclick: () => ctx.go('resources') }, 'Hotlines')))) : null,
    counterCard(),
    h('div', { class: 'quick' },
      h('button', { type: 'button', class: 'quick-btn urge', onclick: () => ctx.go('urge') },
        h('strong', { text: 'I want to reach out right now' }), h('span', { text: 'Ten minutes, a plan, and something to do instead.' })),
      h('button', { type: 'button', class: 'quick-btn', onclick: () => ctx.go('contact') },
        h('strong', { text: 'They contacted me' }), h('span', { text: 'What it usually means, and what to say.' }))),
    h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('strong', { text: 'Your progress' }), progressText),
      h('div', { class: 'progress' }, progressBar)),
    h('details', { class: 'card fold' },
      h('summary', {}, 'The short version'),
      h('ol', { class: 'rules' }, C.core.rules.map((r) => h('li', {}, h('strong', { text: r.title }), ' ', r.body)))),
    h('details', { class: 'card fold' },
      h('summary', {}, 'What to expect'),
      h('ul', { class: 'expect' }, track.expect.map((e) => h('li', {}, h('strong', { text: e.title }), ' ', e.body)))));

  phases.forEach((phase) => {
    const list = steps.filter((s) => s.phase === phase.id);
    if (!list.length) return;
    const count = h('span', { class: 'count' });
    const content = h('div', { class: 'phase-body', hidden: !open.has(phase.id) }, list.map(stepCard));
    const head = h('button', { type: 'button', class: 'phase-head', 'aria-expanded': String(open.has(phase.id)) },
      h('span', { class: 'phase-text' }, h('span', { class: 'phase-title', text: phase.title }), h('span', { class: 'phase-blurb', text: phase.blurb })),
      count, icon('chevron', 18));
    head.addEventListener('click', () => {
      const isOpen = head.getAttribute('aria-expanded') === 'true';
      head.setAttribute('aria-expanded', String(!isOpen));
      content.hidden = isOpen;
    });
    phaseSections.push({ phase, count });
    root.append(h('section', { class: 'phase' }, head, content));
  });

  root.append(h('p', { class: 'fineprint' }, C.core.disclaimer, ' ',
    h('button', { type: 'button', class: 'link', onclick: () => ctx.go('resources') }, 'Sources and further reading')));

  updateProgress();
  return root;
}
