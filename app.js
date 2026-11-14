import { firebaseConfig } from './firebase-config.js';
import { createSync } from './sync.js';

/* ------------------------------------------------------------------ *
 *  Datenmodell
 *
 *  state = {
 *    lists:    { [id]: { id, name, createdAt, updatedAt, deleted? } },
 *    items:    { [id]: { id, listId, name, qty, store, note, done,
 *                        createdAt, updatedAt, deleted? } },
 *    products: { [name klein]: { name, updatedAt,
 *                        prices:    { [Geschäft]: { v: Zahl|null, t } },
 *                        lastStore: { v, t } } },
 *    stores:   { list: [Geschäftsnamen], updatedAt },
 *  }
 *
 *  Gelöschtes bleibt als „deleted“ markiert, damit der Abgleich mit
 *  anderen Geräten weiß, dass es entfernt wurde.
 * ------------------------------------------------------------------ */

const STATE_KEY = 'einkaufsliste.state.v2';
const LOCAL_KEY = 'einkaufsliste.local.v2';
const OLD_ITEMS_KEY = 'einkaufsliste.items.v1';
const OLD_HISTORY_KEY = 'einkaufsliste.history.v1';
const DEFAULT_LIST_ID = 'standard';
const DEFAULT_STORES = ['Hofer', 'Billa', 'Spar', 'Lidl', 'Penny', 'dm', 'BIPA'];
const TOMBSTONE_TTL = 30 * 24 * 3600 * 1000;

const eur = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' });
const now = () => Date.now();
const uid = () => now().toString(36) + Math.random().toString(36).slice(2, 8);
const key = (name) => name.trim().toLowerCase();
const $ = (id) => document.getElementById(id);

/* ---------------------------- Speicher ---------------------------- */

