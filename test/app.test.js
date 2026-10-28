import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('button and in-flight guard allow one fetch and recover after failure', async () => {
  const nodes = new Map();
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, { value: 'test fact', textContent: '', disabled: false, style: {}, classList: { add() {}, remove() {}, toggle() {} }, querySelector: sub => node(key + sub), addEventListener() {} });
    return nodes.get(key);
  };
  let resolveFetch, calls = 0;
  const context = vm.createContext({ document: { querySelector: node, querySelectorAll: () => [] }, setupLogs: () => ({ connect: async () => 'test-log-id' }), console: { info() {} }, setInterval: () => 1, clearInterval() {}, fetch: () => { calls++; return new Promise(resolve => { resolveFetch = resolve; }); } });
  vm.runInContext((await readFile(new URL('../app.js', import.meta.url), 'utf8')).replace(/^import .*;\n/, ''), context);
  const first = vm.runInContext('runVerification()', context);
  await vm.runInContext('runVerification()', context);
  assert.equal(calls, 1); assert.equal(node('#verify-button').disabled, true);
  resolveFetch({ ok: false, json: async () => ({ error: 'rate limited', apiUsage: { geminiCalls: 3, geminiRetries: 2 } }) });
  await first;
  assert.equal(node('#verify-button').disabled, false);
  assert.match(node('#error-message').textContent, /rate limited/);
});
