/* MAP
 * Scop: Clipboardul multi-slot Netor (Ctrl+1..9, comun tuturor taburilor si browserelor, pastrat criptat DPAPI)
 *       si istoricul de navigare (fara browserele All Private), cu cautare pentru bara de adrese.
 * Legaturi: web-contents.js (taste si lipire), ipc.js, config.js (LIMITS)
 * Sectiuni:
 *   §1 Sloturi: stare, tasta tinuta apasata, persistare criptata
 *   §2 Istoric: adaugare, cautare, stergere
 */
const fs = require('fs');
const path = require('path');
const { safeStorage, clipboard } = require('electron');
const { LIMITS } = require('./config');

// §1 Sloturi
class Slots {
  constructor(dir, emit) {
    this.file = path.join(dir, 'netor-slots.bin');
    this.emit = emit;
    this.values = {};
    this.held = '';
    try {
      if (fs.existsSync(this.file)) {
        const buf = fs.readFileSync(this.file);
        this.values = JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8'));
      }
    } catch (err) {
      console.error('[netor] sloturile nu au putut fi citite, pornesc goale:', err.message);
    }
  }

  setHeld(d) {
    if (this.held === d) return;
    this.held = d;
    this.emit('netor:slot-held', d);
  }

  set(slot, value) {
    const k = String(slot);
    if (!/^[1-9]$/.test(k)) return;
    if (value === null || value === '') delete this.values[k]; else this.values[k] = String(value);
    this.persist();
    this.emit('netor:slots', this.values);
  }

  get(slot) { return this.values[String(slot)] || ''; }

  clear() { this.values = {}; this.persist(); this.emit('netor:slots', this.values); }

  persist() {
    const json = JSON.stringify(this.values);
    fs.writeFileSync(this.file, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json));
  }

  copySystem(slot) { clipboard.writeText(this.get(slot)); }
}

// §2 Istoric
class History {
  constructor(dir) {
    this.file = path.join(dir, 'netor-history.json');
    this.items = [];
    this.timer = null;
    try {
      if (fs.existsSync(this.file)) this.items = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (err) {
      console.error('[netor] istoric corupt, il reiau gol:', err.message);
    }
  }

  add(url, title) {
    if (!/^https?:/i.test(url)) return;
    const now = Date.now();
    const ex = this.items.find((i) => i.url === url);
    if (ex) { ex.visits = (ex.visits || 1) + 1; ex.ts = now; if (title) ex.title = title; } else this.items.push({ url, title: title || url, ts: now, visits: 1 });
    if (this.items.length > LIMITS.historyMax) this.items.sort((a, b) => b.ts - a.ts).length = LIMITS.historyMax;
    this.save();
  }

  setTitle(url, title) {
    const ex = this.items.find((i) => i.url === url);
    if (ex && title) { ex.title = title; this.save(); }
  }

  query(q, limit = 8) {
    const s = String(q || '').toLowerCase().trim();
    if (!s) return [];
    return this.items
      .filter((i) => i.url.toLowerCase().includes(s) || (i.title || '').toLowerCase().includes(s))
      .sort((a, b) => (b.visits * 3 + b.ts / 8.64e7) - (a.visits * 3 + a.ts / 8.64e7))
      .slice(0, limit);
  }

  list(q = '', offset = 0, limit = 200) {
    const s = q.toLowerCase();
    const rows = this.items.filter((i) => !s || i.url.toLowerCase().includes(s) || (i.title || '').toLowerCase().includes(s)).sort((a, b) => b.ts - a.ts);
    return { total: rows.length, items: rows.slice(offset, offset + limit) };
  }

  remove(url) { this.items = this.items.filter((i) => i.url !== url); this.save(); }

  clear() { this.items = []; this.save(); }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 1500);
  }

  flush() {
    clearTimeout(this.timer);
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.items), 'utf8');
    fs.renameSync(this.file + '.tmp', this.file);
  }
}

module.exports = { Slots, History };
