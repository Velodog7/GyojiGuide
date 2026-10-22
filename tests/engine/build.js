/* backend.js is sumo-fantasy.gs as a string, for the Edge Function. If the
   .gs changed and nobody ran `node tools/build-backend.mjs`, Supabase would
   deploy the old backend. This is red until they match. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const gs = fs.readFileSync(path.join(ROOT, 'sumo-fantasy.gs'), 'utf8');
const built = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'api', 'backend.js'), 'utf8');
let pass = 0, fail = 0;
function t(name, ok, why) { if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n         ' + why); } }

const sha = crypto.createHash('sha256').update(gs).digest('hex');
const m = built.match(/export const SOURCE_SHA256 = "([0-9a-f]{64})"/);
t('sumo-fantasy.gs is not empty', gs.trim().length > 1000 && /function doPost\(/.test(gs), 'the backend file is empty or truncated');
t('backend.js was built from the current sumo-fantasy.gs', m && m[1] === sha,
  'stale: run `node tools/build-backend.mjs` (built ' + (m ? m[1].slice(0, 12) : '?') + ', .gs is ' + sha.slice(0, 12) + ')');
const v = (gs.match(/var BACKEND_VERSION = '([^']*)'/) || [])[1];
const bv = (built.match(/export const SOURCE_VERSION = "([^"]*)"/) || [])[1];
t('BACKEND_VERSION matches (' + v + ')', v && v === bv, 'the .gs says ' + v + ', backend.js says ' + bv);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