function readJSON(k, fallback) {
  try {
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(k, value) {
  try { localStorage.setItem(k, JSON.stringify(value)); } catch { /* egal */ }
}

function emptyState() {
  return {
    lists: { [DEFAULT_LIST_ID]: { id: DEFAULT_LIST_ID, name: 'Einkaufsliste', createdAt: 0, updatedAt: 0 } },
    items: {},
    products: {},
    stores: { list: [...DEFAULT_STORES], updatedAt: 0 },
  };
}

function loadState() {
  const saved = readJSON(STATE_KEY, null);
  if (saved && saved.lists) return saved;

  // Übernahme aus der ersten Version
  const st = emptyState();
  const oldItems = readJSON(OLD_ITEMS_KEY, []);
  const t = now();
  oldItems.forEach((o, i) => {
    const id = o.id || uid();
    st.items[id] = {
      id, listId: DEFAULT_LIST_ID, name: o.name, qty: parseInt(o.qty, 10) || 1,
      store: '', note: /^\d+$/.test(o.qty || '') || !o.qty ? '' : o.qty,
      done: !!o.done, createdAt: t - i, updatedAt: t,
    };
  });
  for (const name of readJSON(OLD_HISTORY_KEY, [])) {
    st.products[key(name)] = { name, prices: {}, updatedAt: t };
  }
  return st;
}

let state = loadState();
let local = Object.assign({ activeListId: DEFAULT_LIST_ID, filter: 'all', syncCode: null }, readJSON(LOCAL_KEY, {}));

function purgeTombstones() {
  const limit = now() - TOMBSTONE_TTL;
  for (const col of ['lists', 'items']) {
    for (const [id, e] of Object.entries(state[col])) {
      if (e.deleted && e.updatedAt < limit) delete state[col][id];
    }
  }
}
purgeTombstones();

/* ----------------------- Zusammenführen (Sync) --------------------- */

function newer(a, b) {
  if (!a) return b;
  if (!b) return a;
  return (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
}

function mergeStamped(a, b) {
  if (!a) return b;
  if (!b) return a;
  return (b.t || 0) > (a.t || 0) ? b : a;
}

function mergeProduct(a, b) {
  if (!a) return b;
  if (!b) return a;
  const base = newer(a, b);
  const prices = { ...(a.prices || {}) };
  for (const [s, p] of Object.entries(b.prices || {})) prices[s] = mergeStamped(prices[s], p);
  const lastStore = mergeStamped(a.lastStore, b.lastStore);
  const out = { name: base.name, updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0), prices };
  if (lastStore) out.lastStore = lastStore;
  return out;
}

function mergeMap(a = {}, b = {}, fn = newer) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = fn(out[k], v);
  return out;
}

function merge(a, b) {
  return {
    lists: mergeMap(a.lists, b.lists),
    items: mergeMap(a.items, b.items),
    products: mergeMap(a.products, b.products, mergeProduct),
    stores: (b.stores?.updatedAt || 0) > (a.stores?.updatedAt || 0) ? b.stores : a.stores,
  };
}

function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

// Gibt true zurück, wenn das Gerät Daten hat, die online noch fehlen.
function applyRemote(remote) {
  const merged = merge(state, remote);
  const mergedStr = stable(merged);
  if (mergedStr !== stable(state)) {
    state = merged;
    writeJSON(STATE_KEY, state);
    render();
  }
  return mergedStr !== stable(remote);
}

/* ------------------------------ Sync ------------------------------ */

let syncStatus = 'off';
let syncError = '';

const sync = firebaseConfig
  ? createSync({
      config: firebaseConfig,
      getState: () => state,
      applyRemote,
      onStatus: (s, msg) => {
        syncStatus = s;
        syncError = msg || '';
        renderSyncDot();
        if ($('settings-dialog').open) renderSyncBox();
      },
    })
  : null;

function newSyncCode() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function shareLink() {
  return `${location.origin}${location.pathname}#code=${local.syncCode}`;
}

function startSync(code) {
  local.syncCode = code;
  saveLocal();
  sync?.connect(code);
}

function stopSync() {
  local.syncCode = null;
  saveLocal();
  sync?.disconnect();
}

/* --------------------------- Änderungen --------------------------- */

function saveLocal() { writeJSON(LOCAL_KEY, local); }

function commit() {
  writeJSON(STATE_KEY, state);
  render();
  sync?.schedule();
}

const live = (obj) => obj && !obj.deleted;
const liveLists = () => Object.values(state.lists).filter(live).sort((a, b) => a.createdAt - b.createdAt);
const stores = () => state.stores.list;

function activeList() {
  let list = state.lists[local.activeListId];
  if (!live(list)) {
    list = liveLists()[0];
    if (!list) {
      list = { id: uid(), name: 'Einkaufsliste', createdAt: now(), updatedAt: now() };
      state.lists[list.id] = list;
    }
    local.activeListId = list.id;
    saveLocal();
  }
  return list;
}

const itemsOf = (listId) => Object.values(state.items).filter((i) => live(i) && i.listId === listId);

function priceOf(name, store) {
  if (!store) return null;
  const p = state.products[key(name)]?.prices?.[store];
  return p && typeof p.v === 'number' ? p.v : null;
}

function cheapest(name) {
  const prices = state.products[key(name)]?.prices || {};
  let best = null;
  for (const s of stores()) {
    const v = prices[s]?.v;
    if (typeof v === 'number' && (!best || v < best.v)) best = { store: s, v };
  }
  return best;
}

function touchProduct(name) {
  const k = key(name);
  const p = state.products[k] || { name, prices: {} };
  p.name = name.trim();
  p.updatedAt = now();
  state.products[k] = p;
  return p;
}

function rememberStore(name, store) {
  const p = touchProduct(name);
  if (store) p.lastStore = { v: store, t: now() };
}

function setPrice(name, store, value) {
  const p = touchProduct(name);
  const cur = p.prices[store];
  const curV = cur && typeof cur.v === 'number' ? cur.v : null;
  if (curV === value) return;
  p.prices[store] = { v: value, t: now() };
}

function parsePrice(text) {
  const t = text.replace(/[€\s]/g, '').replace(',', '.');
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null;
}

// "2 Milch", "3x Joghurt", "Eier x6" → Anzahl + Name
function parseEntry(text) {
  const t = text.trim().replace(/\s+/g, ' ');
  let m = t.match(/^(\d{1,3})\s*(?:x|×|stk\.?|stück)?\s+(.+)$/i);
  if (m) return { qty: parseInt(m[1], 10), name: m[2] };
  m = t.match(/^(.+?)\s+(?:x|×)\s*(\d{1,3})$/i);
  if (m) return { qty: parseInt(m[2], 10), name: m[1] };
  return { qty: null, name: t };
}

function clampQty(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(999, Math.max(1, n)) : 1;
}

function addItem(text, qtyField, store) {
  const parsed = parseEntry(text);
  const name = parsed.name;
  if (!name) return;
  const qty = parsed.qty ?? clampQty(qtyField);
  const list = activeList();
  const t = now();
  const same = itemsOf(list.id).filter((i) => key(i.name) === key(name));
  const open = same.find((i) => !i.done);
  const done = same.find((i) => i.done);

  if (open) {
    open.qty = (open.qty || 1) + qty;
    if (store) open.store = store;
    open.updatedAt = t;
    showToast(`${open.name}: jetzt ${open.qty} Stück`, false);
  } else if (done) {
    Object.assign(done, { done: false, qty, store: store || done.store, updatedAt: t, createdAt: t });
  } else {
    const id = uid();
    state.items[id] = { id, listId: list.id, name, qty, store, note: '', done: false, createdAt: t, updatedAt: t };
  }
  rememberStore(name, store);
  commit();
}

function updateItem(id, changes) {
  const item = state.items[id];
  if (!item) return;
  Object.assign(item, changes, { updatedAt: now() });
}

function toggle(id) {
  const item = state.items[id];
  if (!item) return;
  updateItem(id, { done: !item.done });
  if (navigator.vibrate) navigator.vibrate(15);
  commit();
}

/* --------------------------- Rückgängig --------------------------- */

let undoItems = null;
let toastTimer = null;

function snapshotItems(message) {
  undoItems = JSON.parse(JSON.stringify(state.items));
  showToast(message, true);
}

function showToast(message, undoable) {
  $('toast-text').textContent = message;
  $('toast-undo').hidden = !undoable;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; undoItems = null; }, 5000);
}

