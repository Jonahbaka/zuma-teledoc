'use strict';
const fs = require('node:fs');
const { promoteRelease } = require('../../../../scripts/release/store.cjs');
const { createFixtureAdapter } = require('./adapter.cjs');
const settings = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const originalRename = fs.renameSync;
fs.renameSync = (source, destination) => {
  let boundary = null;
  if (destination === require('node:path').join(settings.promotion.storeRoot, 'journal.json')) boundary = 'journal-' + JSON.parse(fs.readFileSync(source, 'utf8')).phase;
  if (destination === require('node:path').join(settings.promotion.storeRoot, 'current')) boundary = 'target';
  if (settings.adapter.crashAt === boundary + '-before-rename') process.kill(process.pid, 'SIGKILL');
  const result = originalRename(source, destination);
  if (settings.adapter.crashAt === boundary + '-after-rename') process.kill(process.pid, 'SIGKILL');
  return result;
};
const adapter = createFixtureAdapter(settings.adapter);
promoteRelease({ ...settings.promotion, adapter }).then(result => {
  process.stdout.write(JSON.stringify(result));
}).catch(error => {
  process.stderr.write(error.code || 'FAILED');
  process.exitCode = 1;
});
