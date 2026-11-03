import { HISTORY_LIMIT, historyEnabled, setHistoryEnabled, listHistory, saveHistory, deleteHistory, clearHistory } from './history.js';

const input = document.querySelector('#answer-input');
const verifyButton = document.querySelector('#verify-button');
const results = document.querySelector('#results');
const progress = document.querySelector('#progress-panel');
const errorBox = document.querySelector('#error-message');
const count = document.querySelector('#character-count');
const verifyLabel = verifyButton.querySelector('span');
let verificationInFlight = false;
let progressHideTimer;
let historyEntries = [];
const historyDialog = document.querySelector('#history-dialog');
const historyMessage = document.querySelector('#history-message');
const saveToggle = document.querySelector('#save-history');
const example = '대한민국의 수도는 부산이며, 인구는 약 500만 명이다. 서울은 한반도 남부에 위치한다.';
const verdicts = {
  TRUE: { label: '사실로 확인 · TRUE', tone: 'good', icon: '✓' },
  FALSE: { label: '오류 확인 · FALSE', tone: 'bad', icon: '✕' },
  PARTIALLY_TRUE: { label: '일부 수정 · PARTIALLY TRUE', tone: 'warn', icon: '!' },
  UNCERTAIN: { label: '확인 불가 · UNCERTAIN', tone: 'uncertain', icon: '?' }
};

input.addEventListener('input', () => { count.textContent = `${input.value.length.toLocaleString()} / 16,000`; });
document.querySelector('#example-button').addEventListener('click', () => { input.value = example; input.dispatchEvent(new Event('input')); input.focus(); });
for (const [buttonId, dialogId] of [['about-button', 'info-dialog'], ['setup-button', 'setup-dialog']]) document.querySelector(`#${buttonId}`).addEventListener('click', () => document.querySelector(`#${dialogId}`).showModal());
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.querySelector('.dialog-action')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
});