$('toast-undo').addEventListener('click', () => {
  if (undoItems) {
    const t = now();
    for (const [id, old] of Object.entries(undoItems)) {
      if (stable(old) !== stable(state.items[id])) state.items[id] = { ...old, updatedAt: t };
    }
    undoItems = null;
    commit();
  }
  $('toast').hidden = true;
});

function removeItem(id) {
  const item = state.items[id];
  if (!item) return;
  snapshotItems(`„${item.name}“ gelöscht`);
  updateItem(id, { deleted: true });
  commit();
}

$('clear-done').addEventListener('click', () => {
  const done = itemsOf(activeList().id).filter((i) => i.done);
  if (!done.length) return;
  snapshotItems(`${done.length} erledigte gelöscht`);
  done.forEach((i) => updateItem(i.id, { deleted: true }));
  commit();
});

/* ---------------------------- Anzeige ----------------------------- */

function storeHue(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function storeBadge(store) {
  const b = document.createElement('span');
  b.className = 'badge';
  b.style.setProperty('--h', storeHue(store));
  b.textContent = store;
  return b;
}

function renderItem(item) {
  const li = document.createElement('li');
  li.className = 'item';

  const check = document.createElement('button');
  check.type = 'button';
  check.className = 'check';
  check.setAttribute('aria-label', item.done ? 'Als offen markieren' : 'Abhaken');
  check.textContent = item.done ? '✓' : '';
  check.addEventListener('click', () => toggle(item.id));

  const body = document.createElement('div');
  body.className = 'body';
  body.addEventListener('click', () => toggle(item.id));

  const title = document.createElement('div');
  title.className = 'title';
  if (item.qty > 1) {
    const q = document.createElement('span');
    q.className = 'qty';
    q.textContent = `${item.qty}×`;
    title.append(q);
  }
  title.append(item.name);
  body.append(title);

  const meta = document.createElement('div');
  meta.className = 'meta';
  if (item.store && local.filter === 'all' && !groupedView) meta.append(storeBadge(item.store));
  if (item.note) {
    const n = document.createElement('span');
    n.textContent = item.note;
    meta.append(n);
  }
  const price = priceOf(item.name, item.store);
  if (price != null) {
    const p = document.createElement('span');
    p.className = 'price';
    p.textContent = item.qty > 1 ? `${eur.format(price * item.qty)} (à ${eur.format(price)})` : eur.format(price);
    meta.append(p);
  }
  const best = cheapest(item.name);
  if (!item.done && best && best.store !== item.store && (price == null || best.v < price)) {
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = `💡 ${best.store} ${eur.format(best.v)}`;
    meta.append(hint);
  }
  if (meta.childNodes.length) body.append(meta);

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'edit';
  edit.setAttribute('aria-label', `${item.name} bearbeiten`);
  edit.textContent = '✎';
  edit.addEventListener('click', () => openItemDialog(item.id));

  li.append(check, body, edit);
  return li;
}

let groupedView = false;

function renderStoreOptions(select, value, emptyLabel) {
  const all = [...stores()];
  if (value && !all.includes(value)) all.push(value);
  const opts = [new Option(emptyLabel, '')].concat(all.map((s) => new Option(s, s)));
  select.replaceChildren(...opts);
  select.value = value || '';
}

function renderSyncDot() {
  const dot = $('sync-dot');
  dot.hidden = syncStatus === 'off';
  dot.dataset.status = syncStatus;
}

function render() {
  const list = activeList();
  $('list-name').textContent = list.name;
  document.title = list.name === 'Einkaufsliste' ? 'Einkaufsliste' : `${list.name} – Einkaufsliste`;

  const all = itemsOf(list.id);
  const open = all.filter((i) => !i.done).sort((a, b) => b.createdAt - a.createdAt);
  const done = all.filter((i) => i.done).sort((a, b) => b.updatedAt - a.updatedAt);

  // Filter-Chips
  const counts = {};
  for (const i of open) counts[i.store || ''] = (counts[i.store || ''] || 0) + 1;
  const storeOrder = [...stores(), ...Object.keys(counts).filter((s) => s && !stores().includes(s))];
  const usedStores = storeOrder.filter((s) => counts[s]);
  if (local.filter !== 'all' && !counts[local.filter]) local.filter = 'all';

  const chips = $('store-filter');
  chips.hidden = usedStores.length === 0;
  const chip = (value, label, n) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (local.filter === value ? ' active' : '');
    if (value !== 'all') b.style.setProperty('--h', storeHue(value));
    b.textContent = `${label} ${n}`;
    b.addEventListener('click', () => { local.filter = value; saveLocal(); render(); });
    return b;
  };
  chips.replaceChildren(chip('all', 'Alle', open.length), ...usedStores.map((s) => chip(s, s, counts[s])));

  // Offene Artikel, nach Geschäft gruppiert
  const visible = local.filter === 'all' ? open : open.filter((i) => i.store === local.filter || !i.store);
  const groups = new Map();
  for (const s of [...storeOrder, '']) groups.set(s, []);
  for (const i of visible) groups.get(i.store || '').push(i);
  const nonEmpty = [...groups].filter(([, items]) => items.length);
  groupedView = nonEmpty.length > 1 || (nonEmpty.length === 1 && nonEmpty[0][0] !== '');

  const container = $('open-groups');
  container.replaceChildren(...nonEmpty.map(([store, items]) => {
    const sec = document.createElement('section');
    sec.className = 'group';
    if (groupedView) {
      const head = document.createElement('div');
      head.className = 'group-header';
      const h = document.createElement('h2');
      if (store) h.append(storeBadge(store)); else h.textContent = 'Egal wo';
      head.append(h);
      const sum = groupSum(items);
      if (sum.total > 0) {
        const s = document.createElement('span');
        s.className = 'sum';
        s.textContent = `ca. ${eur.format(sum.total)}`;
        head.append(s);
      }
      sec.append(head);
    }
    const ul = document.createElement('ul');
    ul.className = 'list';
    ul.append(...items.map(renderItem));
    sec.append(ul);
    return sec;
  }));

  $('done-list').replaceChildren(...done.map(renderItem));
  $('done-section').hidden = done.length === 0;
  $('empty').hidden = all.length > 0;

  const total = groupSum(visible).total;
  $('summary').textContent = all.length
    ? `${open.length} offen` + (total > 0 ? ` · ca. ${eur.format(total)}` : '')
    : '';

  // Eingabe: Geschäfte und Vorschläge
  renderStoreOptions($('store-input'), $('store-input').value, 'Geschäft: egal');
  const onList = new Set(open.map((i) => key(i.name)));
  $('suggestions').replaceChildren(
    ...Object.values(state.products)
      .filter((p) => !onList.has(key(p.name)))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 100)
      .map((p) => new Option(p.name))
  );

  renderSyncDot();
}

