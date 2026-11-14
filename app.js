'use strict';

const STORAGE_KEY = 'einkaufsliste.items.v1';
const HISTORY_KEY = 'einkaufsliste.history.v1';

const $ = (id) => document.getElementById(id);
const form = $('add-form');
const input = $('item-input');
const openList = $('open-list');
const doneList = $('done-list');
const doneSection = $('done-section');
const emptyMsg = $('empty');
const counter = $('counter');
const suggestions = $('suggestions');
const toast = $('toast');
const toastText = $('toast-text');
const toastUndo = $('toast-undo');

let items = load(STORAGE_KEY, []);
let history = load(HISTORY_KEY, []);
let undoSnapshot = null;
let toastTimer = null;

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* Speicher nicht verfügbar – App läuft trotzdem weiter */
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// "2 Milch", "500g Mehl", "Eier x6" → Menge + Name
function parseEntry(text) {
  const t = text.trim().replace(/\s+/g, ' ');
  let m = t.match(/^(\d+[.,]?\d*\s*(?:x|stk|stück|g|kg|ml|l|pkg|packung(?:en)?|dose[n]?|flasche[n]?)?)\s+(.+)$/i);
  if (m) return { qty: m[1].trim(), name: m[2] };
  m = t.match(/^(.+?)\s+x\s*(\d+)$/i);
  if (m) return { qty: m[2] + 'x', name: m[1] };
  return { qty: '', name: t };
}

function remember(name) {
  const key = name.toLowerCase();
  history = [name, ...history.filter((h) => h.toLowerCase() !== key)].slice(0, 200);
}

function addItem(text) {
  const { qty, name } = parseEntry(text);
  if (!name) return;
  const existing = items.find((i) => !i.done && i.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    if (qty) existing.qty = qty;
  } else {
    const doneMatch = items.find((i) => i.done && i.name.toLowerCase() === name.toLowerCase());
    if (doneMatch) {
      doneMatch.done = false;
      doneMatch.qty = qty;
      items = [doneMatch, ...items.filter((i) => i !== doneMatch)];
    } else {
      items.unshift({ id: uid(), name, qty, done: false });
    }
  }
  remember(name);
  save();
  render();
}

function toggle(id) {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  item.done = !item.done;
  if (navigator.vibrate) navigator.vibrate(15);
  save();
  render();
}

function remove(id) {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  snapshot(`„${item.name}“ gelöscht`);
  items = items.filter((i) => i.id !== id);
  save();
  render();
}

function rename(id, text) {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  const { qty, name } = parseEntry(text);
  if (!name) {
    remove(id);
    return;
  }
  item.name = name;
  item.qty = qty;
  remember(name);
  save();
  render();
}

function clearDone() {
  const count = items.filter((i) => i.done).length;
  if (!count) return;
  snapshot(`${count} erledigte gelöscht`);
  items = items.filter((i) => !i.done);
  save();
  render();
}

function snapshot(message) {
  undoSnapshot = JSON.stringify(items);
  toastText.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; undoSnapshot = null; }, 5000);
}

toastUndo.addEventListener('click', () => {
  if (undoSnapshot) {
    items = JSON.parse(undoSnapshot);
    undoSnapshot = null;
    save();
    render();
  }
  toast.hidden = true;
});

function renderItem(item) {
  const li = document.createElement('li');
  li.className = 'item';
  li.dataset.id = item.id;

  const check = document.createElement('button');
  check.className = 'check';
  check.type = 'button';
  check.setAttribute('aria-label', item.done ? 'Als offen markieren' : 'Abhaken');
  check.textContent = item.done ? '✓' : '';
  check.addEventListener('click', () => toggle(item.id));

  const name = document.createElement('span');
  name.className = 'name';
  if (item.qty) {
    const q = document.createElement('span');
    q.className = 'qty';
    q.textContent = item.qty;
    name.append(q);
  }
  name.append(item.name);
  name.title = 'Tippen zum Abhaken, lange drücken / Rechtsklick zum Bearbeiten';

  // Langes Drücken (Handy) oder Rechtsklick (PC) → bearbeiten
  let pressTimer = null;
  let longPressed = false;
  const cancelPress = () => clearTimeout(pressTimer);
  name.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || name.isContentEditable) return;
    longPressed = false;
    pressTimer = setTimeout(() => {
      longPressed = true;
      if (navigator.vibrate) navigator.vibrate(30);
      startEdit(name, item);
    }, 500);
  });
  name.addEventListener('pointerup', cancelPress);
  name.addEventListener('pointerleave', cancelPress);
  name.addEventListener('pointercancel', cancelPress);
  name.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    cancelPress();
    if (!name.isContentEditable) startEdit(name, item);
  });
  name.addEventListener('click', () => {
    if (longPressed) { longPressed = false; return; }
    if (name.isContentEditable) return;
    toggle(item.id);
  });

  const del = document.createElement('button');
  del.className = 'delete';
  del.type = 'button';
  del.setAttribute('aria-label', `${item.name} löschen`);
  del.textContent = '✕';
  del.addEventListener('click', () => remove(item.id));

  li.append(check, name, del);
  return li;
}

function startEdit(el, item) {
  el.textContent = (item.qty ? item.qty + ' ' : '') + item.name;
  el.contentEditable = 'true';
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const finish = (commit) => {
    el.removeEventListener('blur', onBlur);
    el.removeEventListener('keydown', onKey);
    el.contentEditable = 'false';
    if (commit) rename(item.id, el.textContent);
    else render();
  };
  const onBlur = () => finish(true);
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  el.addEventListener('blur', onBlur);
  el.addEventListener('keydown', onKey);
}

function render() {
  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  openList.replaceChildren(...open.map(renderItem));
  doneList.replaceChildren(...done.map(renderItem));
  doneSection.hidden = done.length === 0;
  emptyMsg.hidden = items.length > 0;
  counter.textContent = items.length ? `${open.length} offen` : '';

  const current = new Set(open.map((i) => i.name.toLowerCase()));
  suggestions.replaceChildren(
    ...history
      .filter((h) => !current.has(h.toLowerCase()))
      .slice(0, 50)
      .map((h) => {
        const o = document.createElement('option');
        o.value = h;
        return o;
      })
  );
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  addItem(input.value);
  input.value = '';
  input.focus();
});

// Änderungen aus einem anderen Tab übernehmen
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY) {
    items = load(STORAGE_KEY, []);
    render();
  }
});

render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
