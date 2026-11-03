import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

process.env.GEMINI_API_KEY = 'test-only-gemini';
process.env.TAVILY_API_KEY = 'test-only-tavily';
const usageDir = await mkdtemp(join(tmpdir(), 'lab-usage-'));
process.env.GEMINI_USAGE_PATH = join(usageDir, 'usage.json');
process.env.GEMINI_RPM = '600000';
process.env.GEMINI_RPD = '100';
after(() => rm(usageDir, { recursive: true, force: true }));
const { analyze, selectClaims, searchTavily, isBlockedSource, server } = await import('../server.js');
const nativeFetch = globalThis.fetch;
after(() => { globalThis.fetch = nativeFetch; });
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const gemini = value => json({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] });
function fixture(claim, query = claim, subject = '일반 정보') {
  return { claim, sourceQuote: claim, subject, kind: 'FACT', searchQuery: query, requiresIdentity: false };
}
function mockProviders(claims, { status, noEvidence = false } = {}) {
  const calls = { gemini: 0, tavily: 0, requests: [] };
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.requests.push(body);
    if (String(url).includes('generativelanguage')) {
      calls.gemini++;
      if (status) return new Response(JSON.stringify({ error: { message: 'This model is currently experiencing high demand.' } }), { status, headers: { 'Retry-After': '0' } });
      if (body.generationConfig.responseSchema.properties.claims) return gemini({ answerType: '일반 사실 설명', claims, excludedContent: [] });
      const prompt = body.contents[0].parts[0].text;
      const input = JSON.parse(prompt.slice(prompt.indexOf('[{"claimIndex"')));
      return gemini({ judgments: input.map(item => ({ claimIndex: item.claimIndex, verdict: noEvidence ? 'FALSE' : 'TRUE', confidence: 80, reason: '검색 자료와 일치합니다.', correction: '', citations: item.evidence.length ? [{ evidenceIndex: 1, quote: item.evidence[0].content, relation: 'supporting', identityMatched: true, explanation: '제공된 자료의 일치 여부를 테스트합니다.' }] : [] })) });
    }
    assert.equal(String(url), 'https://api.tavily.com/search');
    calls.tavily++;
    assert.equal(body.include_raw_content, false);
    assert.equal(body.search_depth, 'advanced');
    assert.equal(body.max_results, 5);
    return json({ results: noEvidence ? [] : [
      { title: '공식 자료', url: `https://example.gov/data?q=${encodeURIComponent(body.query)}`, content: `테스트용 검색 근거: ${body.query}. 자료에서 확인한 내용입니다.`, raw_content: '광고와 메뉴 원문은 사용하지 않는다', score: .9 },
      { title: '제외할 위키', url: 'https://en.wikipedia.org/wiki/Test', content: '최종 근거에 들어가면 안 되는 위키 내용입니다.', score: 1 }
    ] });
  };
  return calls;
}

