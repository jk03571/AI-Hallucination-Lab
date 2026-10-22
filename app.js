const input = document.querySelector('#answer-input');
const verifyButton = document.querySelector('#verify-button');
const results = document.querySelector('#results');
const progress = document.querySelector('#progress-panel');
const errorBox = document.querySelector('#error-message');
const count = document.querySelector('#character-count');
const verifyLabel = verifyButton.querySelector('span');
let verificationInFlight = false;
const example = '대한민국의 수도는 부산이며, 인구는 약 500만 명이다. 서울은 한반도 남부에 위치한다.';
const verdicts = {
  TRUE: { label: 'TRUE', tone: 'good', icon: '✓' },
  FALSE: { label: 'FALSE', tone: 'bad', icon: '✕' },
  PARTIALLY_TRUE: { label: 'PARTIALLY TRUE', tone: 'warn', icon: '!' },
  UNCERTAIN: { label: 'UNCERTAIN', tone: 'uncertain', icon: '?' }
};

input.addEventListener('input', () => { count.textContent = `${input.value.length.toLocaleString()} / 16,000`; });
document.querySelector('#example-button').addEventListener('click', () => { input.value = example; input.dispatchEvent(new Event('input')); input.focus(); });
for (const [buttonId, dialogId] of [['about-button', 'info-dialog'], ['setup-button', 'setup-dialog']]) document.querySelector(`#${buttonId}`).addEventListener('click', () => document.querySelector(`#${dialogId}`).showModal());
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.querySelector('.dialog-action').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
});

function safe(value = '') { const element = document.createElement('span'); element.textContent = String(value); return element.innerHTML; }
function sourceCard(source, index) {
  const relation = source.relation === 'supporting' ? '지지 근거' : source.relation === 'contradicting' ? '반박 근거' : '참고 근거';
  return `<div class="source-item"><a class="source-link" href="${safe(source.url)}" target="_blank" rel="noopener noreferrer">${safe(source.title)} ↗</a><span class="source-claim">${relation} · 검색 점수 ${Math.round(source.score * 100)}%${source.publishedDate ? ` · ${safe(source.publishedDate)}` : ''}</span><span class="source-snippet">${safe(source.content || '검색된 내용이 없습니다.')}</span></div>`;
}
function claimCard(claim, index) {
  const unverified = claim.status === 'unverified';
  const status = unverified ? { label: 'UNVERIFIED', tone: 'uncertain', icon: '○' } : verdicts[claim.verdict] || verdicts.UNCERTAIN;
  const sources = (claim.evidence || []).map(sourceCard).join('');
  return `<article class="claim ${unverified ? 'claim-unverified' : ''}"><div class="claim-main"><div class="claim-top"><p class="claim-text"><span class="claim-number">CLAIM ${String(index + 1).padStart(2, '0')}</span>${safe(claim.claim)}</p><span class="verdict ${status.tone}">${status.icon} ${status.label}</span></div><div class="claim-verdict-line">${unverified ? '<span>이번 실행에서 검증되지 않음</span>' : `<span>신뢰도 ${claim.confidence}%</span>`}</div><p class="claim-reason"><b>${unverified ? '상태' : '판정 이유'}</b>${safe(claim.reason)}</p>${!unverified && claim.correction ? `<div class="correction"><b>수정 제안</b><span>${safe(claim.correction)}</span></div>` : ''}</div><div class="claim-sources"><p class="sources-label">${unverified ? '검증 예산에서 제외됨' : 'EVIDENCE · TAVILY SEARCH'}</p>${sources || `<p class="results-note">${unverified ? '검색과 판정을 수행하지 않았습니다.' : '검색 결과를 찾지 못했습니다.'}</p>`}</div></article>`;
}
function render(data, original) {
  const counts = data.counts || { TRUE: 0, FALSE: 0, PARTIALLY_TRUE: 0, UNCERTAIN: 0 };
  const claims = data.claims || [];
  const total = data.totalClaims ?? claims.length;
  const verified = data.verifiedClaims ?? claims.filter(claim => claim.status === 'verified').length;
  const unverified = data.unverifiedClaims ?? total - verified;
  const coverage = data.verificationCoverage ?? (total ? Math.round(verified / total * 1000) / 10 : 0);
  const distributionTotal = counts.TRUE + counts.FALSE + counts.PARTIALLY_TRUE + counts.UNCERTAIN;
  const capNotice = data.claimExtractionCapped ? `<p class="results-note cap-notice">주장 추출 안전 한도 ${safe(data.extractionSafetyLimit || 30)}개에 도달했습니다. 입력에 추가 주장이 있었다면 일부가 발견되지 않았을 수 있습니다.</p>` : '';
  results.innerHTML = `<div class="result-header"><div><span class="section-kicker">02 — FINDINGS</span><h2>검증 완료 ✓</h2></div><span class="result-meta">${verified} / ${total} CLAIMS VERIFIED · ${safe(data.searchProvider || 'Tavily')}</span></div><section class="summary-grid"><div class="summary-cell"><span class="summary-num">${total}</span><span class="summary-name">발견 주장</span></div><div class="summary-cell"><span class="summary-num">${verified}</span><span class="summary-name">검증 완료</span></div><div class="summary-cell"><span class="summary-num">${unverified}</span><span class="summary-name">미검증</span></div><div class="summary-cell good"><span class="summary-num">${counts.TRUE}</span><span class="summary-name">✓ TRUE</span></div><div class="summary-cell warn"><span class="summary-num">${counts.PARTIALLY_TRUE}</span><span class="summary-name">! PARTIAL</span></div><div class="summary-cell bad"><span class="summary-num">${counts.FALSE}</span><span class="summary-name">✕ FALSE</span></div><div class="summary-cell"><span class="summary-num">${counts.UNCERTAIN}</span><span class="summary-name">? UNCERTAIN</span></div></section><section class="hallucination-summary"><div><span class="summary-name">HALLUCINATION RATE</span><strong>${data.hallucinationRate || 0}%</strong><small>FALSE / TRUE + FALSE + PARTIAL</small></div><div><span class="summary-name">VERIFICATION COVERAGE</span><strong class="coverage-value">${coverage}%</strong><small>${verified} verified · ${unverified} unverified</small></div><div class="distribution"><span style="width:${distributionTotal ? counts.TRUE / distributionTotal * 100 : 0}%" class="bar-good"></span><span style="width:${distributionTotal ? counts.PARTIALLY_TRUE / distributionTotal * 100 : 0}%" class="bar-warn"></span><span style="width:${distributionTotal ? counts.FALSE / distributionTotal * 100 : 0}%" class="bar-bad"></span><span style="width:${distributionTotal ? counts.UNCERTAIN / distributionTotal * 100 : 0}%" class="bar-uncertain"></span></div><div class="distribution-legend"><span>TRUE ${counts.TRUE}</span><span>FALSE ${counts.FALSE}</span><span>PARTIAL ${counts.PARTIALLY_TRUE}</span><span>UNCERTAIN ${counts.UNCERTAIN}</span></div></section>${capNotice}<div class="claims-title"><h3>주장별 판정과 근거</h3><span class="result-meta">${safe(data.model || '')}</span></div><div class="claim-list">${claims.length ? claims.map(claimCard).join('') : '<p class="results-note">검증할 주장을 찾지 못했습니다.</p>'}</div><section class="answer-panel"><h3 class="answer-title"><span>✳</span> 검증된 답변</h3><p class="verified-answer">${safe(data.verifiedAnswer || '검증된 답변을 만들 수 없습니다.')}</p></section><details class="original-panel"><summary>입력한 AI 답변 보기</summary><p class="original-text">${safe(original)}</p></details><p class="results-note">이 결과는 검색된 근거를 기반으로 한 검증 보조 결과입니다. 중요한 정보는 원문 출처를 직접 확인하세요.</p>`;
  results.classList.remove('hidden');
}

