const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('v1.12 & v1.13: cells(), Mix Mode full-width protection, CSS/layout self-heal, and player waveform integration', () => {
  const runtimeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'runtime.js'), 'utf8');
  assert.ok(runtimeSource.includes("if (c.tagName === 'GENRE4ALL-COLUMN' || isFullWidthCell(c) || !c.matches(CELL)"));
  assert.ok(runtimeSource.includes("version: '1.13.0'"));
  assert.ok(runtimeSource.includes("function isFullWidthCell(c)"));
  assert.ok(runtimeSource.includes("PoSfoROJK6lwVe6ZtR0U"));
  assert.ok(runtimeSource.includes("trackListRowFullWidthCell"));
  assert.ok(runtimeSource.includes("grid-column:1 / -1 !important"));
  assert.ok(runtimeSource.includes("grid-row:auto !important"));
  assert.ok(runtimeSource.includes("playerWaveform"));
  assert.ok(runtimeSource.includes("Genre4allPlayerWaveform"));
  assert.ok(runtimeSource.includes("g4a-badge-experimental"));
  assert.ok(runtimeSource.includes("if (cell && (!cell || cell.tagName === 'GENRE4ALL-COLUMN')) continue;"));
  assert.ok(runtimeSource.includes("if (k === '__genre__') continue;"));
  assert.ok(runtimeSource.includes(':is(.g4a-row,[data-g4a-row],:has(> genre4all-column)):not([data-g4a-measure])'));
  assert.ok(!runtimeSource.includes('if (!header && state.appliedKey === measureKey && state.shell.parentElement === container && rootState.measured?.key === measureKey)'));
});