function groupSum(items) {
  let total = 0;
  for (const i of items) {
    const p = priceOf(i.name, i.store);
    if (p != null) total += p * (i.qty || 1);
  }
  return { total };
}

/* --------------------------- Eingabeform -------------------------- */

$('add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  addItem($('item-input').value, $('qty-input').value, $('store-input').value);
  $('item-input').value = '';
  $('qty-input').value = 1;
  $('store-input').value = '';
  $('item-input').focus();
});

// Bekannter Artikel → zuletzt gewähltes Geschäft vorschlagen
$('item-input').addEventListener('change', () => {
  const p = state.products[key(parseEntry($('item-input').value).name)];
  if (p?.lastStore?.v && !$('store-input').value) {
    renderStoreOptions($('store-input'), p.lastStore.v, 'Geschäft: egal');
  }
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-step]');
  if (!btn) return;
  const input = $(btn.dataset.target);
  input.value = clampQty((parseInt(input.value, 10) || 1) + Number(btn.dataset.step));
});

/* -------------------------- Dialog-Helfer ------------------------- */

for (const d of document.querySelectorAll('dialog')) {
  d.addEventListener('click', (e) => {
    if (e.target === d || e.target.closest('[data-close]')) d.close();
  });
}

/* ------------------------ Artikel bearbeiten ---------------------- */

