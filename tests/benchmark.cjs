'use strict';

const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {createRuntime} = require('./support/game-runtime.cjs');

function measure(label, action) {
  const startedAt = performance.now();
  const result = action();
  const elapsedMs = performance.now() - startedAt;
  return {label, elapsedMs, result};
}

function runNpm(args) {
  let executable = 'npm';
  let childArgs = args;
  if (process.platform === 'win32') {
    const nodeDirectory = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs');
    const npmCli = path.join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const nodeExecutable = path.join(nodeDirectory, 'node.exe');
    if (!fs.existsSync(nodeExecutable) || !fs.existsSync(npmCli)) {
      throw new Error('Could not locate the Windows npm CLI for benchmark subprocesses');
    }
    executable = nodeExecutable;
    childArgs = [npmCli, ...args];
  }
  const result = spawnSync(executable, childArgs, {stdio: 'ignore'});
  if (result.status !== 0) throw new Error(`npm ${args.join(' ')} failed during benchmark`);
}

const bootSamples = [];
for (let sample = 0; sample < 20; sample++) {
  const timing = measure('tiny CPU world boot', () => createRuntime({seed: sample}));
  bootSamples.push(timing.elapsedMs);
}
const bootAverage = bootSamples.reduce((sum, value) => sum + value, 0) / bootSamples.length;

const thirtyMinuteSimulation = measure('30 minutes of fixed player ticks', () => {
  const runtime = createRuntime({seed: 77});
  runtime.evaluate('__gameTest.stepGround(216000,[0,0,0])');
});

const cpuSuite = measure('npm test (default CPU suite)', () => runNpm(['test', '--silent']));
const fullWorld = measure('npm run test:full', () => runNpm(['run', 'test:full', '--silent']));
const browser = measure('npm run test:browser', () => runNpm(['run', 'test:browser', '--silent']));
const allMeasuredMs = cpuSuite.elapsedMs + fullWorld.elapsedMs + browser.elapsedMs;
const previousPromptMs = 30 * 60 * 1000;

console.table([
  {measurement: 'tiny CPU world boot (20-run average)', milliseconds: bootAverage.toFixed(2)},
  {measurement: thirtyMinuteSimulation.label, milliseconds: thirtyMinuteSimulation.elapsedMs.toFixed(2)},
  {measurement: cpuSuite.label, milliseconds: cpuSuite.elapsedMs.toFixed(2)},
  {measurement: fullWorld.label, milliseconds: fullWorld.elapsedMs.toFixed(2)},
  {measurement: browser.label, milliseconds: browser.elapsedMs.toFixed(2)},
  {measurement: 'all three tiers', milliseconds: allMeasuredMs.toFixed(2)}
]);
console.log(`Default CPU loop vs 30-minute prompt: ${(previousPromptMs/cpuSuite.elapsedMs).toFixed(0)}x faster.`);
console.log(`All tiers vs 30-minute prompt: ${(previousPromptMs/allMeasuredMs).toFixed(0)}x faster.`);
