import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGeminiGate, requestGemini, retryAfterMs } from '../gemini-client.js';

const usage = () => ({ requestId: 'test', geminiCalls: 0, geminiRetries: 0, byPurpose: {} });
test('global gate spaces concurrent requests and counts retries in RPM', async () => {
  let time = Date.now();
  const starts = [];
  const gate = createGeminiGate({ now: () => time, sleep: async ms => { time += ms; } });
  await Promise.all(Array.from({ length: 8 }, async () => { await gate.acquire(); starts.push(time); }));
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 12020);
  for (const start of starts) assert.ok(starts.filter(t => t >= start && t < start + 60000).length <= 5);
});
test('RPD ledger survives restart and resets at Pacific midnight', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gemini-quota-'));
  try {
    let time = Date.parse('2026-10-28T06:59:00Z');
    const options = { statePath: join(dir, 'usage.json'), rpd: 1, now: () => time };
    await createGeminiGate(options).acquire();
    await assert.rejects(createGeminiGate(options).acquire(), { code: 'GEMINI_DAILY_LIMIT' });
    time = Date.parse('2026-10-28T07:01:00Z');
    assert.equal((await createGeminiGate(options).acquire()).dailyUsed, 1);
  } finally { await rm(dir, { recursive: true }); }
});
test('429 honors Retry-After, cooldown and counts actual attempts', async () => {
  const waits = [], cooldowns = [], logs = [];
  let attempts = 0;
  const stats = usage();
  const response = await requestGemini({
    request: async () => ++attempts === 1 ? new Response(JSON.stringify({ error: { message: 'SECRET' } }), { status: 429, headers: { 'Retry-After': '90' } }) : new Response('{}'),
    gate: { acquire: async () => ({ dailyUsed: attempts + 1, rpd: 20, rpm: 5 }), cooldown: ms => cooldowns.push(ms) },
    usage: stats, purpose: 'judgment', sleep: async ms => waits.push(ms), log: msg => logs.push(msg)
  });
  assert.equal(response.status, 200);
  assert.deepEqual(waits, [90000]); assert.deepEqual(cooldowns, [90000]);
  assert.equal(stats.geminiCalls, 2); assert.equal(stats.geminiRetries, 1);
  assert.ok(!logs.join('').includes('SECRET'));
});
test('daily quota errors do not retry or expose provider messages', async () => {
  let attempts = 0;
  await assert.rejects(requestGemini({ request: async () => {
    attempts++;
    return new Response(JSON.stringify({ error: { message: 'SECRET', details: [{ quotaId: 'GenerateRequestsPerDayPerProject' }] } }), { status: 429 });
  }, gate: { acquire: async () => ({}), cooldown() {} }, usage: usage(), purpose: 'test', sleep: async () => assert.fail('must not retry'), log() {} }), error => error.code === 'GEMINI_QUOTA_EXHAUSTED' && !error.message.includes('SECRET'));
  assert.equal(attempts, 1);
});
test('5xx exponential backoff is bounded and every attempt is counted', async () => {
  const waits = [], stats = usage();
  await assert.rejects(requestGemini({ request: async () => new Response('{}', { status: 503 }), gate: { acquire: async () => ({}), cooldown() {} }, usage: stats, purpose: 'test', sleep: async ms => waits.push(ms), random: () => 0, log() {} }));
  assert.deepEqual(waits, [1000, 2000]); assert.equal(stats.geminiCalls, 3); assert.equal(stats.geminiRetries, 2);
});
test('Retry-After supports HTTP date', () => {
  assert.equal(retryAfterMs(new Response('', { headers: { 'Retry-After': 'Wed, 28 Oct 2026 07:01:00 GMT' } }), Date.parse('2026-10-28T07:00:00Z')), 60000);
});
test('provider daily exhaustion blocks further calls and survives restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gemini-exhausted-'));
  try {
    const options = { statePath: join(dir, 'usage.json') };
    const gate = createGeminiGate(options);
    await gate.acquire(); await gate.exhaustDay();
    await assert.rejects(gate.acquire(), { code: 'GEMINI_DAILY_LIMIT' });
    await assert.rejects(createGeminiGate(options).acquire(), { code: 'GEMINI_DAILY_LIMIT' });
  } finally { await rm(dir, { recursive: true }); }
});
test('shared cooldown delays other verifications and queue waits are bounded', async () => {
  let time = Date.now();
  const gate = createGeminiGate({ now: () => time, sleep: async ms => { time += ms; } });
  await gate.acquire(); await gate.cooldown(90000);
  const start = time; await gate.acquire(); assert.equal(time - start, 90000);
  await gate.cooldown(200000);
  await assert.rejects(gate.acquire(), { code: 'GEMINI_QUEUE_LIMIT' });
});
