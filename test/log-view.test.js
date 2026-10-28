import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// DOM fixture exercises interactions; dialog Escape/focus behavior is native browser behavior.
test('modal retains incoming server logs while closed; copy, clear, autoscroll, replay dedup and backdrop work', async () => {
  const nodes = new Map();
  function element() {
    return { handlers: {}, children: [], textContent: '', scrollTop: 0, scrollHeight: 900,
      addEventListener(name, fn) { this.handlers[name] = fn; },
      append(...items) { this.children.push(...items); },
      replaceChildren() { this.children = []; },
      showModal() { this.open = true; }, close() { this.open = false; },
      querySelector(key) { return node(key); },
      getBoundingClientRect() { return { left: 10, right: 110, top: 10, bottom: 110 }; }
    };
  }
  function node(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }
  const sources = [];
  class EventSource {
    constructor(url) { this.url = url; sources.push(this); queueMicrotask(() => this.onopen()); }
    close() { this.closed = true; }
    send(id, level, message, type = 'call') { this.onmessage({ data: JSON.stringify({ id, level, message, type, time: '2026-10-28T10:00:00Z' }) }); }
  }
  let copied;
  const context = vm.createContext({ document: { querySelector: node, createElement: element }, EventSource, crypto: { randomUUID: () => 'log-id' }, navigator: { clipboard: { writeText: async text => { copied = text; } } }, setTimeout, clearTimeout });
  vm.runInContext((await readFile(new URL('../log-view.js', import.meta.url), 'utf8')).replace('export function', 'function'), context);
  const ui = vm.runInContext('setupLogs()', context);
  await ui.connect();
  node('#logs-button').handlers.click(); assert.equal(node('#logs-dialog').open, true);
  node('.dialog-close').handlers.click(); assert.equal(node('#logs-dialog').open, false);
  sources[0].send(1, 'INFO', '<script>untrusted</script>');
  assert.equal(sources[0].closed, undefined); assert.equal(node('#verification-log').children.length, 1);
  assert.equal(node('#verification-log').children[0].children[2].textContent, '<script>untrusted</script>');
  sources[0].send(1, 'INFO', 'replayed'); assert.equal(node('#verification-log').children.length, 1);
  node('#logs-button').handlers.click(); assert.equal(node('#verification-log').scrollTop, 900);
  await node('#copy-logs').handlers.click(); assert.match(copied, /INFO <script>untrusted/);
  node('#logs-dialog').handlers.click({ target: node('#logs-dialog'), clientX: 30, clientY: 30 });
  assert.equal(node('#logs-dialog').open, true); // Padding is inside the modal, not the backdrop.
  node('#logs-dialog').handlers.click({ target: node('#logs-dialog'), clientX: 0, clientY: 0 });
  assert.equal(node('#logs-dialog').open, false);
  node('#clear-logs').handlers.click(); assert.equal(node('#verification-log').children.length, 0);
  assert.equal(sources[0].closed, undefined);
  sources[0].send(2, 'SUCCESS', '검증 완료'); assert.equal(node('#verification-log').children.length, 1);
  sources[0].send(3, 'INFO', '수신 완료', 'end'); assert.equal(sources[0].closed, true);
});
