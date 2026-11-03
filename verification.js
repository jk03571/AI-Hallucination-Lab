import { marked } from 'marked';

const navigation = /^(?:본문|메뉴|검색|목차|콘텐츠)(?:으로)?\s*바로가기$|^(?:로그인|회원가입|장바구니|고객센터|이전|다음|공유|구독|login|sign in|subscribe|skip to content)$/i;
export const compact = value => String(value ?? '').replace(/\s+/g, ' ').trim();

// Parse Markdown as data, never render search-provider HTML. Drop navigation and images.
export function cleanEvidence(value) {
  function plain(tokens) {
    return (tokens || []).map(token => {
      if (['image', 'html', 'code', 'def'].includes(token.type)) return '';
      if (token.type === 'link') {
        const label = plain(token.tokens);
        return navigation.test(compact(label)) || /^(?:javascript:|#)/i.test(token.href) || /^https?:\/\//i.test(label) ? '' : label;
      }
      if (token.type === 'list') return token.items.map(item => plain(item.tokens)).join('\n');
      if (token.type === 'table') return [token.header, ...token.rows].map(row => row.map(cell => plain(cell.tokens)).join(' · ')).join('\n');
      if (token.tokens) return plain(token.tokens) + (['paragraph', 'heading', 'blockquote'].includes(token.type) ? '\n' : '');
      if (['space', 'br', 'hr'].includes(token.type)) return '\n';
      return token.text || '';
    }).join('');
  }
  const text = plain(marked.lexer(String(value || '').slice(0, 16_000)));
  const lines = [...new Set(text.split('\n').map(line => compact(line.replace(/https?:\/\/[^\s]+/g, ''))).filter(line => line && !navigation.test(line)))];
  return lines.join('\n').slice(0, 2200);
}

export function normalizeJudgment(item, judgment = {}) {
  // Only references to supplied sources with a verbatim passage survive. This checks
  // provenance; the model still performs semantic entailment and identity matching.
  const citations = (Array.isArray(judgment.citations) ? judgment.citations : []).flatMap(citation => {
    if (!citation || typeof citation !== 'object') return [];
    const index = Number(citation.evidenceIndex);
    const source = item.evidence[index - 1];
    const quote = compact(citation.quote);
    const relation = citation.relation;
    if (!Number.isInteger(index) || !source || quote.length < 8 || quote.length > 600 ||
        !compact(source.content).includes(quote) || !['supporting', 'contradicting'].includes(relation) ||
        (item.requiresIdentity && citation.identityMatched !== true)) return [];
    return [{ evidenceIndex: index, quote, relation, explanation: compact(citation.explanation).slice(0, 400) }];
  });
  const supporting = [...new Set(citations.filter(c => c.relation === 'supporting').map(c => c.evidenceIndex))];
  const contradicting = [...new Set(citations.filter(c => c.relation === 'contradicting').map(c => c.evidenceIndex))];
  const permitted = { TRUE: supporting.length > 0, FALSE: contradicting.length > 0,
    PARTIALLY_TRUE: supporting.length > 0 && contradicting.length > 0, UNCERTAIN: true };
  const verdict = Object.hasOwn(permitted, judgment.verdict) && permitted[judgment.verdict] ? judgment.verdict : 'UNCERTAIN';
  const downgraded = verdict !== judgment.verdict;
  const reason = !item.evidence.length ? '관련된 검색 근거를 확보하지 못했습니다. 검색되지 않았다는 사실만으로 거짓이나 존재하지 않는다고 판단할 수 없습니다.'
    : downgraded ? '제공된 자료에서 이 내용에 직접 대응하는 인용 근거를 확인하지 못했습니다. 관련 자료가 있다는 것과 사실 확인이 완료됐다는 것은 다릅니다.'
    : compact(judgment.reason).slice(0, 1500) || '검색된 근거만으로 확정하기 어렵습니다.';
  const evidence = item.evidence.map((source, index) => {
    const passages = citations.filter(c => c.evidenceIndex === index + 1);
    const support = passages.some(c => c.relation === 'supporting');
    const contradiction = passages.some(c => c.relation === 'contradicting');
    return { ...source, evidenceIndex: index + 1, passages,
      relation: support && contradiction ? 'mixed' : support ? 'supporting' : contradiction ? 'contradicting' : 'context' };
  });
  return { ...item, status: 'verified', verdict, evidence,
    confidence: verdict === 'UNCERTAIN' ? 0 : Math.max(0, Math.min(100, Number(judgment.confidence) || 0)),
    reason, supportingEvidence: supporting, contradictingEvidence: contradicting,
    correction: ['FALSE', 'PARTIALLY_TRUE'].includes(verdict) ? compact(judgment.correction).slice(0, 1500) : '' };
}

export function summarize(claims) {
  const counts = { TRUE: 0, FALSE: 0, PARTIALLY_TRUE: 0, UNCERTAIN: 0 };
  const verified = claims.filter(item => item.status === 'verified');
  verified.forEach(item => counts[item.verdict]++);
  const checkable = counts.TRUE + counts.FALSE + counts.PARTIALLY_TRUE;
  const correctedFacts = verified.flatMap(item => {
    const text = item.verdict === 'TRUE' ? item.claim : ['FALSE', 'PARTIALLY_TRUE'].includes(item.verdict) ? item.correction : '';
    return text ? [{ claimId: item.id, subject: item.subject, text, corrected: item.verdict !== 'TRUE' }] : [];
  });
  return { counts, totalClaims: claims.length, verifiedClaims: verified.length, unverifiedClaims: claims.length - verified.length,
    verificationCoverage: claims.length ? Math.round(verified.length / claims.length * 1000) / 10 : 0,
    hallucinationRate: checkable ? Math.round(counts.FALSE / checkable * 100) : 0,
    rateDenominator: checkable, correctedFacts,
    verifiedAnswer: correctedFacts.map(item => item.text).join('\n') || '현재 근거로 확인하거나 수정할 수 있는 사실이 없습니다.' };
}