function setProgress(step, label) {
  const steps = [...document.querySelectorAll('.step')];
  steps.forEach((item, index) => { item.classList.toggle('done', index < step); item.classList.toggle('active', index === step); });
  document.querySelector('#progress-label').textContent = label;
  document.querySelector('#progress-bar').style.width = `${Math.min(96, Math.max(10, step * 24 + 10))}%`;
}

async function runVerification() {
  if (verificationInFlight) return;
  const text = input.value.trim();
  errorBox.classList.add('hidden'); results.classList.add('hidden');
  if (!text) { errorBox.textContent = '검증할 답변을 먼저 입력해주세요.'; errorBox.classList.remove('hidden'); input.focus(); return; }
  verificationInFlight = true;
  verifyButton.disabled = true; verifyLabel.textContent = '검증 중...'; progress.classList.remove('hidden'); setProgress(0, 'AI 답변 분석 중...');
  const progressMessages = ['AI 답변 분석 중...', '검증할 주장 추출 중...', '웹 근거 검색 중...', '근거와 주장 비교 중...', '최종 판정 작성 중...'];
  let step = 0;
  const timer = setInterval(() => { step = Math.min(step + 1, 4); setProgress(step, progressMessages[step]); }, 1200);
  try {
    const response = await fetch('/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '검증 요청에 실패했습니다.');
    clearInterval(timer); setProgress(5, '검증 완료 ✓');
    document.querySelectorAll('.step').forEach(item => { item.classList.remove('active'); item.classList.add('done'); });
    render(data, text); results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    clearInterval(timer); errorBox.textContent = error.message || '검증 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.'; errorBox.classList.remove('hidden');
  } finally { verificationInFlight = false; verifyButton.disabled = false; verifyLabel.textContent = '답변 검증하기'; setTimeout(() => progress.classList.add('hidden'), 700); }
}
verifyButton.addEventListener('click', runVerification);
