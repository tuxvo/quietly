import { h, fill, icon, todayString } from '../dom.js';
import { C } from '../content.js';
import { touch } from '../store.js';

/** The opening questions. The first one is: who are you going no contact with? */
export function intakeView(ctx) {
  const d = ctx.store.data;
  const redo = Boolean(d.rel);
  const draft = {
    rel: d.rel,
    answers: JSON.parse(JSON.stringify(d.answers || {})),
    stage: d.stage,
    safety: d.safety,
    startDate: d.startDate,
  };
  let index = 0;
  let shownIndex = -1;
  const wrap = h('section', { class: 'intake' });

  function pages() {
    const list = [{
      key: 'rel', type: 'single', title: 'Who are you going no contact with?',
      help: 'Pick the closest fit. It changes everything this guide shows you.',
      options: C.relOptions,
      get: () => draft.rel,
      set: (v) => { if (draft.rel !== v) { draft.rel = v; draft.answers = {}; } },
    }];
    const track = draft.rel ? C.tracks[draft.rel] : null;
    if (track) {
      for (const q of track.questions) {
        list.push({
          key: 'q-' + q.id, type: q.type, title: q.title, help: q.help, options: q.options,
          get: () => draft.answers[q.id],
          set: (v) => { draft.answers[q.id] = v; },
        });
      }
    }
    const intake = C.core.intake;
    list.push({
      key: 'stage', type: 'single', title: intake.stage.title, help: intake.stage.help, options: intake.stage.options,
      get: () => draft.stage, set: (v) => { draft.stage = v; },
    });
    list.push({
      key: 'safety', type: 'single', title: intake.safety.title, help: intake.safety.help, options: intake.safety.options,
      get: () => draft.safety, set: (v) => { draft.safety = v; },
    });
    if (draft.stage === 'stage_started') {
      list.push({
        key: 'started', type: 'date', title: intake.started.title, help: intake.started.help,
        get: () => draft.startDate || todayString(), set: (v) => { draft.startDate = v; },
      });
    }
    return list;
  }

  function ready(page) {
    if (page.type === 'multi') return true;
    if (page.type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(page.get() || '');
    return Boolean(page.get());
  }

  function finish() {
    d.rel = draft.rel;
    d.answers = draft.answers;
    d.stage = draft.stage;
    d.safety = draft.safety;
    d.startDate = draft.stage === 'stage_started' ? (draft.startDate || todayString()) : null;
    touch();
    ctx.go('home');
  }

  function draw() {
    const list = pages();
    if (index > list.length - 1) index = list.length - 1;
    const page = list[index];
    const last = index === list.length - 1;
    const name = 'opt-' + page.key;

    let body;
    if (page.type === 'date') {
      const input = h('input', { type: 'date', id: 'start-date', max: todayString(), value: page.get() });
      input.addEventListener('input', () => { page.set(input.value); next.disabled = !ready(page); });
      body = h('div', { class: 'field' }, h('label', { for: 'start-date', class: 'sr-only' }, page.title), input);
    } else {
      const current = page.get();
      body = h('div', { class: 'choices', role: page.type === 'single' ? 'radiogroup' : 'group', 'aria-labelledby': 'intake-title' },
        page.options.map((o) => {
          const multi = page.type === 'multi';
          const checked = multi ? (current || []).includes(o.id) : current === o.id;
          const input = h('input', { type: multi ? 'checkbox' : 'radio', name, value: o.id, checked: checked || null });
          input.addEventListener('change', () => {
            if (multi) {
              const set = new Set(page.get() || []);
              if (input.checked) set.add(o.id); else set.delete(o.id);
              page.set([...set]);
            } else {
              page.set(o.id);
              next.disabled = !ready(page);
              if (!last) setTimeout(() => { index += 1; draw(); }, 220);
              else draw();
            }
          });
          return h('label', { class: 'choice' }, input,
            h('span', { class: 'choice-body' }, h('strong', { text: o.label }), o.note ? h('span', { class: 'note', text: o.note }) : null));
        }));
    }

    const next = h('button', {
      type: 'button', class: 'btn primary',
      onclick: () => { if (last) finish(); else { index += 1; draw(); } },
    }, last ? 'Show my guide' : 'Continue');
    next.disabled = !ready(page);

    const back = index > 0
      ? h('button', { type: 'button', class: 'btn ghost', onclick: () => { index -= 1; draw(); } }, icon('back', 16), 'Back')
      : (redo ? h('button', { type: 'button', class: 'btn ghost', onclick: () => ctx.go('settings') }, 'Cancel') : h('span'));

    const safetyNote = page.key === 'safety' && (draft.safety === 'yes' || draft.safety === 'unsure')
      ? h('p', { class: 'callout warn' }, icon('alert', 16), 'Thank you for telling us. The guide will put safety planning first and change how it suggests cutting contact.')
      : null;

    fill(wrap,
      h('p', { class: 'step-count' }, 'Question ' + (index + 1) + ' of ' + list.length),
      h('div', { class: 'progress thin', role: 'presentation' }, h('div', { class: 'bar' })),
      h('h1', { id: 'intake-title', tabindex: '-1' }, page.title),
      page.help ? h('p', { class: 'lead' }, page.help) : null,
      body,
      safetyNote,
      h('div', { class: 'actions between' }, back, next));
    wrap.querySelector('.bar').style.width = Math.round(((index + 1) / list.length) * 100) + '%';
    if (shownIndex !== index) wrap.querySelector('h1').focus({ preventScroll: true });
    shownIndex = index;
  }

  draw();
  return wrap;
}
