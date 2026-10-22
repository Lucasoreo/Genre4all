'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../src/genre-catalog.js');
test('copied catalog excludes moods, countries, numeric concepts and low scores', () => {
  for (const name of ['happy','gaming','brazil','12345']) assert.equal(catalog.validate(name,0.9),false,name);
  for (const name of ['electro house','progressive house','techno','samba','sertanejo']) assert.equal(catalog.validate(name,0.9),true,name);
  assert.equal(catalog.validate('house',0.01),false);
});
test('aliases preserve the original style and family labels', () => {
  const labels = catalog.format([{name:'progressive house',rawValue:'spotify:concept:progressive_house'}]);
  assert.ok(labels.some(l => l.name === 'progressive house' && l.kind === 'style'));
  assert.ok(labels.some(l => l.kind === 'genre'));
  assert.ok(labels.every(l => l.rawValue === 'spotify:concept:progressive_house'));
});
