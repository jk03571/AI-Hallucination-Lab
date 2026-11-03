import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExecution, emitLog, makeEvent } from '../verification-logs.js';

test('log templates discard credentials, arbitrary error messages and untrusted metadata', () => {
  for (const type of ['call', 'retry', 'sources', 'waiting', 'error', 'done']) {
    const event = makeEvent(type, { message: 'SECRET', authorization: 'SECRET', api_key: 'SECRET', code: 'SECRET', purpose: 'SECRET', calls: 'SECRET', count: 'SECRET' });
    assert.ok(!JSON.stringify(event).includes('SECRET'));
  }
  assert.equal(makeEvent('__proto__'), null);
});
test('concurrent execution events remain isolated; sharing replays history without duplicate API calls', async () => {
  const first = [], second = [], shared = [];
  const a = createExecution({ send: e => first.push(e) });
  const b = createExecution({ send: e => second.push(e) });
  await Promise.all([a.run(async () => { emitLog('start'); await Promise.resolve(); emitLog('call', { calls: 1 }); }), b.run(async () => { emitLog('empty'); })]);
  assert.deepEqual(first.map(e => e.type), ['start', 'call']);
  assert.deepEqual(second.map(e => e.type), ['empty']);
  const follower = { send: e => shared.push(e) }; a.attach(follower);
  a.publish('done', { calls: 1 });
  assert.deepEqual(shared.map(e => e.type), ['start', 'call', 'done']);
  a.detach(follower); a.publish('end'); assert.equal(shared.length, 3);
});
