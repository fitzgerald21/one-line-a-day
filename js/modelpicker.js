// Searchable model picker that pulls the live catalogue (with prices) from OpenRouter / DeepInfra.
import { h, icon } from './ui.js';
import { loadModels, fmtPrice, fmtCtx, summaryCost, fmtCost, PROVIDERS } from './ai.js';

const SORTS = {
  price: ['Price: low to high', (a, b) => a.inPrice + a.outPrice * 4 - (b.inPrice + b.outPrice * 4) || a.name.localeCompare(b.name)],
  name: ['Name', (a, b) => a.name.localeCompare(b.name)],
  new: ['Newest', (a, b) => b.created - a.created],
  ctx: ['Context size', (a, b) => b.ctx - a.ctx],
};

/**
 * opts: { provider(): string, selected(): string, onSelect(model), visionOnly?: bool, hideThinkingDefault?: bool }
 */
export function createModelPicker(opts) {
  let models = [];
  let status = 'idle'; // idle | loading | ready | error
  let error = '';
  let loadedFor = '';
  let query = '';
  let sort = 'price';
  let freeOnly = false;
  let hideThinking = opts.hideThinkingDefault ?? !opts.visionOnly;
  let open = false;

  const current = h('button.mp-current', { type: 'button', 'aria-expanded': 'false', onclick: () => toggle() });
  const search = h('input.search', { type: 'search', placeholder: 'Search models…', oninput: (e) => { query = e.target.value.trim().toLowerCase(); renderList(); } });
  const sortSel = h('select', { 'aria-label': 'Sort', onchange: (e) => { sort = e.target.value; renderList(); } },
    Object.entries(SORTS).map(([k, [label]]) => h('option', { value: k }, label)));
  const freeChk = h('input', { type: 'checkbox', onchange: (e) => { freeOnly = e.target.checked; renderList(); } });
  const thinkChk = h('input', { type: 'checkbox', onchange: (e) => { hideThinking = e.target.checked; renderList(); } });
  thinkChk.checked = hideThinking;
  const list = h('div.mp-list', { role: 'listbox' });
  const info = h('div.mp-info');
  const panel = h('div.mp-panel', { hidden: true },
    h('div.mp-tools', search, sortSel),
    h('div.mp-filters',
      h('label', freeChk, ' Free only'),
      !opts.visionOnly && h('label', thinkChk, ' Hide “thinking” models'),
      h('button.link', { type: 'button', onclick: () => load(true) }, 'Refresh list')),
    info, list);
  const el = h('div.model-picker', current, panel);

  function selectedModel() {
    const id = opts.selected();
    return models.find((m) => m.id === id);
  }

  function renderCurrent() {
    const id = opts.selected();
    const m = selectedModel();
    current.replaceChildren(...[
      h('div.mp-cur-main',
        h('b', m?.name || id || 'Choose a model…'),
        id ? h('span.mp-id', id) : null),
      m ? h('span.mp-price', `in ${fmtPrice(m.inPrice)} · out ${fmtPrice(m.outPrice)} /1M`) : null,
      icon('right', 18)].filter(Boolean));
  }

  function renderList() {
    if (status === 'loading') { info.textContent = 'Loading the latest models and prices…'; list.replaceChildren(); return; }
    if (status === 'error') {
      info.replaceChildren(error + ' ', h('button.link', { type: 'button', onclick: () => load(true) }, 'Try again'));
      list.replaceChildren();
      return;
    }
    let rows = models.filter((m) => (opts.visionOnly ? m.vision : true) && (!freeOnly || m.free) && (!hideThinking || !m.reasoning || m.id === opts.selected()));
    if (query) rows = rows.filter((m) => (m.name + ' ' + m.id).toLowerCase().includes(query));
    rows = rows.slice().sort(SORTS[sort][1]);
    info.textContent = `${rows.length} model${rows.length === 1 ? '' : 's'} · prices are USD per million tokens`;
    const sel = opts.selected();
    list.replaceChildren(...rows.slice(0, 80).map((m) => h('button.mp-row' + (m.id === sel ? '.on' : ''), {
      type: 'button', role: 'option', 'aria-selected': m.id === sel,
      onclick: () => { opts.onSelect(m); renderCurrent(); renderList(); toggle(false); },
    },
      h('div.mp-row-main',
        h('b', m.name),
        h('span.mp-id', m.id),
        h('div.badges',
          m.free && h('span.badge-pill.free', 'FREE'),
          m.vision && h('span.badge-pill', 'VISION'),
          m.reasoning && h('span.badge-pill.think', 'THINKS'),
          h('span.badge-pill.dim', `${fmtCtx(m.ctx)} ctx`))),
      h('div.mp-row-price',
        h('span', `in ${fmtPrice(m.inPrice)}`), h('span', `out ${fmtPrice(m.outPrice)}`),
        !opts.visionOnly && h('span.est', `≈ ${fmtCost(summaryCost(m))} / summary`)))));
    if (rows.length > 80) list.append(h('div.mp-more', `Showing 80 of ${rows.length} — search to narrow it down.`));
    if (!rows.length) list.append(h('div.mp-more', 'No models match.'));
  }

  async function load(force = false) {
    const provider = opts.provider();
    status = 'loading';
    renderList();
    try {
      models = await loadModels(provider, { force });
      loadedFor = provider;
      status = 'ready';
    } catch (err) {
      status = 'error';
      error = err.message || 'Could not load models.';
    }
    renderCurrent();
    renderList();
  }

  function toggle(force) {
    open = force ?? !open;
    panel.hidden = !open;
    current.setAttribute('aria-expanded', String(open));
    current.classList.toggle('open', open);
    if (open && (status !== 'ready' || loadedFor !== opts.provider())) load();
    if (open) setTimeout(() => search.focus({ preventScroll: true }), 50);
  }

  renderCurrent();
  return {
    el,
    /** call when the provider changed */
    providerChanged() { models = []; status = 'idle'; loadedFor = ''; renderCurrent(); if (open) load(); else renderList(); },
    refreshCurrent: renderCurrent,
    preload() { if (status === 'idle') load(); },
    get providerLabel() { return PROVIDERS[opts.provider()].label; },
  };
}
