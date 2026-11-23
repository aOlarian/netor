/* MAP
 * Scop: Taburile "treze" ale agentilor: cat lucreaza un agent (inclusiv intre reluarile din Loop), taburile lui
 *       raman randate si neincetinite chiar daca tu esti in alt browser sau alt tab. Interfata le creeaza daca
 *       nu exista inca (browser nedeschis de la pornire) si le tine randate, nevazute; aici se opreste
 *       incetinirea Chromium din fundal (setBackgroundThrottling). La final, totul revine la normal.
 * Legaturi: agent-runner.js (release la sfarsitul lucrului), agent-tools.js (wake inaintea fiecarei unelte),
 *           web-contents.js (wcForTab), renderer webviews.js (uiCall wakeTabs / sleepTabs)
 * Sectiuni:
 *   §1 Trezire si eliberare
 */
const { wcForTab } = require('./web-contents');

let ctx = null; // { uiCall }
const held = new Map(); // agentId -> Set(tabId)

const heldByOthers = (agentId, tabId) => Array.from(held).some(([id, set]) => id !== agentId && set.has(tabId));

function throttle(tabId, allowed) {
  const wc = wcForTab(tabId);
  if (wc && typeof wc.setBackgroundThrottling === 'function') wc.setBackgroundThrottling(allowed);
}

// §1 Trezire si eliberare
async function wake(agentId, tabIds) {
  const set = held.get(agentId) || new Set();
  held.set(agentId, set);
  const fresh = (tabIds || []).filter((id) => id && !set.has(id));
  if (!fresh.length) return { ok: true, awake: Array.from(set) };
  fresh.forEach((id) => set.add(id));
  // Interfata creeaza webview-urile lipsa si le tine randate; abia apoi exista webContents
  await ctx.uiCall('wakeTabs', { agentId, tabIds: fresh }).catch((err) => console.error('[netor] wakeTabs:', err.message));
  for (const id of fresh) throttle(id, false);
  return { ok: true, awake: Array.from(set) };
}

function release(agentId) {
  const set = held.get(agentId);
  if (!set) return;
  held.delete(agentId);
  for (const id of set) if (!heldByOthers(agentId, id)) throttle(id, true);
  ctx.uiCall('sleepTabs', { agentId }).catch((err) => console.error('[netor] sleepTabs:', err.message));
}

function init(opts) { ctx = opts; }

module.exports = { init, wake, release, awakeTabs: (agentId) => Array.from(held.get(agentId) || []) };
