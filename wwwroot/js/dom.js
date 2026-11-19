// Tiny DOM helpers. Everything is built with createElement/textContent, never innerHTML,
// so anything a person types (notes, reasons) can never be interpreted as markup.

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Flattens nested arrays and turns children into DOM nodes. null, undefined and false are skipped. */
function toNodes(kids) {
  const out = [];
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    out.push(typeof kid === 'object' && kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return out;
}

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.length > 2 && k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  el.append(...toNodes(kids));
  return el;
}

/**
 * Null-safe versions of parent.append() and parent.replaceChildren().
 * The native methods print the word "null" for a null child, so use these whenever a child may be conditional.
 */
export function put(parent, ...kids) { parent.append(...toNodes(kids)); return parent; }
export function fill(parent, ...kids) { parent.replaceChildren(...toNodes(kids)); return parent; }

const ICONS = {
  lock: 'M7 11V8a5 5 0 0 1 10 0v3 M5 11h14v9H5z',
  exit: 'M10 4H5v16h5 M15 8l4 4-4 4 M9 12h10',
  chevron: 'M6 9l6 6 6-6',
  check: 'M5 12l5 5 9-10',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  copy: 'M9 9h10v11H9z M5 15V4h10',
  trash: 'M5 7h14 M10 7V4h4v3 M7 7l1 13h8l1-13',
  plus: 'M12 5v14 M5 12h14',
  download: 'M12 4v11 M7 11l5 5 5-5 M5 20h14',
  pen: 'M4 20l1-4L16 5l3 3L8 19z',
  alert: 'M12 4l9 16H3z M12 10v4 M12 17v.5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2',
  external: 'M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6',
  back: 'M15 6l-6 6 6 6',
  x: 'M6 6l12 12 M18 6L6 18',
  chat: 'M5 5h14v11H10l-4 4v-4H5z M9 10.5v.01 M12 10.5v.01 M15 10.5v.01',
  send: 'M5 12l14-7-5 14-2-6z',
};

export function icon(name, size = 18) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const parts = (ICONS[name] || '').split(' M');
  parts.forEach((d, i) => {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', i === 0 ? d : 'M' + d);
    svg.appendChild(p);
  });
  return svg;
}

export function toast(message, kind = '') {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = h('div', { class: 'toast ' + kind, text: message });
  box.appendChild(t);
  setTimeout(() => t.remove(), 3800);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch {
    const ta = h('textarea', { class: 'sr-only', 'aria-hidden': 'true' });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    toast(ok ? 'Copied' : 'Could not copy. Select the text instead.', ok ? '' : 'err');
  }
}

/** A small modal. Resolves with whatever the clicked action returns, or null if dismissed. */
export function modal({ title, body, actions }) {
  const root = document.getElementById('modal-root');
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const close = (value) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      if (previous && previous.focus) previous.focus();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(null); }
    };
    const buttons = actions.map((a) => h('button', {
      type: 'button',
      class: 'btn ' + (a.kind || ''),
      onclick: () => { const v = a.value ? a.value() : a.label; if (v !== false) close(v === undefined ? true : v); },
    }, a.label));
    const dialog = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('h2', { text: title }), body, h('div', { class: 'dialog-actions' }, buttons));
    const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) close(null); } }, dialog);
    root.appendChild(overlay);
    document.addEventListener('keydown', onKey, true);
    const first = dialog.querySelector('input, textarea, button');
    if (first) first.focus();
  });
}

export async function confirmDialog({ title, text, confirmLabel = 'Confirm', danger = false }) {
  const res = await modal({
    title,
    body: h('p', { text }),
    actions: [
      { label: 'Cancel' },
      { label: confirmLabel, kind: danger ? 'danger' : 'primary', value: () => 'yes' },
    ],
  });
  return res === 'yes';
}

export function todayString() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

export function daysSince(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (!m) return null;
  const start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today - start) / 86400000);
  return diff < 0 ? null : diff + 1;
}

export function fmtDay(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (!m) return dateStr || '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
