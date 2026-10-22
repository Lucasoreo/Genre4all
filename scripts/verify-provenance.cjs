'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const provenance = JSON.parse(fs.readFileSync(path.join(root, 'docs/PROVENANCE.json'), 'utf8'));
for (const file of provenance.files) {
  const actual = createHash('sha256').update(fs.readFileSync(path.join(root, file.path))).digest('hex');
  if (actual !== file.sha256) throw new Error('Original compatibility fixture was changed: ' + file.path);
}
process.stdout.write(`Verified ${provenance.files.length} original fixtures from ${provenance.commit}.\n`);
