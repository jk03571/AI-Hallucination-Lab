// Manual UI regression only. Fictional fixtures, no external requests, loopback only.
// Start explicitly with node test/ui-preview.js; never used by npm start/dev.
process.env.GEMINI_API_KEY = 'ui-test-only';
process.env.TAVILY_API_KEY = 'ui-test-only';
const { server } = await import('../server.js');
const facts = [
  ['테스트 제품 A의 무게는 120g이다.', '제품 A', 'NUMBER', 'TRUE', '제품 A의 무게는 120g이다. 공식 사양의 측정값이다.'],
  ['테스트 보고서는 2024년에 발표됐다.', '테스트 보고서', 'DATE', 'UNCERTAIN', '보고서 발행일을 확인할 수 있는 정보가 없다.'],
  ['테스트 도서의 저자는 김민수다.', '테스트 도서', 'ATTRIBUTION', 'FALSE', '테스트 도서의 저자는 이지은이다. 출판 정보에 기재되어 있다.'],
  ['모든 장소에서 물은 정확히 100℃에서 끓는다.', '물의 끓는점', 'CAUSAL', 'PARTIALLY_TRUE', '물은 표준 대기압에서 약 100℃에서 끓는다. 기압이 낮아지면 끓는점도 낮아진다.']
];
const response = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  if (String(url).includes('tavily')) {
    const fact = facts.find(item => item[1] === body.query);
    if (!fact || fact[3] === 'UNCERTAIN') return response({ results: [] });
    return response({ results: [{ title: '화면 테스트용 자료 (가상)', url: `https://sources.example/${encodeURIComponent(fact[1])}`, content: `[로그인](/login) ![광고](/ad.png)\n\n${fact[4]}`, score: .9 }] });
  }
  await new Promise(resolve => setTimeout(resolve, 600));
  let result;
  if (body.generationConfig.responseSchema.properties.claims) {
    const prompt = body.contents[0].parts[0].text;
    const original = prompt.split('<answer>\n')[1].split('\n</answer>')[0];
    if (original === '오류 테스트') return new Response('{}', { status: 401 });
    result = { answerType: '화면 테스트 · 외부 API 미사용', claims: facts.filter(fact => original.includes(fact[0])).map(fact => ({ claim: fact[0], sourceQuote: fact[0], subject: fact[1], kind: fact[2], requiresIdentity: true, searchQuery: fact[1] })), excludedContent: original.includes('이 책을 추천한다.') ? [{ text: '이 책을 추천한다.', reason: '추천 자체는 진위를 판정할 수 없는 표현입니다.' }] : [] };
  } else {
    const prompt = body.contents[0].parts[0].text;
    const items = JSON.parse(prompt.slice(prompt.indexOf('[{"claimIndex"')));
    result = { judgments: items.map(item => {
      const fact = facts.find(f => f[0] === item.claim);
      const quote = item.evidence[0]?.content || '';
      const citations = fact[3] === 'UNCERTAIN' ? [] : [{ evidenceIndex: 1, quote, relation: fact[3] === 'FALSE' ? 'contradicting' : 'supporting', identityMatched: true, explanation: '화면 테스트를 위한 가상 근거입니다.' }];
      if (fact[3] === 'PARTIALLY_TRUE') citations.push({ ...citations[0], relation: 'contradicting' });
      return { claimIndex: item.claimIndex, verdict: fact[3], confidence: 80, reason: fact[3] === 'FALSE' ? '테스트 자료에 기재된 저자와 일치하지 않습니다.' : fact[3] === 'PARTIALLY_TRUE' ? '대기압이라는 조건이 누락되어 모든 장소에 적용할 수 없습니다.' : fact[3] === 'UNCERTAIN' ? '발행 연도를 확인할 수 있는 자료가 없습니다.' : '테스트 사양의 수치와 일치합니다.', citations, correction: ['FALSE', 'PARTIALLY_TRUE'].includes(fact[3]) ? fact[4] : '' };
    }) };
  }
  return response({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] });
};
let requests = 0;
server.on('request', request => { if (request.method === 'POST') console.log(`[ui-test] verification POST ${++requests}`); });
server.listen(4180, '127.0.0.1', () => console.log('UI test only: http://localhost:4180 (fictional fixtures, no external API)'));
