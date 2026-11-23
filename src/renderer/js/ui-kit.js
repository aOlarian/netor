/* MAP
 * Scop: Componente UI comune Netor: escapare HTML, meniu contextual cu submeniuri (tematizat), modale,
 *       dialoguri (text/confirmare), notificari toast, selector de emoji si de culori.
 * Legaturi: folosit de toate modulele din src/renderer/js
 * Sectiuni:
 *   §1 Escapare si helperi DOM
 *   §2 Meniu contextual cu submeniuri
 *   §3 Modal, dialog text, confirmare
 *   §4 Toast
 *   §5 Selector emoji si culori
 */

// §1 Escapare si helperi DOM
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// §2 Meniu contextual cu submeniuri
// item: { label, icon, hint, onClick, submenu:[items], disabled, danger, checked, separator, html }
function buildMenuEl(items) {
  const menu = document.createElement('div');
  menu.className = 'nx-menu';
  for (const it of items.filter(Boolean)) {
    if (it.separator) { menu.appendChild(Object.assign(document.createElement('div'), { className: 'nx-menu-sep' })); continue; }
    if (it.header) { menu.appendChild(Object.assign(document.createElement('div'), { className: 'nx-menu-header', textContent: it.header })); continue; }
    const row = document.createElement('div');
    row.className = 'nx-menu-item' + (it.disabled ? ' disabled' : '') + (it.danger ? ' danger' : '');
    row.innerHTML = `<span class="nx-mi-icon">${it.checked ? '✓' : esc(it.icon || '')}</span>` +
      `<span class="nx-mi-label">${it.html || esc(it.label)}</span>` +
      `<span class="nx-mi-hint">${it.submenu ? '›' : esc(it.hint || '')}</span>`;
    if (it.submenu) {
      const sub = buildMenuEl(it.submenu.length ? it.submenu : [{ label: 'Gol', disabled: true }]);
      sub.classList.add('nx-submenu');
      row.appendChild(sub);
      row.addEventListener('mouseenter', () => positionSubmenu(row, sub));
    } else if (!it.disabled) {
      row.addEventListener('click', (e) => { e.stopPropagation(); closeMenus(); it.onClick && it.onClick(); });
    }
    menu.appendChild(row);
  }
  return menu;
}

function positionSubmenu(row, sub) {
  sub.style.left = '100%'; sub.style.right = 'auto'; sub.style.top = '-5px';
  const r = sub.getBoundingClientRect();
  if (r.right > window.innerWidth - 4) { sub.style.left = 'auto'; sub.style.right = '100%'; }
  if (r.bottom > window.innerHeight - 4) sub.style.top = `${Math.min(-5, window.innerHeight - 4 - r.bottom)}px`;
}

