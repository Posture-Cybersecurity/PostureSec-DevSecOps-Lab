/**
 * Captured evidence: real outputs recorded from the dedicated War Room EC2 lab by
 * `warroom/inc004/lab.sh capture`, already redacted (account id, ARNs,
 * IPs), stored as captured/<outage|restored>/<evidence-id>.txt with the capture
 * time in captured/CAPTURED_AT. When a file is present the squad sees it,
 * labelled 'captured'; otherwise the scenario's representative output, labelled
 * 'simulated'. Read once, synchronously, at first use; files over 20 KB or
 * names outside the evidence catalogue are ignored.
 */
const fs = require('fs');
const path = require('path');
const { EVIDENCE } = require('./scenario');

const DIR = process.env.WAR_ROOM_INC004_CAPTURED_DIR || path.join(__dirname, 'captured');
const MAX_BYTES = 20 * 1024;
let cache = null;

function load() {
  const out = { outage: {}, restored: {}, captured_at: null };
  for (const phase of ['outage', 'restored']) {
    const dir = path.join(DIR, phase);
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_e) { continue; }
    for (const name of names) {
      const id = name.replace(/\.txt$/, '');
      if (!name.endsWith('.txt') || !Object.prototype.hasOwnProperty.call(EVIDENCE, id)) continue;
      try {
        const file = path.join(dir, name);
        if (fs.statSync(file).size > MAX_BYTES) continue;
        out[phase][id] = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
      } catch (_e) { /* unreadable capture: fall back to the simulated output */ }
    }
  }
  try { out.captured_at = fs.readFileSync(path.join(DIR, 'CAPTURED_AT'), 'utf8').trim().slice(0, 40); } catch (_e) { /* none */ }
  return out;
}

function captured(phaseKey, id) {
  if (!cache) cache = load();
  const lines = phaseKey && cache[phaseKey] ? cache[phaseKey][id] : null;
  return lines ? { lines, captured_at: cache.captured_at } : null;
}

/** Tests only: forget the cache so a different directory can be loaded. */
function _reset() { cache = null; }

module.exports = { captured, _reset };
