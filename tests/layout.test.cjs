const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('v1.12: cells() strictly excludes genre4all-column preventing grid corruption on mutation/playback', () => {
  const runtimeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'runtime.js'), 'utf8');
  assert.ok(runtimeSource.includes("if (c.tagName === 'GENRE4ALL-COLUMN' || !c.matches(CELL)"));
  assert.ok(runtimeSource.includes("version: '1.12.0'"));
  assert.ok(runtimeSource.includes("if (!cell || cell.tagName === 'GENRE4ALL-COLUMN') continue;"));
  assert.ok(runtimeSource.includes("if (k === '__genre__') continue;"));
});