function safe(value = '') { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function safeUrl(value) { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } }
function sourceCard(source) {
  const url = safeUrl(source.url);
  const host = url ? new URL(url).hostname.replace(/^www\./, '') : '출처 주소 없음';
  const relation = ({ supporting: '지지 근거', contradicting: '반박 근거', mixed: '일부 지지 · 일부 반박' })[source.relation] || '참고 자료 · 직접 근거로 채택되지 않음';
  const passages = (source.passages || []).slice(0, 2);
  return `<div class="source-item"><div class="source-heading">${url ? `<a class="source-link" href="${safe(url)}" target="_blank" rel="noopener noreferrer">${safe(source.title)} ↗</a>` : safe(source.title)}<span class="source-domain">${safe(host)}</span></div><span class="source-claim">${relation}</span><div class="source-snippet">${passages.length ? passages.map(p => `<blockquote>${safe(p.quote)}</blockquote><p>${safe(p.explanation)}</p>`).join('') : `<p>${safe((source.content || '').slice(0, 220))}${source.content?.length > 220 ? '…' : ''}</p>`}<details class="evidence-detail"><summary>검색 발췌 더 보기</summary><p>${safe(source.content)}</p><small>검색 관련도 ${Math.round((source.score || 0) * 100)} / 100 — 사실일 확률이 아닙니다.</small></details></div></div>`;
}
function claimCard(claim, index) {
  const unverified = claim.status === 'unverified';
  const status = unverified ? { label: '미검증 · UNVERIFIED', tone: 'uncertain', icon: '○' } : verdicts[claim.verdict] || verdicts.UNCERTAIN;
  const direct = (claim.evidence || []).filter(source => source.passages?.length);
  const context = (claim.evidence || []).filter(source => !source.passages?.length);
  const id = claim.id ?? index + 1;
  const kind = ({ EXISTENCE: '존재 여부', ATTRIBUTION: '출처·귀속 정보', CONTENT: '내용·특성', NUMBER: '수치', DATE: '날짜·시점', CAUSAL: '원인과 결과', COMPARISON: '비교', FACT: '사실 정보' })[claim.kind] || '사실 정보';
  return `<article id="fact-${Number(id)}" class="claim ${unverified ? 'claim-unverified' : ''}"><div class="claim-main"><div class="claim-top"><p class="claim-text"><span class="claim-number">항목 ${safe(id)} · ${kind}</span>${safe(claim.claim)}</p><span class="verdict ${status.tone}">${status.icon} ${status.label}</span></div><div class="claim-verdict-line"><span>${unverified ? '검색·판정 미수행' : claim.verdict === 'UNCERTAIN' ? '사실 또는 거짓으로 확정할 근거 부족' : `직접 인용이 있는 자료 ${direct.length}건`}</span></div><p class="claim-reason"><b>${unverified ? '상태' : '판정 이유'}</b> ${safe(claim.reason)}</p>${!unverified && claim.correction ? `<div class="correction"><b>근거에 따른 수정</b><span>${safe(claim.correction)}</span></div>` : ''}<details class="item-detail"><summary>원문${!unverified && claim.verdict !== 'UNCERTAIN' ? ' · 모델 평가' : ''}</summary><p>${safe(claim.sourceQuote || claim.claim)}</p>${!unverified && claim.verdict !== 'UNCERTAIN' ? `<small>모델 평가 점수: ${safe(claim.confidence)} / 100. 통계적으로 보정된 신뢰 확률이 아닙니다.</small>` : ''}</details></div><div class="claim-sources"><p class="sources-label">근거와 출처</p>${direct.map(sourceCard).join('')}${context.length ? `<details class="reference-sources" ${!direct.length ? 'open' : ''}><summary>참고 검색 자료 ${context.length}건${!direct.length ? ' · 직접 확인에 부족함' : ''}</summary>${context.map(sourceCard).join('')}</details>` : ''}${!direct.length && !context.length ? `<p class="results-note">${unverified ? '검증 예산에서 제외되어 검색하지 않았습니다.' : '관련 근거를 확보하지 못했습니다. 자료가 없다는 이유만으로 거짓은 아닙니다.'}</p>` : ''}</div></article>`;
}
function render(data, original, savedAt = null) {
  const counts = data.counts || { TRUE: 0, FALSE: 0, PARTIALLY_TRUE: 0, UNCERTAIN: 0 };
  const claims = data.claims || [];
  const total = data.totalClaims ?? claims.length;
  const verified = data.verifiedClaims ?? claims.filter(claim => claim.status === 'verified').length;
  const unverified = data.unverifiedClaims ?? total - verified;
  const coverage = data.verificationCoverage ?? (total ? Math.round(verified / total * 1000) / 10 : 0);
  const distributionTotal = counts.TRUE + counts.FALSE + counts.PARTIALLY_TRUE + counts.UNCERTAIN;
  const denominator = data.rateDenominator ?? counts.TRUE + counts.FALSE + counts.PARTIALLY_TRUE;
  const capNotice = data.claimExtractionCapped ? `<p class="results-note cap-notice">안전 한도 ${safe(data.extractionSafetyLimit || 30)}개에 도달했습니다. 입력 전체의 모든 사실을 발견했다고 보장할 수 없습니다.</p>` : '';
  const groups = new Map();
  claims.forEach(claim => { const name = claim.subject || '검증 항목'; if (!groups.has(name)) groups.set(name, []); groups.get(name).push(claim); });
  const issues = claims.filter(item => ['FALSE', 'PARTIALLY_TRUE'].includes(item.verdict));
  const corrected = data.correctedFacts || claims.filter(item => item.verdict === 'TRUE' || item.correction && ['FALSE', 'PARTIALLY_TRUE'].includes(item.verdict)).map(item => ({ claimId: item.id, text: item.correction || item.claim }));
  results.innerHTML = `<div class="result-header"><div><span class="section-kicker">02 — FINDINGS</span><h2>${savedAt ? '저장된 검증 내역' : '검증 결과'}</h2></div><span class="result-meta">${safe(data.answerType || 'AI 답변 분석')} · ${safe(data.analysisDate || '')}</span></div>
    ${savedAt ? `<div class="saved-banner">${safe(new Date(savedAt).toLocaleString('ko-KR'))} 저장한 결과입니다. 다시 검색하지 않았으며 현재 정보와 다를 수 있습니다.</div>` : ''}
    <section class="summary-grid">${[[total, '발견한 사실 정보', ''], [verified, '검사 수행', ''], [unverified, '미검증', ''], [counts.TRUE, '사실로 확인', 'good'], [counts.PARTIALLY_TRUE, '일부 수정', 'warn'], [counts.FALSE, '오류 확인', 'bad'], [counts.UNCERTAIN, '확인 불가', '']].map(([n, name, tone]) => `<div class="summary-cell ${tone}"><span class="summary-num">${n}</span><span class="summary-name">${name}</span></div>`).join('')}</section>
    <section class="hallucination-summary"><div><span class="summary-name">할루시네이션 비율</span><strong>${denominator ? `${data.hallucinationRate || 0}%` : '계산 불가'}</strong><small>판정 가능한 ${denominator}건 중 오류 ${counts.FALSE}건</small></div><div><span class="summary-name">검사 수행 범위</span><strong class="coverage-value">${coverage}%</strong><small>발견 ${total}건 중 ${verified}건 검사 · 사실일 확률이 아님</small></div><div class="distribution">${[['TRUE', 'good'], ['PARTIALLY_TRUE', 'warn'], ['FALSE', 'bad'], ['UNCERTAIN', 'uncertain']].map(([key, tone]) => `<span style="width:${distributionTotal ? counts[key] / distributionTotal * 100 : 0}%" class="bar-${tone}"></span>`).join('')}</div><p class="rate-explanation">FALSE ÷ (TRUE + FALSE + PARTIALLY_TRUE). 확인 불가 ${counts.UNCERTAIN}건과 미검증 ${unverified}건은 계산에서 제외했습니다.</p></section>
    <section class="finding-summary"><h3>검증 요약</h3><p>${total ? `사실로 확인 ${counts.TRUE}건 · 오류 확인 ${counts.FALSE}건 · 일부 수정 ${counts.PARTIALLY_TRUE}건 · 확인 불가 ${counts.UNCERTAIN}건 · 미검증 ${unverified}건` : '웹 근거로 진위를 확인할 사실 정보를 찾지 못했습니다. 의견·추천·질문 자체는 참이나 거짓으로 판정하지 않습니다.'}</p>${issues.length ? `<ul>${issues.map(item => `<li><a href="#fact-${Number(item.id)}">${safe(item.claim)}</a><span>${safe(item.reason)}</span></li>`).join('')}</ul>` : ''}</section>
    ${capNotice}${data.extractionWarnings ? '<p class="results-note">원문에 대응하지 않는 일부 추출 항목은 제외했습니다.</p>' : ''}
    <div class="claims-title"><h3>항목별 사실 확인과 근거</h3><span class="result-meta">${safe(data.searchProvider || 'Tavily')} · ${safe(data.model || '')}</span></div><div class="claim-list">${[...groups].map(([name, items]) => `<section class="subject-group"><h3>${safe(name)}</h3>${items.map(claimCard).join('')}</section>`).join('')}</div>
    ${data.excludedContent?.length ? `<details class="excluded-panel"><summary>진위 판정 대상에서 제외한 표현 ${data.excludedContent.length}건</summary><ul>${data.excludedContent.map(item => `<li>${safe(item.text)}<span>${safe(item.reason)}</span></li>`).join('')}</ul></details>` : ''}
    <section class="answer-panel"><h3 class="answer-title"><span>✳</span> 근거로 확인·수정한 내용</h3><p class="results-note">확인 불가·미검증 내용은 아래 사실 정리에 포함하지 않았습니다. 원문 전체가 검증됐다는 의미는 아닙니다.</p>${corrected.length ? `<ul class="corrected-facts">${corrected.map(item => `<li>${safe(item.text)} <a href="#fact-${Number(item.claimId)}">[항목 ${safe(item.claimId)}]</a></li>`).join('')}</ul>` : '<p>현재 근거로 확인하거나 수정할 수 있는 사실이 없습니다.</p>'}</section><details class="original-panel"><summary>입력한 AI 답변 보기</summary><p class="original-text">${safe(original)}</p></details><p class="results-note">이 결과는 검색된 근거를 기반으로 한 검증 보조 결과이며, 중요한 정보는 원문 출처를 직접 확인하세요.</p>`;
  results.classList.remove('hidden');
}