let editingId = null;

function openItemDialog(id) {
  const item = state.items[id];
  if (!item) return;
  editingId = id;
  $('ed-name').value = item.name;
  $('ed-qty').value = item.qty || 1;
  $('ed-note').value = item.note || '';
  renderStoreOptions($('ed-store'), item.store, 'egal');

  const box = $('ed-prices');
  const prices = state.products[key(item.name)]?.prices || {};
  box.replaceChildren(...stores().map((s) => {
    const row = document.createElement('label');
    row.className = 'price-row';
    row.dataset.store = s;
    const name = document.createElement('span');
    name.append(storeBadge(s));
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.placeholder = '–';
    input.setAttribute('aria-label', `Preis bei ${s}`);
    const v = prices[s]?.v;
    if (typeof v === 'number') input.value = v.toFixed(2).replace('.', ',');
    input.addEventListener('input', markCheapestInDialog);
    const unit = document.createElement('span');
    unit.textContent = '€';
    row.append(name, input, unit);
    return row;
  }));
  markCheapestInDialog();
  $('item-dialog').showModal();
}

function markCheapestInDialog() {
  let best = null;
  const rows = [...$('ed-prices').children];
  for (const r of rows) {
    const v = parsePrice(r.querySelector('input').value);
    if (v != null && (!best || v < best.v)) best = { r, v };
  }
  rows.forEach((r) => r.classList.toggle('best', !!best && r === best.r));
}

