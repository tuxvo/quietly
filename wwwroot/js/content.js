// Loads the guide content (JSON) and works out which steps a person should see.
// All five files are fetched for everyone, so the server never learns which path someone chose.

export const C = { core: null, tracks: {}, relOptions: [], sources: {} };

const TRACK_IDS = ['ex', 'parent', 'friend', 'other'];

async function getJson(name) {
  const res = await fetch('content/' + name + '.json', { cache: 'no-store', referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new Error('Could not load ' + name);
  return res.json();
}

export async function loadContent() {
  const [core, ...tracks] = await Promise.all(['core', ...TRACK_IDS].map(getJson));
  C.core = core;
  TRACK_IDS.forEach((id, i) => { C.tracks[id] = tracks[i]; });
  C.relOptions = TRACK_IDS.map((id) => ({ id, label: C.tracks[id].label, note: C.tracks[id].blurb }));
  C.sources = Object.fromEntries(core.sources.map((s) => [s.id, s]));
}

/** The set of "flags" that decide which steps appear. */
export function flagsOf(d) {
  const f = new Set();
  if (d.safety === 'yes' || d.safety === 'unsure') f.add('safety');
  if (d.stage) f.add(d.stage);
  for (const val of Object.values(d.answers || {})) {
    (Array.isArray(val) ? val : [val]).forEach((x) => { if (x) f.add(x); });
  }
  return f;
}

function priority(step, isCore) {
  const req = step.requires || [];
  if (req.includes('safety')) return 0;
  if (req.includes('stage_deciding')) return 10;
  if (!isCore && req.length) return 20;     // practical steps for what is still tied together
  return isCore ? 30 : 40;
}

/** Steps for this person, in order, with safety variants applied. */
export function stepsFor(d) {
  const track = C.tracks[d.rel];
  if (!track) return [];
  const flags = flagsOf(d);
  const phaseOrder = Object.fromEntries(C.core.phases.map((p, i) => [p.id, i]));
  const merged = [
    ...C.core.steps.map((s) => ({ s, isCore: true })),
    ...track.steps.map((s) => ({ s, isCore: false })),
  ];
  const out = [];
  merged.forEach(({ s, isCore }, index) => {
    if ((s.requires || []).some((r) => !flags.has(r))) return;
    if ((s.unless || []).some((r) => flags.has(r))) return;
    const variant = (s.variants || []).find((v) => flags.has(v.when));
    out.push({
      id: s.id,
      phase: s.phase,
      title: s.title,
      summary: variant && variant.summary ? variant.summary : s.summary,
      how: variant && variant.how ? variant.how : s.how,
      scripts: (variant && variant.scripts) || s.scripts || [],
      tool: s.tool || null,
      src: s.src || [],
      _p: priority(s, isCore),
      _i: index,
    });
  });
  out.sort((a, b) => (phaseOrder[a.phase] - phaseOrder[b.phase]) || (a._p - b._p) || (a._i - b._i));
  return out;
}
