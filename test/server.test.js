import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';

test('HTTP: batched claims, simultaneous dedup, cache, empty/no evidence, sanitized errors and static allowlist', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hallucination-test-'));
  let child;
  try {
    for (const file of ['server.js', 'gemini-client.js', 'verification-logs.js', 'package.json']) await copyFile(new URL(`../${file}`, import.meta.url), join(dir, file));
    await writeFile(join(dir, 'mock.mjs'), `
      globalThis.fetch = async (url, options) => {
        const body = JSON.parse(options.body);
        if (String(url).includes('tavily')) {
          if (body.query.includes('error')) return new Response(JSON.stringify({error:{message:'TEST_KEY_SECRET'}}),{status:401});
          return Response.json({results: body.query.includes('no-evidence') ? [] : [
            {title:'Official source',url:'https://example.gov/fact',content:'A fact',score:0.9},
            {title:'Blocked',url:'https://blog.naver.com/post',content:'Not evidence',score:1}
          ]});
        }
        const prompt = body.contents[0].parts[0].text;
        await new Promise(r=>setTimeout(r, 30));
        const answer = prompt.includes('<answer>') ? {claims:prompt.includes('empty-input') ? [] : [{claim:prompt.includes('no-evidence') ? 'no-evidence fact' : prompt.includes('error-input') ? 'error fact' : 'fact A'},{claim:'fact B'+(prompt.includes('no-evidence')?' no-evidence':'')}]} : {judgments:[1,2].map(claimIndex=>({claimIndex, verdict:'TRUE',confidence:90,reason:'Source confirms',supportingEvidence:[1],contradictingEvidence:[],correction:''}))};
        return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(answer)}]}}]});
      };
      await import('./server.js');
    `);
    child = spawn(process.execPath, ['mock.mjs'], { cwd: dir, env: { ...process.env, PORT: '0', GEMINI_API_KEY: 'TEST_KEY_SECRET', TAVILY_API_KEY: 'TEST_KEY_SECRET', GEMINI_RPM: '600000', GEMINI_RPD: '100' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let logs = '';
    child.stdout.on('data', d => { logs += d; }); child.stderr.on('data', d => { logs += d; });
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start')), 5000);
      child.stdout.on('data', () => { const match = logs.match(/localhost:(\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
      child.once('error', reject);
    });
    const base = `http://localhost:${port}`;
    const verify = async (text, logId) => { const r = await fetch(base + '/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, logId }) }); return { status: r.status, data: await r.json() }; };
    const openLogs = async (id = randomUUID(), lastId = 0) => {
      const controller = new AbortController();
      const response = await fetch(base + '/api/logs/' + id, { signal: controller.signal, headers: { 'Last-Event-ID': String(lastId) } });
      assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
      const reader = response.body.getReader();
      const events = [];
      const complete = (async () => {
        let buffer = '';
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let boundary;
            while ((boundary = buffer.indexOf('\n\n')) >= 0) {
              const packet = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
              const line = packet.split('\n').find(line => line.startsWith('data: '));
              if (!line) continue;
              const event = JSON.parse(line.slice(6)); events.push(event);
              if (event.type === 'end') { controller.abort(); return events; }
            }
          }
        } catch (error) { if (error.name !== 'AbortError') throw error; }
        return events;
      })();
      return { id, controller, events, complete };
    };
    const firstLogs = await openLogs(), sharedLogs = await openLogs(), isolatedLogs = await openLogs();
    const running = verify('fact-input', firstLogs.id);
    // Actual server events arrive while the verification HTTP response is pending.
    const deadline = Date.now() + 5000;
    while (!firstLogs.events.some(event => event.type === 'extraction') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(firstLogs.events.some(event => event.type === 'extraction'));
    const concurrent = await Promise.all([running, verify('fact-input', sharedLogs.id)]);
    const [firstEvents, sharedEvents] = await Promise.all([firstLogs.complete, sharedLogs.complete]);
    assert.equal(firstEvents.filter(e => e.type === 'call').length, 2);
    assert.ok(firstEvents.some(e => e.type === 'sources'));
    assert.ok(sharedEvents.some(e => e.type === 'shared'));
    assert.equal(isolatedLogs.events.length, 0);
    isolatedLogs.controller.abort(); await isolatedLogs.complete;
    const resumed = await openLogs(firstLogs.id, firstEvents.at(-2).id);
    assert.deepEqual((await resumed.complete).map(e => e.type), ['end']);
    assert.ok(!JSON.stringify(firstEvents).includes('TEST_KEY_SECRET'));
    assert.ok(!JSON.stringify(firstEvents).includes('fact-input'));
    const errorLogs = await openLogs();
    await verify('error-input', errorLogs.id);
    const errors = await errorLogs.complete;
    assert.ok(errors.some(e => e.level === 'ERROR'));
    assert.ok(!JSON.stringify(errors).includes('TEST_KEY_SECRET'));

    assert.deepEqual(concurrent.map(r => r.data.apiUsage.geminiCalls).sort(), [0, 2]);
    for (const { data } of concurrent) {
      assert.equal(data.claims.length, 2); assert.equal(data.claims[0].evidence.length, 1);
      assert.equal(data.claims[0].evidence[0].url, 'https://example.gov/fact');
    }
    assert.equal((await verify('fact-input')).data.apiUsage.geminiCalls, 0);
    assert.equal((await verify('empty-input')).data.apiUsage.geminiCalls, 1);
    const noEvidence = (await verify('no-evidence')).data;
    assert.equal(noEvidence.apiUsage.geminiCalls, 1); assert.equal(noEvidence.counts.UNCERTAIN, 2);
    const failed = await verify('error-input'); assert.equal(failed.status, 401); assert.equal(failed.data.apiUsage.geminiCalls, 1);
    for (const path of ['/.env', '/.runtime/gemini-usage.json', '/gemini-client.js']) assert.equal((await fetch(base + path)).status, 404);
    assert.ok(!JSON.stringify(failed).includes('TEST_KEY_SECRET')); assert.ok(!logs.includes('TEST_KEY_SECRET'));
  } finally {
    if (child) { if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, 'exit'); } }
    await rm(dir, { recursive: true, force: true });
  }
});