$('item-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const item = state.items[editingId];
  if (!item) return $('item-dialog').close();
  const name = $('ed-name').value.trim().replace(/\s+/g, ' ');
  if (!name) return;
  const store = $('ed-store').value;
  updateItem(item.id, { name, qty: clampQty($('ed-qty').value), store, note: $('ed-note').value.trim() });
  for (const row of $('ed-prices').children) {
    setPrice(name, row.dataset.store, parsePrice(row.querySelector('input').value));
  }
  rememberStore(name, store);
  $('item-dialog').close();
  commit();
});

$('ed-delete').addEventListener('click', () => {
  $('item-dialog').close();
  removeItem(editingId);
});

/* ----------------------------- Listen ----------------------------- */

function renderLists() {
  const active = activeList();
  const lists = liveLists();
  $('lists-ul').replaceChildren(...lists.map((l) => {
    const li = document.createElement('li');
    li.className = 'entry' + (l.id === active.id ? ' active' : '');

    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'entry-main';
    const openCount = itemsOf(l.id).filter((i) => !i.done).length;
    pick.innerHTML = '<strong></strong><small></small>';
    pick.querySelector('strong').textContent = l.name;
    pick.querySelector('small').textContent = `${openCount} offen`;
    pick.addEventListener('click', () => {
      local.activeListId = l.id;
      local.filter = 'all';
      saveLocal();
      $('lists-dialog').close();
      render();
    });

    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'icon-btn small';
    rename.textContent = '✎';
    rename.setAttribute('aria-label', `${l.name} umbenennen`);
    rename.addEventListener('click', () => {
      const name = prompt('Neuer Name der Liste:', l.name);
      if (!name || !name.trim()) return;
      Object.assign(l, { name: name.trim(), updatedAt: now() });
      commit();
      renderLists();
    });

    li.append(pick, rename);

    if (lists.length > 1) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'icon-btn small danger-text';
      del.textContent = '🗑';
      del.setAttribute('aria-label', `${l.name} löschen`);
      del.addEventListener('click', () => {
        if (!confirm(`Liste „${l.name}“ mit allen Artikeln löschen?`)) return;
        const t = now();
        Object.assign(l, { deleted: true, updatedAt: t });
        for (const i of itemsOf(l.id)) Object.assign(i, { deleted: true, updatedAt: t });
        commit();
        renderLists();
      });
      li.append(del);
    }
    return li;
  }));
}

$('list-btn').addEventListener('click', () => {
  renderLists();
  $('lists-dialog').showModal();
});

$('new-list-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('new-list-name').value.trim();
  if (!name) return;
  const t = now();
  const id = uid();
  state.lists[id] = { id, name, createdAt: t, updatedAt: t };
  local.activeListId = id;
  local.filter = 'all';
  saveLocal();
  $('new-list-name').value = '';
  $('lists-dialog').close();
  commit();
});

/* -------------------------- Einstellungen ------------------------- */

function setStores(list) {
  state.stores = { list, updatedAt: now() };
  commit();
  renderStores();
}

