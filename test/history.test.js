import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveHistory, listHistory, clearHistory, deleteHistory, HISTORY_LIMIT } from '../history.js';

test('history retains only the latest 10, reopens snapshots, and supports deletion', async () => {
  await clearHistory();
  for (let index = 0; index < 12; index++) await saveHistory(`answer ${index}`, { claims: [{ claim: `fact ${index}`, verdict: 'UNCERTAIN' }], verifiedClaims: 1 });
  const entries = await listHistory();
  assert.equal(HISTORY_LIMIT, 10);
  assert.equal(entries.length, 10);
  assert(!entries.some(entry => ['answer 0', 'answer 1'].includes(entry.original)));
  assert(entries.some(entry => entry.original === 'answer 11'));
  assert.equal(entries[0].result.claims.length, 1);
  await deleteHistory(entries[0].id);
  assert.equal((await listHistory()).length, 9);
  await clearHistory();
  assert.deepEqual(await listHistory(), []);
});
test('simultaneous history writes still honor the ten-entry cap', async () => {
  await Promise.all(Array.from({ length: 15 }, (_, i) => saveHistory(`concurrent ${i}`, { claims: [] })));
  assert.equal((await listHistory()).length, 10);
  await clearHistory();
});
