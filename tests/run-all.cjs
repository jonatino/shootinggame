'use strict';

const {spawnSync} = require('node:child_process');

const testFiles = ['tests/cpu.test.cjs', 'tests/full-world.test.cjs', 'tests/browser.test.cjs'];
for (const file of testFiles) {
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', file], {
    stdio: 'inherit'
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
