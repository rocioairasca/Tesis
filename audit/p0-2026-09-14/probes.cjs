// Q01–Q03 from the original audit, now backed by permanent regression tests.
// The original REST-only fake cannot execute SQL transactions. Keep historical
// audit files intact and run the same scenarios against the SQL fixture instead.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const pglite=process.env.INVENTORY_TEST_PGLITE || path.join(root,'grow-sync/node_modules/.cache/phase31-pglite/dist/index.cjs');
const result=spawnSync(process.execPath,['--test','--test-name-pattern=original probe|Q03 harvestRecords POST /:',
  'growsync-backend/tests/legacyUsage.integration.test.js','growsync-backend/tests/p0Authorization.test.js'],
{cwd:root,env:{...process.env,INVENTORY_TEST_PGLITE:pglite},encoding:'utf8'});
const output=(result.stdout||'')+(result.stderr||'');
fs.writeFileSync(path.join(__dirname,'probes-output.txt'),output);
const cases=output.split(/\r?\n/).filter(line=>line.startsWith('# {"case":')).map(line=>JSON.parse(line.slice(2)));
const passed=result.status===0&&cases.length===3;
fs.writeFileSync(path.join(__dirname,'probes-results.json'),JSON.stringify({passed,cases},null,2)+'\n');
console.log(JSON.stringify({passed,cases},null,2));
if(!passed){console.error(output);process.exitCode=1;}
