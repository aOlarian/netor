/* MAP
 * Scop: Dezarhivare ZIP minimala (fara dependente) pentru pachetele de extensii Chrome (CRX = antet + ZIP).
 * Legaturi: extensions.js
 * Sectiuni:
 *   §1 Citire director central si extragere fisiere (stored / deflate), cu protectie la cai periculoase
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// §1 Citire director central si extragere
function extractZip(buf, destDir) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Arhiva ZIP invalidă (lipsește directorul central).');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const root = path.resolve(destDir);
  fs.mkdirSync(root, { recursive: true });
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Intrare ZIP coruptă.');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    const out = path.resolve(root, name);
    if (out !== root && !out.startsWith(root + path.sep)) throw new Error(`Cale periculoasă în arhivă: ${name}`);
    if (name.endsWith('/')) { fs.mkdirSync(out, { recursive: true }); continue; }
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + compSize);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (method === 0) fs.writeFileSync(out, data);
    else if (method === 8) fs.writeFileSync(out, zlib.inflateRawSync(data));
    else throw new Error(`Metodă de compresie nesuportată (${method}) pentru ${name}`);
  }
}

module.exports = { extractZip };
