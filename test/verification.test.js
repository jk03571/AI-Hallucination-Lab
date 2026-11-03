import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanEvidence, normalizeJudgment, summarize } from '../verification.js';

const source = { title: '공식 자료', url: 'https://example.gov/data', content: '실험은 표준 대기압에서 수행했다. 측정 온도는 섭씨 100도였다.', score: .8 };
const item = { id: 1, claim: '표준 대기압에서 측정 온도는 100도였다.', requiresIdentity: true, evidence: [source] };
const citation = { evidenceIndex: 1, quote: '측정 온도는 섭씨 100도였다.', relation: 'supporting', identityMatched: true, explanation: '측정 조건과 결과가 일치함' };

test('Markdown navigation, images and scripts never become evidence text', () => {
  const cleaned = cleanEvidence('[본문 바로가기](#main) [로그인](/login) ![광고](https://example.com/ad.png)\n\n**측정 온도**는 100도였다. [연구 기관](https://example.gov)에서 확인했다.\n\n<script>alert(1)</script>');
  assert.match(cleaned, /측정 온도는 100도였다/);
  assert.match(cleaned, /연구 기관/);
  assert.doesNotMatch(cleaned, /로그인|바로가기|광고|alert|https:|\]\(/);
});
test('a supported verdict keeps only actual source references', () => {
  const result = normalizeJudgment(item, { verdict: 'TRUE', confidence: 82, reason: '일치함', citations: [citation, { ...citation, evidenceIndex: 99 }] });
  assert.equal(result.verdict, 'TRUE');
  assert.deepEqual(result.supportingEvidence, [1]);
  assert.equal(result.evidence[0].passages.length, 1);
});
test('invented quotation and different entity cannot establish a fact', () => {
  for (const changed of [{ quote: '측정 온도는 200도였다.' }, { identityMatched: false }]) {
    const result = normalizeJudgment(item, { verdict: 'TRUE', citations: [{ ...citation, ...changed }] });
    assert.equal(result.verdict, 'UNCERTAIN');
    assert.equal(result.confidence, 0);
  }
});
test('absence and partial search coverage are not false or partial truth', () => {
  assert.equal(normalizeJudgment({ ...item, evidence: [] }, { verdict: 'FALSE', correction: '가짜다' }).verdict, 'UNCERTAIN');
  const partial = normalizeJudgment(item, { verdict: 'PARTIALLY_TRUE', citations: [citation], correction: '추측된 내용' });
  assert.equal(partial.verdict, 'UNCERTAIN');
  assert.equal(partial.correction, '');
});
test('malformed citations and unknown verdicts cannot create a classification', () => {
  const result = normalizeJudgment(item, { verdict: 'constructor', citations: [null, false, {}] });
  assert.equal(result.verdict, 'UNCERTAIN');
  assert.deepEqual(result.supportingEvidence, []);
});
test('direct contradiction supports false, and partial requires both relations', () => {
  const contradiction = { ...citation, relation: 'contradicting' };
  assert.equal(normalizeJudgment(item, { verdict: 'FALSE', citations: [contradiction] }).verdict, 'FALSE');
  const partial = normalizeJudgment(item, { verdict: 'PARTIALLY_TRUE', citations: [citation, contradiction] });
  assert.equal(partial.verdict, 'PARTIALLY_TRUE');
  assert.equal(partial.evidence[0].relation, 'mixed');
});
test('rate excludes unknown/unverified and revised facts exclude both', () => {
  const claims = ['TRUE', 'TRUE', 'FALSE', 'PARTIALLY_TRUE', 'UNCERTAIN', null].map((verdict, id) => ({ id, status: verdict ? 'verified' : 'unverified', verdict, claim: `original ${id}`, correction: verdict === 'FALSE' ? 'corrected' : '' }));
  const summary = summarize(claims);
  assert.equal(summary.hallucinationRate, 25);
  assert.equal(summary.rateDenominator, 4);
  assert.equal(summary.verificationCoverage, 83.3);
  assert.doesNotMatch(summary.verifiedAnswer, /original [2345]/);
  assert.match(summary.verifiedAnswer, /corrected/);
  assert.equal(summarize([claims[4]]).rateDenominator, 0);
});