test('normal verification uses two Gemini calls, shared searches and duplicate request coalescing', async () => {
  const claims = [fixture('제품 A의 무게는 120그램이다.', '제품 A 공식 사양', '제품 A'), fixture('제품 A의 용량은 256GB이다.', '제품 A 공식 사양', '제품 A')];
  const calls = mockProviders(claims);
  const answer = claims.map(item => item.claim).join('\n');
  const [first, duplicate] = await Promise.all([analyze(answer), analyze(answer)]);
  assert.deepEqual(first.claims, duplicate.claims);
  assert.equal(duplicate.apiUsage.shared, true);
  assert.equal(calls.gemini, 2);
  assert.equal(calls.tavily, 1);
  assert.equal(first.counts.TRUE, 2);
  assert.equal(first.claims[0].evidence.length, 1);
  assert.deepEqual(first.claims[0].supportingEvidence, [1]);
  await analyze(answer);
  assert.equal(calls.gemini, 2);
  await analyze(`${answer}\n추천합니다.`);
  assert.equal(calls.gemini, 4);
  assert.equal(calls.tavily, 1);
});
test('extraction failure skips Tavily', async () => { const calls = mockProviders([], { status: 401 }); await assert.rejects(analyze('failure')); assert.equal(calls.tavily, 0); assert.equal(calls.gemini, 1); });
test('opinions need no search or judgment and no-result search cannot establish falsehood', async () => {
  const opinions = mockProviders([]);
  const empty = await analyze('나는 이 색깔이 좋다.');
  assert.equal(empty.totalClaims, 0);
  assert.equal(opinions.gemini, 1); assert.equal(opinions.tavily, 0);
  const claim = fixture('이름을 확인할 수 없는 연구가 발표됐다.');
  const calls = mockProviders([claim], { noEvidence: true });
  const missing = await analyze(claim.claim);
  assert.equal(calls.gemini, 1);
  assert.equal(missing.counts.UNCERTAIN, 1);
  assert.equal(missing.rateDenominator, 0);
  assert.equal(missing.correctedFacts.length, 0);
});
test('17 facts have a 12-item budget and preserve unverified tail/head facts separately', async () => {
  const claims = Array.from({ length: 17 }, (_, i) => fixture(`실험 ${i + 1}의 결과는 ${i + 10}이다.`));
  claims[16] = fixture('햇빛이 두 배 강해지면 전압과 전류도 모두 정확히 두 배가 된다.');
  const calls = mockProviders(claims);
  const result = await analyze(claims.map(item => item.claim).join('\n'));
  assert.equal(result.totalClaims, 17); assert.equal(result.verifiedClaims, 12); assert.equal(result.unverifiedClaims, 5);
  assert.equal(result.claims[16].status, 'verified');
  assert(result.claims.filter(item => item.status === 'unverified').every(item => item.verdict === null));
  assert.equal(calls.gemini, 2); assert.equal(calls.tavily, 12);
  assert.equal(result.rateDenominator, 12);
});
test('selection covers later high-risk facts from the supplied long science example', () => {
  const texts = ['태양계 행성은 수성, 금성, 지구, 화성, 목성, 토성, 천왕성, 해왕성이다.', '지구는 태양으로부터 약 1억 5천만 km 떨어져 있다.', '지구 공전에는 약 365일이 걸린다.', '지구의 자전 때문에 낮과 밤이 발생한다.', '자전축 기울기와 공전 때문에 계절이 변한다.', '물은 일반적인 대기압에서 약 100℃에서 끓는다.', '높은 산에서는 대기압이 낮아지기 때문에 물의 끓는점이 100℃보다 낮아질 수 있다.', '태양전지는 빛에너지를 전기에너지로 변환한다.', '발전량은 일사량과 온도의 영향을 받는다.', '햇빛이 두 배 강해지면 전압과 전류도 모두 정확히 두 배가 된다.', '태양광 패널은 모든 지역에서 정남향 30도가 연중 항상 최적이다.', 'AI는 항상 사실만 말하므로 별도의 검증이 필요하지 않다.'];
  const selected = selectClaims(texts.map(text => fixture(text))).selected;
  assert.equal(selected.length, 10);
  for (const id of [7, 10, 11, 12]) assert(selected.some(item => item.id === id));
});
test('blocked domains including subdomains are excluded; concurrent search uses one request', async () => {
  for (const url of ['https://abc.blog.naver.com/a', 'https://example.tistory.com/a', 'https://en.wikipedia.org/a', 'https://cafe.daum.net/a']) assert.equal(isBlockedSource(url), true);
  const calls = mockProviders([]);
  const [a, b] = await Promise.all([searchTavily('동시 검색 테스트'), searchTavily('동시 검색 테스트')]);
  assert.deepEqual(a, b); assert.equal(calls.tavily, 1);
  assert.equal(a.length, 1); assert.doesNotMatch(a[0].content, /광고/);
});
test('HTTP endpoint preserves success/errors and serves no server secrets', async () => {
  const claim = fixture('독립 HTTP 검증 항목이다.'); mockProviders([claim]);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await nativeFetch(`${base}/api/verify`, { method: 'POST', body: JSON.stringify({ text: claim.claim }) });
    assert.equal(response.status, 200); assert.equal((await response.json()).totalClaims, 1);
    for (const [body, status] of [['invalid-json', 400], ['{}', 400], [JSON.stringify({ text: 'x'.repeat(16001) }), 413]]) {
      const failed = await nativeFetch(`${base}/api/verify`, { method: 'POST', body });
      assert.equal(failed.status, status); const error = await failed.json(); assert(error.error && error.code);
    }
    for (const path of ['.env', 'server.js', 'verification.js', 'test/server.test.js']) assert.equal((await nativeFetch(`${base}/${path}`)).status, 404);
    for (const path of ['', 'app.js', 'style.css', 'history.js']) {
      const response = await nativeFetch(`${base}/${path}`); assert.equal(response.status, 200);
      assert.doesNotMatch(await response.text(), /test-only-gemini|test-only-tavily/);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