function showMenu(items, x, y) {
  closeMenus();
  const layer = document.getElementById('menuLayer');
  const menu = buildMenuEl(items);
  layer.appendChild(menu);
  layer.classList.add('open');
  // Stratul acopera si webview-urile: un clic in afara meniului il inchide (paginile nu ar anunta clicul)
  layer.onmousedown = (e) => { if (e.target === layer) closeMenus(); };
  layer.oncontextmenu = (e) => { e.preventDefault(); if (e.target === layer) closeMenus(); };
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 4))}px`;
  return menu;
}

function closeMenus() {
  const layer = document.getElementById('menuLayer');
  if (!layer) return;
  layer.innerHTML = '';
  layer.classList.remove('open');
}

// §3 Modal, dialog text, confirmare
function openModal({ title, body, width = 560, onMount, wide = false, className = '' }) {
  const host = document.getElementById('modalLayer');
  const wrap = document.createElement('div');
  wrap.className = 'nx-modal-backdrop';
  wrap.innerHTML = `
    <div class="nx-modal ${wide ? 'wide' : ''} ${className}" style="width:${wide ? 'min(1080px, 94vw)' : `min(${width}px, 94vw)`}">
      <div class="nx-modal-head"><span>${esc(title)}</span><button class="icon-btn" data-close title="Închide">✕</button></div>
      <div class="nx-modal-body"></div>
    </div>`;
  const bodyEl = wrap.querySelector('.nx-modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  const close = () => { wrap.remove(); if (!host.children.length) host.classList.remove('open'); };
  wrap.querySelector('[data-close]').onclick = close;
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  host.appendChild(wrap);
  host.classList.add('open');
  const api = { el: wrap, body: bodyEl, close };
  if (onMount) onMount(api);
  return api;
}

function closeAllModals() {
  const host = document.getElementById('modalLayer');
  host.innerHTML = '';
  host.classList.remove('open');
}

function askText({ title, label, value = '', placeholder = '', okLabel = 'Salvează', password = false }) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title, width: 420,
      body: `<label class="fld"><span>${esc(label || '')}</span>
        <input class="inp" type="${password ? 'password' : 'text'}" value="${esc(value)}" placeholder="${esc(placeholder)}"></label>
        <div class="row-end"><button class="btn ghost" data-cancel>Anulează</button><button class="btn primary" data-ok>${esc(okLabel)}</button></div>`,
      onMount: (api) => {
        const inp = $('input', api.body);
        const finish = (v) => { if (done) return; done = true; api.close(); resolve(v); };
        $('[data-ok]', api.body).onclick = () => finish(inp.value);
        $('[data-cancel]', api.body).onclick = () => finish(null);
        inp.onkeydown = (e) => { if (e.key === 'Enter') finish(inp.value); if (e.key === 'Escape') finish(null); };
        $('[data-close]', api.el).onclick = () => finish(null);
        setTimeout(() => { inp.focus(); inp.select(); }, 20);
      },
    });
    return m;
  });
}

function confirmBox({ title, message, okLabel = 'Confirmă', danger = false }) {
  return new Promise((resolve) => {
    openModal({
      title, width: 420,
      body: `<p class="muted-text">${esc(message)}</p>
        <div class="row-end"><button class="btn ghost" data-cancel>Anulează</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button></div>`,
      onMount: (api) => {
        $('[data-ok]', api.body).onclick = () => { api.close(); resolve(true); };
        $('[data-cancel]', api.body).onclick = () => { api.close(); resolve(false); };
      },
    });
  });
}

// §4 Toast
function toast(message, kind = 'info', ms = 2600) {
  const host = document.getElementById('toastLayer');
  const t = document.createElement('div');
  t.className = `nx-toast ${kind}`;
  t.textContent = message;
  host.appendChild(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

// §5 Selector emoji si culori
const ICON_SET = ['🌐', '💼', '🏠', '🛒', '🧪', '🕵️', '🚀', '⭐', '🔥', '💡', '🎯', '📈', '🧭', '🛡️', '🤖', '📦', '🎨', '🎮', '📚', '💬',
  '📧', '🏦', '💳', '🏢', '🧾', '🔧', '🌙', '☀️', '🍀', '❤️', '🟢', '🔵', '🟣', '🟠', '🔴', '⚫'];
const COLOR_SET = ['#1A73E8', '#0F9D58', '#F4B400', '#DB4437', '#7C3AED', '#EC4899', '#14B8A6', '#F97316',
  '#64748B', '#0EA5E9', '#84CC16', '#D97757', '#111827', '#F2ECE4', '#FFFFFF'];

function iconPickerHTML(name, current) {
  return `<div class="icon-grid" data-picker="${name}">${ICON_SET.map((i) =>
    `<button type="button" class="icon-opt${i === current ? ' selected' : ''}" data-val="${i}">${i}</button>`).join('')}</div>`;
}

function colorPickerHTML(name, current) {
  return `<div class="color-grid" data-picker="${name}">${COLOR_SET.map((c) =>
    `<button type="button" class="color-opt${c.toLowerCase() === String(current).toLowerCase() ? ' selected' : ''}" data-val="${c}" style="background:${c}"></button>`).join('')}
    <label class="color-custom" title="Culoare personalizată"><input type="color" value="${esc(current || '#1A73E8')}"></label></div>`;
}

// Leaga un selector (icon/culoare) si intoarce un getter pentru valoarea aleasa
function bindPicker(root, name, initial) {
  let value = initial;
  const grid = root.querySelector(`[data-picker="${name}"]`);
  if (!grid) return () => value;
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-val]');
    if (!b) return;
    value = b.dataset.val;
    grid.querySelectorAll('.selected').forEach((x) => x.classList.remove('selected'));
    b.classList.add('selected');
  });
  const custom = grid.querySelector('input[type=color]');
  if (custom) custom.addEventListener('input', () => { value = custom.value; grid.querySelectorAll('.selected').forEach((x) => x.classList.remove('selected')); });
  return () => value;
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });

window.NX = { esc, uid, $, $$, showMenu, closeMenus, openModal, closeAllModals, askText, confirmBox, toast, iconPickerHTML, colorPickerHTML, bindPicker };