function renderStores() {
  const list = stores();
  $('stores-ul').replaceChildren(...list.map((s, idx) => {
    const li = document.createElement('li');
    li.className = 'entry';
    const label = document.createElement('span');
    label.className = 'entry-main';
    label.append(storeBadge(s));

    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'icon-btn small';
    up.textContent = '↑';
    up.disabled = idx === 0;
    up.setAttribute('aria-label', `${s} nach oben`);
    up.addEventListener('click', () => {
      const next = [...list];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      setStores(next);
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon-btn small danger-text';
    del.textContent = '✕';
    del.setAttribute('aria-label', `${s} entfernen`);
    del.addEventListener('click', () => {
      if (!confirm(`„${s}“ aus den Geschäften entfernen? Gespeicherte Preise bleiben erhalten.`)) return;
      setStores(list.filter((x) => x !== s));
    });

    li.append(label, up, del);
    return li;
  }));
}

$('new-store-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('new-store-name').value.trim();
  if (!name) return;
  if (!stores().some((s) => key(s) === key(name))) setStores([...stores(), name]);
  $('new-store-name').value = '';
});

function el(tag, attrs = {}, text = '') {
  const e = document.createElement(tag);
  Object.assign(e, attrs);
  if (text) e.textContent = text;
  return e;
}

function renderSyncBox() {
  const box = $('sync-box');
  box.replaceChildren();

  if (!sync) {
    box.append(
      el('p', {}, 'Der Abgleich zwischen Handy und Computer ist noch nicht eingerichtet. Bis dahin bleibt die Liste nur auf diesem Gerät.'),
      el('p', { className: 'muted' }, 'Einrichtung: siehe README im Repository (Abschnitt „Geräte verbinden“).')
    );
    return;
  }

  if (!local.syncCode) {
    box.append(el('p', {}, 'Verbinde Handy, Computer oder die Geräte deiner Familie, damit alle dieselben Listen sehen.'));
    const create = el('button', { type: 'button', className: 'btn primary' }, 'Neue Verbindung erstellen');
    create.addEventListener('click', () => { startSync(newSyncCode()); renderSyncBox(); });
    box.append(create);

    const form = el('form', { className: 'inline-form' });
    const input = el('input', { type: 'text', placeholder: 'oder Code / Link eingeben', required: true });
    const join = el('button', { type: 'submit', className: 'btn' }, 'Verbinden');
    form.append(input, join);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = extractCode(input.value);
      if (!code) return alert('Das ist kein gültiger Code.');
      startSync(code);
      renderSyncBox();
    });
    box.append(form);
    return;
  }

  const labels = { connecting: '⏳ Verbinde …', online: '🟢 Verbunden', error: '🔴 Fehler', off: '⚪ Getrennt' };
  box.append(el('p', {}, labels[syncStatus] || syncStatus));
  if (syncError) box.append(el('p', { className: 'muted' }, syncError));
  box.append(el('p', {}, 'Öffne diesen Link auf deinen anderen Geräten:'));
  box.append(el('code', { className: 'code' }, shareLink()));

  const row = el('div', { className: 'btn-row' });
  const share = el('button', { type: 'button', className: 'btn primary' }, navigator.share ? 'Link teilen' : 'Link kopieren');
  share.addEventListener('click', async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Einkaufsliste', text: 'Unsere gemeinsame Einkaufsliste', url: shareLink() });
      else { await navigator.clipboard.writeText(shareLink()); showToast('Link kopiert', false); }
    } catch { /* abgebrochen */ }
  });
  const leave = el('button', { type: 'button', className: 'btn danger' }, 'Trennen');
  leave.addEventListener('click', () => {
    if (!confirm('Dieses Gerät trennen? Die Listen bleiben auf dem Gerät gespeichert.')) return;
    stopSync();
    renderSyncBox();
  });
  row.append(share, leave);
  box.append(row);
}

function extractCode(text) {
  const m = text.trim().match(/(?:#code=)?([a-z0-9]{16,64})\s*$/i);
  return m ? m[1].toLowerCase() : null;
}

$('settings-btn').addEventListener('click', () => {
  renderStores();
  renderSyncBox();
  $('settings-dialog').showModal();
});

/* ------------------------------ Start ----------------------------- */

window.addEventListener('storage', (e) => {
  if (e.key === STATE_KEY) {
    state = readJSON(STATE_KEY, state);
    render();
  }
});

render();

// Einladungslink: …#code=xyz
const linkCode = location.hash.startsWith('#code=') ? extractCode(location.hash) : null;
if (linkCode) history.replaceState(null, '', location.pathname + location.search);

if (sync) {
  if (linkCode && linkCode !== local.syncCode) {
    if (confirm('Mit der geteilten Einkaufsliste verbinden? Deine bisherigen Einträge werden übernommen.')) startSync(linkCode);
    else if (local.syncCode) sync.connect(local.syncCode);
  } else if (local.syncCode) {
    sync.connect(local.syncCode);
  }
} else if (linkCode) {
  showToast('Abgleich ist in dieser App noch nicht eingerichtet.', false);
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
