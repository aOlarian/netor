/* MAP
 * Scop: Seiful de date Netor (parole, carduri cu CVV, adrese, companii, identitati, contacte, grupuri de date).
 *       Datele sunt criptate AES-256-GCM cu o cheie aleatoare (VDK). VDK e invelita cu cheia din PIN
 *       (PBKDF2) si, peste, cu DPAPI Windows (safeStorage); pentru cloud e invelita cu cheia contului.
 * Legaturi: main.js, ipc.js, cloud-sync.js, config.js (LIMITS)
 * Sectiuni:
 *   §1 Primitive criptografice
 *   §2 Clasa Vault: stare, initializare PIN, deblocare cu limitare de incercari, blocare automata
 *   §3 Salvare, schimbare PIN, migrare seif v1.0, export/import pentru cloud
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { safeStorage } = require('electron');
const { LIMITS } = require('./config');

const PIN_ITER = 210000;
const CATEGORIES = ['logins', 'cards', 'addresses', 'companies', 'identities', 'contacts', 'dataGroups'];

// §1 Primitive criptografice
function seal(key, buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

function open(key, b64) {
  const raw = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]);
}

const deriveKey = (secret, saltHex, iter) => crypto.pbkdf2Sync(String(secret), Buffer.from(saltHex, 'hex'), iter, 32, 'sha256');
const osProtect = (s) => (safeStorage.isEncryptionAvailable() ? 'dpapi:' + safeStorage.encryptString(s).toString('base64') : 'raw:' + s);
const osUnprotect = (s) => (s.startsWith('dpapi:') ? safeStorage.decryptString(Buffer.from(s.slice(6), 'base64')) : s.slice(4));

function emptyVault() {
  const v = { _deleted: {} };
  for (const c of CATEGORIES) v[c] = [];
  return v;
}

// §2 Clasa Vault
class Vault {
  constructor(dir, onLockChange) {
    this.file = path.join(dir, 'netor-vault.v2.json');
    this.legacyFile = path.join(dir, 'netor-vault.enc.json');
    this.onLockChange = onLockChange || (() => {});
    this.vdk = null;
    this.data = null;
    this.failed = 0;
    this.lockedUntil = 0;
    this.lockTimer = null;
    this.autoLockMin = LIMITS.vaultAutoLockMin;
  }

  status() {
    return { initialized: fs.existsSync(this.file), unlocked: !!this.data, legacy: fs.existsSync(this.legacyFile) && !fs.existsSync(this.file) };
  }

  setup(pin) {
    if (fs.existsSync(this.file)) throw new Error('Seiful are deja un PIN. Folosește schimbarea PIN-ului.');
    if (!/^\S{4,64}$/.test(String(pin))) throw new Error('PIN-ul trebuie să aibă minimum 4 caractere.');
    this.vdk = crypto.randomBytes(32);
    this.data = this.importLegacy() || emptyVault();
    this.writeFile(pin);
    this.touch();
    return this.data;
  }

  unlock(pin) {
    if (Date.now() < this.lockedUntil) {
      throw new Error(`Prea multe încercări. Reîncearcă în ${Math.ceil((this.lockedUntil - Date.now()) / 1000)} s.`);
    }
    const disk = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    try {
      const kek = deriveKey(pin, disk.salt, disk.iter || PIN_ITER);
      this.vdk = open(kek, osUnprotect(disk.wrappedKey));
      this.data = { ...emptyVault(), ...JSON.parse(open(this.vdk, disk.cipher).toString('utf8')) };
    } catch (_) {
      this.failed += 1;
      if (this.failed >= LIMITS.pinMaxAttempts) { this.lockedUntil = Date.now() + LIMITS.pinLockoutMs; this.failed = 0; }
      throw new Error('PIN incorect.');
    }
    this.failed = 0;
    this.pinCache = String(pin);
    this.touch();
    this.onLockChange(false);
    return this.data;
  }

  lock() {
    this.vdk = null;
    this.data = null;
    this.pinCache = null;
    clearTimeout(this.lockTimer);
    this.onLockChange(true);
  }

  // Reporneste cronometrul de blocare automata la fiecare folosire
  touch() {
    clearTimeout(this.lockTimer);
    if (this.autoLockMin > 0 && this.data) this.lockTimer = setTimeout(() => this.lock(), this.autoLockMin * 60000);
  }

  requireOpen() {
    if (!this.data) throw new Error('Seiful este blocat.');
    this.touch();
    return this.data;
  }

  // §3 Salvare, schimbare PIN, migrare, cloud
  save(next) {
    this.requireOpen();
    const clean = emptyVault();
    for (const c of CATEGORIES) clean[c] = Array.isArray(next[c]) ? next[c] : [];
    clean._deleted = { ...(this.data._deleted || {}), ...(next._deleted || {}) };
    this.data = clean;
    const disk = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    disk.cipher = seal(this.vdk, Buffer.from(JSON.stringify(clean), 'utf8'));
    disk.updatedAt = Date.now();
    this.atomicWrite(disk);
    return clean;
  }

  changePin(oldPin, newPin) {
    if (!/^\S{4,64}$/.test(String(newPin))) throw new Error('PIN-ul nou trebuie să aibă minimum 4 caractere.');
    this.unlock(oldPin);
    this.writeFile(newPin);
    return true;
  }

  writeFile(pin) {
    const salt = crypto.randomBytes(16).toString('hex');
    const kek = deriveKey(pin, salt, PIN_ITER);
    this.atomicWrite({
      v: 2, salt, iter: PIN_ITER,
      wrappedKey: osProtect(seal(kek, this.vdk)),
      cipher: seal(this.vdk, Buffer.from(JSON.stringify(this.data), 'utf8')),
      updatedAt: Date.now(),
    });
  }

  atomicWrite(obj) {
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(obj), 'utf8');
    fs.renameSync(this.file + '.tmp', this.file);
  }

  // Seiful v1.0 era criptat cu PIN-ul implicit 1234 si continea doar date demonstrative; pastram doar intrarile reale
  importLegacy() {
    if (!fs.existsSync(this.legacyFile)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(this.legacyFile, 'utf8'));
      const key = crypto.pbkdf2Sync('1234', Buffer.from(raw.salt, 'hex'), 100000, 32, 'sha256');
      const old = JSON.parse(open(key, raw.cipher).toString('utf8'));
      const demoIds = new Set(['log_1', 'crd_1', 'adr_1', 'cmp_1', 'idn_1', 'cnt_1', 'dgrp_1']);
      const v = emptyVault();
      for (const c of CATEGORIES) v[c] = (old[c] || []).filter((x) => !demoIds.has(x.id));
      fs.renameSync(this.legacyFile, this.legacyFile + '.migrated');
      return v;
    } catch (err) {
      console.error('[netor] seiful v1.0 nu a putut fi importat:', err.message);
      return null;
    }
  }

  // Exporta VDK invelita cu cheia contului (pentru cloud); cheia contului nu paraseste dispozitivul
  exportForCloud(accountKey) {
    this.requireOpen();
    return { wrapped: seal(accountKey, this.vdk), cipher: seal(this.vdk, Buffer.from(JSON.stringify(this.data), 'utf8')) };
  }

  decryptCloud(accountKey, blob) {
    const vdk = open(accountKey, blob.wrapped);
    return { vdk, data: { ...emptyVault(), ...JSON.parse(open(vdk, blob.cipher).toString('utf8')) } };
  }

  // Adopta cheia din cloud cand seiful local e gol (primul dispozitiv nou), altfel doar uneste datele
  adoptCloud(vdk, data, pin) {
    this.vdk = vdk;
    this.data = data;
    this.writeFile(pin);
    this.touch();
  }
}

module.exports = { Vault, CATEGORIES, deriveKey, seal, open, osProtect, osUnprotect, emptyVault };
