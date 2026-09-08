import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';

const compile = source => {
  const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
  assert.equal(result.diagnostics?.length ?? 0, 0);
  return result.outputText;
};
const helper = {};
new Function('exports', compile(fs.readFileSync('src/services/configuredMediaSelection.ts', 'utf8')))(helper);
const { selectConfiguredMedia } = helper;
assert.deepEqual(selectConfiguredMedia(['a', 'b', 'c'], 1, new Set(['a', 'b', 'c'])), { url: 'b', nextCursor: 2 });
assert.deepEqual(selectConfiguredMedia(['a', 'b', 'c'], 0, new Set(['a', 'b'])), { url: 'c', nextCursor: 0 });
assert.equal(selectConfiguredMedia([]), null);

// Exercise the production methods with isolated dependencies: no network or publishing.
const source = fs.readFileSync('src/services/autoPostService.ts', 'utf8');
compile(source);
compile(fs.readFileSync('src/index.ts', 'utf8'));
const ast = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true);
const cls = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'AutoPostService');
const methods = ['runDueJobsFromFallback', 'selectNextVideo'].map(name => cls.members.find(member => member.name?.getText(ast) === name).getText(ast));
const due = { toMillis: () => 0 };
const stored = { userId: 'simplicity', active: true, nextRun: due, reelsNextRun: due, storyNextRun: due };
let queries = 0;
const db = { getDueAutopostJobs: async field => { queries++; return field === 'trend_next_run' ? [] : [stored]; } };
const Harness = new Function('supabaseFallbackService', 'selectConfiguredMedia', compile('class Harness {' + methods.join('\n') + '}') + '; return Harness;')(db, selectConfiguredMedia);
const h = new Harness();
h.memoryStore = new Map([['pinned', { active: true, nextRun: due }]]);
h.seedPinnedClientRuntimeJobs = () => {};
h.cacheJob = (id, job) => h.memoryStore.set(id, job);
h.claimDueRun = async () => true;
h.getReelsIntervalHours = () => 3;
h.getStoryIntervalHours = () => 2;
h.getStoryPlatforms = () => ['instagram_story'];
h.isBwinScopeUser = () => false;
let preserved = 0;
h.executeJob = async (id, job, options) => {
  if (id === 'pinned') throw new Error('simulated unrelated account failure');
  if (!options) h.memoryStore.set(id, { ...job, lastRunAt: 'fresh feed' });
  else { assert.equal(job.lastRunAt, 'fresh feed'); preserved++; }
  return { posted: 1, failed: [], nextRun: 'later' };
};
const result = await h.runDueJobsFromFallback({ toMillis: () => 1000 });
assert.equal(queries, 4);
assert.equal(result.processed, 4);
assert.equal(preserved, 2);
assert.equal(result.results.find(row => row.userId === 'simplicity').posted, 1);
h.getClientFallbackProfile = () => null;
assert.deepEqual(await h.selectNextVideo({ reelsSourceMode: 'static', reelsVideoUrls: ['a', 'b'], reelsVideoCursor: 1 }, 'instagram_reels', [], 'simplicity', new Set(['a', 'b'])), { videoUrl: 'b', nextCursor: 0 });
console.log('Configured schedules passed: durable discovery, account failure isolation, retained feed state, static media rotation.');
