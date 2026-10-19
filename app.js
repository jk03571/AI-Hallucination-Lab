const input = document.querySelector('#answer-input');
const verifyButton = document.querySelector('#verify-button');
const results = document.querySelector('#results');
const progress = document.querySelector('#progress-panel');
const errorBox = document.querySelector('#error-message');
const count = document.querySelector('#character-count');
const verifyLabel = verifyButton.querySelector('span');
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
  return `<div class="source-item"><a class="source-link" href="${safe(source.url)}" target="_blank" rel="noopener noreferrer">${safe(source.title)} ↗</a><span class="source-claim">EVIDENCE ${String(index + 1).padStart(2, '0')} · ${Math.round(source.score * 100)}%</span><span class="source-snippet">${safe(source.content || '검색된 내용이 없습니다.')}</span></div>`;
}
function claimCard(claim, index) {
  const status = verdicts[claim.verdict] || verdicts.UNCERTAIN;
  const sources = (claim.evidence || []).map(sourceCard).join('');
  return `<article class="claim"><div class="claim-main"><div class="claim-top"><p class="claim-text"><span class="claim-number">CLAIM ${String(index + 1).padStart(2, '0')}</span>${safe(claim.claim)}</p><span class="verdict ${status.tone}">${status.icon} ${status.label}</span></div><div class="claim-verdict-line"><span>신뢰도 ${claim.confidence}%</span><span>${claim.evidence?.length || 0}개 검색 근거</span></div><p class="claim-reason"><b>판정 이유</b>${safe(claim.reason)}</p></div><div class="claim-sources"><p class="sources-label">EVIDENCE · TAVILY SEARCH</p>${sources || '<p class="results-note">검색 결과를 찾지 못했습니다.</p>'}</div></article>`;
}
function render(data, original) {
  const counts = data.counts || { TRUE: 0, FALSE: 0, PARTIALLY_TRUE: 0, UNCERTAIN: 0 };
  const claims = data.claims || [];
  const total = claims.length;
  results.innerHTML = `<div class="result-header"><div><span class="section-kicker">02 — FINDINGS</span><h2>검증 완료 ✓</h2></div><span class="result-meta">${total} CLAIMS · ${safe(data.searchProvider || 'Tavily')}</span></div><section class="summary-grid"><div class="summary-cell"><span class="summary-num">${total}</span><span class="summary-name">전체 주장</span></div><div class="summary-cell good"><span class="summary-num">${counts.TRUE}</span><span class="summary-name">✓ TRUE</span></div><div class="summary-cell warn"><span class="summary-num">${counts.PARTIALLY_TRUE}</span><span class="summary-name">! PARTIALLY TRUE</span></div><div class="summary-cell bad"><span class="summary-num">${counts.FALSE}</span><span class="summary-name">✕ FALSE</span></div></section><section class="hallucination-summary"><div><span class="summary-name">HALLUCINATION RATE</span><strong>${data.hallucinationRate || 0}%</strong><small>FALSE / 검증 가능한 주장</small></div><div class="distribution"><span style="width:${total ? counts.TRUE / total * 100 : 0}%" class="bar-good"></span><span style="width:${total ? counts.PARTIALLY_TRUE / total * 100 : 0}%" class="bar-warn"></span><span style="width:${total ? counts.FALSE / total * 100 : 0}%" class="bar-bad"></span><span style="width:${total ? counts.UNCERTAIN / total * 100 : 0}%" class="bar-uncertain"></span></div><div class="distribution-legend"><span>TRUE ${counts.TRUE}</span><span>FALSE ${counts.FALSE}</span><span>PARTIAL ${counts.PARTIALLY_TRUE}</span><span>UNCERTAIN ${counts.UNCERTAIN}</span></div></section><div class="claims-title"><h3>주장별 판정과 근거</h3><span class="result-meta">${safe(data.model || '')}</span></div><div class="claim-list">${claims.length ? claims.map(claimCard).join('') : '<p class="results-note">검증할 주장을 찾지 못했습니다.</p>'}</div><section class="answer-panel"><h3 class="answer-title"><span>✳</span> 검증된 답변</h3><p class="verified-answer">${safe(data.verifiedAnswer || '검증된 답변을 만들 수 없습니다.')}</p></section><details class="original-panel"><summary>입력한 AI 답변 보기</summary><p class="original-text">${safe(original)}</p></details><p class="results-note">이 결과는 검색된 근거를 기반으로 한 검증 보조 결과입니다. 중요한 정보는 원문 출처를 직접 확인하세요.</p>`;
  results.classList.remove('hidden');
}

function setProgress(step, label) {
  const steps = [...document.querySelectorAll('.step')];
  steps.forEach((item, index) => { item.classList.toggle('done', index < step); item.classList.toggle('active', index === step); });
  document.querySelector('#progress-label').textContent = label;
  document.querySelector('#progress-bar').style.width = `${Math.min(96, Math.max(10, step * 24 + 10))}%`;
}

async function runVerification() {
  const text = input.value.trim();
  errorBox.classList.add('hidden'); results.classList.add('hidden');
  if (!text) { errorBox.textContent = '검증할 답변을 먼저 입력해주세요.'; errorBox.classList.remove('hidden'); input.focus(); return; }
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
  } finally { verifyButton.disabled = false; verifyLabel.textContent = '답변 검증하기'; setTimeout(() => progress.classList.add('hidden'), 700); }
}
verifyButton.addEventListener('click', runVerification);