function setProgress(step, label) {
  const steps = [...document.querySelectorAll('.step')];
  steps.forEach((item, index) => { item.classList.toggle('done', index < step); item.classList.toggle('active', index === step); });
  document.querySelector('#progress-label').textContent = label;
  progress.classList.toggle('is-running', step < 5);
}

async function runVerification() {
  if (verificationInFlight) return;
  const text = input.value.trim();
  errorBox.classList.add('hidden');
  if (!text) { errorBox.textContent = '검증할 답변을 먼저 입력해주세요.'; errorBox.classList.remove('hidden'); input.focus(); return; }
  verificationInFlight = true;
  clearTimeout(progressHideTimer);
  results.classList.add('hidden'); input.disabled = true;
  verifyButton.disabled = true; verifyLabel.textContent = '검증 중...'; progress.classList.remove('hidden');
  setProgress(-1, '답변의 사실 정보를 검색 근거와 비교하고 있습니다. 요청량에 따라 잠시 걸릴 수 있습니다.');
  try {
    const response = await fetch('/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '검증 요청에 실패했습니다.');
    setProgress(5, '검증 완료 ✓');
    document.querySelectorAll('.step').forEach(item => { item.classList.remove('active'); item.classList.add('done'); });
    render(data, text); results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (historyEnabled()) {
      try { await saveHistory(text, data); await refreshHistory(); }
      catch { document.querySelector('#storage-notice').textContent = '검증은 완료됐지만 브라우저 저장 공간을 사용할 수 없어 내역을 저장하지 못했습니다.'; }
    }
  } catch (error) {
    errorBox.textContent = error instanceof TypeError ? '서버에 연결하지 못했습니다. 네트워크 연결을 확인해주세요.' : error.message || '검증 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.'; errorBox.classList.remove('hidden');
  } finally { verificationInFlight = false; input.disabled = false; verifyButton.disabled = false; verifyLabel.textContent = '답변 검증하기'; progressHideTimer = setTimeout(() => progress.classList.add('hidden'), 700); }
}
verifyButton.addEventListener('click', runVerification);


function updatePrivacyNote() {
  document.querySelector('#privacy-note').textContent = historyEnabled() ? '최근 10건은 이 브라우저에 저장 · 내역에서 삭제 가능' : '내역 저장 꺼짐 · 서버 결과 캐시는 3분간 유지';
}
async function refreshHistory() {
  try {
    historyEntries = await listHistory();
    document.querySelector('#history-count').textContent = historyEntries.length;
    document.querySelector('#history-list').innerHTML = historyEntries.length ? historyEntries.map(entry => `<article class="history-entry"><time>${safe(new Date(entry.savedAt).toLocaleString('ko-KR'))}</time><p>${safe(entry.original.slice(0, 110))}${entry.original.length > 110 ? '…' : ''}</p><small>검사 ${entry.result.verifiedClaims || 0}건 · 오류 ${entry.result.counts?.FALSE || 0}건 · 확인 불가 ${entry.result.counts?.UNCERTAIN || 0}건</small><div class="history-actions"><button data-history-action="open" data-id="${safe(entry.id)}">결과 보기</button><button data-history-action="rerun" data-id="${safe(entry.id)}">다시 검증</button><button data-history-action="delete" data-id="${safe(entry.id)}">삭제</button></div></article>`).join('') : '<p class="empty-history">아직 저장된 검증 내역이 없습니다.</p>';
    document.querySelector('#clear-history').disabled = !historyEntries.length;
  } catch { historyMessage.textContent = '이 브라우저에서 검증 내역 저장소를 사용할 수 없습니다. 새 검증은 계속 이용할 수 있습니다.'; }
}
saveToggle.checked = historyEnabled();
updatePrivacyNote();
saveToggle.addEventListener('change', () => {
  try { setHistoryEnabled(saveToggle.checked); updatePrivacyNote(); historyMessage.textContent = saveToggle.checked ? '앞으로 완료한 검증을 저장합니다.' : '앞으로의 저장을 중단합니다. 기존 내역은 삭제 버튼으로 지울 수 있습니다.'; }
  catch { saveToggle.checked = false; historyMessage.textContent = '브라우저에서 저장 설정을 사용할 수 없습니다.'; }
});
document.querySelector('#history-button').addEventListener('click', () => { historyDialog.showModal(); refreshHistory(); });
document.querySelector('#clear-history').addEventListener('click', async () => {
  if (!confirm(`이 브라우저에 저장된 검증 내역을 모두 삭제할까요? (최대 ${HISTORY_LIMIT}건)`)) return;
  try { await clearHistory(); await refreshHistory(); historyMessage.textContent = '모든 검증 내역을 삭제했습니다.'; }
  catch { historyMessage.textContent = '내역을 삭제하지 못했습니다. 다시 시도해주세요.'; }
});
document.querySelector('#history-list').addEventListener('click', async event => {
  const button = event.target.closest('button[data-history-action]');
  if (!button) return;
  const entry = historyEntries.find(item => item.id === button.dataset.id);
  if (!entry) return;
  if (button.dataset.historyAction === 'delete') {
    try { await deleteHistory(entry.id); await refreshHistory(); }
    catch { historyMessage.textContent = '내역을 삭제하지 못했습니다.'; }
    return;
  }
  if (verificationInFlight) { historyMessage.textContent = '진행 중인 검증이 끝나면 내역을 열 수 있습니다.'; return; }
  historyDialog.close();
  errorBox.classList.add('hidden'); input.value = entry.original; input.dispatchEvent(new Event('input'));
  if (button.dataset.historyAction === 'rerun') await runVerification();
  else { render(entry.result, entry.original, entry.savedAt); results.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
});
refreshHistory();
