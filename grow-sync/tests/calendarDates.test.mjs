import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Fresh runtimes use the same local-time behavior as browsers in these zones.
for (const TZ of ['America/Argentina/Buenos_Aires', 'Etc/GMT-2']) {
  test(`calendar selection / service / PostgreSQL parser / JSON / UI (${TZ})`, () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import vm from 'node:vm';
      import { createRequire } from 'node:module';
      import { calendarDateKey, parseCalendarDate, formatCalendarDate } from './grow-sync/src/utils/calendarDate.js';
      const require = createRequire(new URL('./growsync-backend/package.json', import.meta.url));
      const postgres = require('postgres');
      const types = require('./db/calendarDateType');
      // No connection is opened; exercise postgres.js's actual configured codecs.
      const db = postgres({ types });
      const parseDate = db.options.parsers[1082];
      let stored;
      const api = {
        post: async (url, payload) => {
          const wire = JSON.parse(JSON.stringify(payload));
          assert.match(wire.harvest_date, /^\\d{4}-\\d{2}-\\d{2}$/);
          stored = { ...wire, harvest_date: parseDate(types.calendarDate.serialize(wire.harvest_date)) };
          return { data: JSON.parse(JSON.stringify(stored)) };
        },
        get: async () => ({ data: JSON.parse(JSON.stringify(stored)) }),
      };
      const source = fs.readFileSync('./grow-sync/src/services/harvestService.jsx', 'utf8')
        .replace(/^import .*;$/m, '').replaceAll('export const ', 'const ');
      const service = vm.runInNewContext(source + '\\n({createHarvestRecord,getHarvestRecordById});', {api});
      for (const [key, display] of [
        ['2026-09-06','06/09/2026'], ['2026-01-01','01/01/2026'],
        ['2026-12-31','31/12/2026'], ['1998-06-15','15/06/1998'], ['2024-02-29','29/02/2024']
      ]) {
        const selected = parseCalendarDate(key);
        assert.equal(selected.format('YYYY-MM-DD'), key);
        const saved = await service.createHarvestRecord({harvest_date:calendarDateKey(selected)});
        const response = await service.getHarvestRecordById('fixture');
        assert.equal(saved.harvest_date,key);
        assert.equal(response.harvest_date,key);
        assert.equal(formatCalendarDate(response.harvest_date),display);
        // Old DATE responses must also be safe during rolling deployments/editing.
        const legacy = key + 'T00:00:00.000Z';
        assert.equal(formatCalendarDate(legacy),display);
        assert.equal(calendarDateKey(parseCalendarDate(legacy)),key);
      }
      const cycle = JSON.parse(JSON.stringify({start_date:parseDate('2026-09-05'),end_date:parseDate('2026-09-08')}));
      assert.equal(formatCalendarDate(cycle.start_date),'05/09/2026');
      assert.equal(formatCalendarDate(cycle.end_date),'08/09/2026');
      assert.equal(calendarDateKey(parseCalendarDate(cycle.end_date)),'2026-09-08');
      assert.equal(formatCalendarDate(null),'-');
      assert.equal(parseCalendarDate('2026-02-30'),null);
      assert.equal(calendarDateKey(new Date()),null); // no ambiguous instant-to-calendar conversion
      assert.equal(calendarDateKey('2026-09-06T15:00:00Z'),null);
      assert.throws(()=>types.calendarDate.serialize(new Date()),TypeError);
      for (const oid of [1114,1184]) assert.ok(db.options.parsers[oid]('2026-09-06T00:00:00Z') instanceof Date);
      assert.equal(db.options.parsers[1184]('2026-09-06T00:00:00Z').toISOString(),'2026-09-06T00:00:00.000Z');
      await db.end();
    `], { cwd: new URL('../../', import.meta.url), env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
}
