// Reads a JS-literal file (JSON plus NaN/Infinity, which is what the page gets) of {name: manifest} and prints {name: {errors, warnings}} from viz/packvalidate.js.
const fs = require('fs'), path = require('path');
const PackSpec = require(path.join(__dirname, '..', '..', '..', 'viz', 'packvalidate.js'));
const docs = new Function('return ' + fs.readFileSync(process.argv[2], 'utf8'))();
const out = {};
for (const [k, m] of Object.entries(docs)) { try { const r = PackSpec.validate(m); out[k] = { errors: r.errors, warnings: r.warnings }; } catch (e) { out[k] = { crash: String(e && e.stack || e).split('\n')[0] }; } }
process.stdout.write(JSON.stringify(out));
