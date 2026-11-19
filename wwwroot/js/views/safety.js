import { h, icon } from '../dom.js';
import { C } from '../content.js';
import { touch } from '../store.js';
import { sourceLinks } from './home.js';

function resourceCard(r, compact = false) {
  return h('article', { class: 'card resource' + (compact ? ' compact' : '') },
    h('div', { class: 'row between wrap' },
      h('h3', { text: r.name }),
      h('span', { class: 'tag', text: r.region })),
    compact ? null : h('p', { class: 'muted', text: r.desc }),
    h('p', { class: 'contact-line' }, r.tel
      ? h('a', { href: 'tel:' + r.tel }, r.contact)
      : h('span', { text: r.contact })),
    r.url ? h('a', { class: 'btn sm', href: r.url, target: '_blank', rel: 'noopener noreferrer' }, 'Visit site', icon('external', 14)) : null);
}

export function safetyView(ctx) {
  const d = ctx.store.data;
  const S = C.core.safety;

  function checklist(id, section) {
    const progress = h('span', { class: 'muted' });
    const update = () => {
      progress.textContent = section.items.filter((i) => d.checks[i.id]).length + ' of ' + section.items.length + ' done';
    };
    const list = h('ul', { class: 'checklist' }, section.items.map((item) => {
      const cb = h('input', { type: 'checkbox', 'aria-label': item.title, checked: d.checks[item.id] ? true : null });
      cb.addEventListener('change', () => {
        if (cb.checked) d.checks[item.id] = true; else delete d.checks[item.id];
        touch(); update();
      });
      return h('li', {},
        h('label', { class: 'check' }, cb, h('span', { class: 'box' }, icon('check', 14))),
        h('div', {}, h('strong', { text: item.title }), h('p', { class: 'muted', text: item.body })));
    }));
    update();
    return h('section', { class: 'card', id },
      h('div', { class: 'row between wrap' }, h('h2', { text: section.title }), progress),
      h('p', { class: 'muted', text: section.intro }),
      list);
  }

  const urgent = C.core.resources.filter((r) => ['r-ndvh', 'r-988', 'r-emergency'].includes(r.id));

  return h('div', { class: 'stack-lg' },
    h('header', { class: 'page-head' },
      h('h1', { tabindex: '-1', text: 'Safety' }),
      h('p', { class: 'lead', text: S.intro })),
    h('section', { class: 'stack' },
      h('h2', { text: 'If you need someone right now' }),
      h('div', { class: 'grid' }, urgent.map((r) => resourceCard(r, true)))),
    h('section', { class: 'card', id: 'signs' },
      h('h2', { text: S.signs.title }),
      h('p', { class: 'muted', text: S.signs.intro }),
      h('ul', { class: 'how' }, S.signs.items.map((t) => h('li', { text: t }))),
      h('p', { class: 'callout warn' }, icon('alert', 16), S.signs.note),
      sourceLinks(['ds-safety'])),
    checklist('plan', S.plan),
    checklist('digital', S.digital),
    checklist('privacy', S.privacy),
    h('section', { class: 'card', id: 'legal' },
      h('h2', { text: S.legal.title }),
      h('p', { class: 'muted', text: S.legal.intro }),
      h('dl', { class: 'defs' }, S.legal.items.map((i) => h('div', {}, h('dt', { text: i.title }), h('dd', { text: i.body })))),
      sourceLinks(['ds-safety'])),
    h('section', { class: 'card', id: 'selfharm' },
      h('h2', { text: S.selfHarm.title }),
      h('p', { text: S.selfHarm.body })));
}

export function resourcesView() {
  const sources = C.core.sources;
  return h('div', { class: 'stack-lg' },
    h('header', { class: 'page-head' },
      h('h1', { tabindex: '-1', text: 'Resources' }),
      h('p', { class: 'lead', text: 'Free, confidential support. Numbers listed are for the United States unless noted. If you’re elsewhere, Find a Helpline lists services by country.' })),
    h('div', { class: 'grid' }, C.core.resources.map((r) => resourceCard(r))),
    h('section', { class: 'card' },
      h('h2', { text: 'Sources and further reading' }),
      h('p', { class: 'muted', text: 'The guide’s advice is drawn from these. The wording is our own. Please read them for more depth.' }),
      h('ul', { class: 'sources' }, sources.map((s) => h('li', {},
        h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title), ' ',
        h('span', { class: 'muted', text: '· ' + s.by }))))),
    h('p', { class: 'fineprint', text: C.core.disclaimer }));
}
