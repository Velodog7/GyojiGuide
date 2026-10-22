/* The engine against the reference model, request by request.

   Every request goes to both: the plain synchronous spreadsheet in
   lib/model.js (Apps Script as it was) and engine.js over the in-memory
   store (replays, snapshots, one commit per request). Responses must match
   byte for byte, and after each flow the stored rows must match cell for
   cell. The flows (lib/flows.js) walk every area of the site to deep states:
   a whole keepers draft with pauses and rewinds, trades, keepers, results.
   Then a seeded random phase throws a few hundred plausible requests at
   every action. A difference here means the move to Postgres changed
   behaviour. sql.js runs the same flows against the real SQL. */
'use strict';
const { createHarness } = require('./lib/harness');
const { FLOWS } = require('./lib/flows');

(async () => {
  let pass = 0, fail = 0;
  for (const flow of FLOWS) {
    console.log('\n— ' + flow.title + ' —');
    const { name, H } = await flow.run((opts) => createHarness(opts));
    if (H.failures.length) {
      fail++;
      console.log('  FAIL ' + name);
      for (const f of H.failures.slice(0, 3)) console.log('       ' + f);
    } else { pass++; console.log('  ok   ' + name); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n0 passed, 1 failed'); process.exit(1); });
