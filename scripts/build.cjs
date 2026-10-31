'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = ['genre-service.js','genre-transport.js','genre-column.js','genre-catalog.js','player-waveform.js','runtime.js'];
const lf = text => text.replace(/\r\n/g, '\n');
const license = lf(fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'));
const header = `/*\nGenre4all 1.0.0 — standalone Spicetify genre column.\nAdapted from Lucasoreo/Sort-Play-2 @ c1fc205bccfd4200ad0660c75e55e8d138155936.\n\n${license}\n*/\n`;
const output = header + '(function () {\n"use strict";\n' + files.map(f => lf(fs.readFileSync(path.join(root, 'src', f), 'utf8')).replace(/^if \(typeof module[^\n]+\n?/gm, '')).join('\n') + '\n})();\n';
const target = path.join(root, 'Genre4all.js');
if (process.argv.includes('--check')) {
  if (lf(fs.readFileSync(target,'utf8')) !== output) throw new Error('Genre4all.js está desatualizado. Execute npm run build.');
} else fs.writeFileSync(target, output);
