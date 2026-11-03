import { AsyncLocalStorage } from 'node:async_hooks';

const context = new AsyncLocalStorage();
const number = value => Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
const errorReasons = {
  GEMINI_DAILY_LIMIT: 'Gemini 일일 예산 소진', GEMINI_QUOTA_EXHAUSTED: 'Gemini 할당량 소진',
  GEMINI_RATE_LIMIT: 'Gemini 요청 한도 초과', GEMINI_QUEUE_LIMIT: 'Gemini 대기 시간 초과',
  GEMINI_NETWORK: 'Gemini 연결 오류', GEMINI_ERROR: 'Gemini 응답 오류',
  TAVILY_AUTH: '검색 API 인증 오류', TAVILY_RATE_LIMIT: '검색 API 요청 한도 초과',
  TAVILY_NETWORK: '검색 서비스 연결 오류', TAVILY_ERROR: '검색 서비스 응답 오류',
  MISSING_GEMINI_KEY: 'Gemini API 설정 필요', MISSING_TAVILY_KEY: 'Tavily API 설정 필요',
  QUOTA_STATE: '사용량 저장소 오류', INVALID_JSON: '분석 결과 형식 오류'
};
const phase = purpose => purpose === 'claim-extraction' ? '주장 추출' : '전체 주장 일괄 판정';
// Only fixed templates and numeric operational data cross the SSE boundary.
// Never accept prompts, URLs, headers, provider payloads or error messages here.
const templates = {
  start: () => ['INFO', '서버에서 검증을 시작했습니다.'],
  extraction: () => ['INFO', '검증 가능한 사실 주장을 추출합니다.'],
  extracted: d => ['SUCCESS', `주장 ${number(d.total)}개 추출 · ${number(d.selected)}개 검증 선택`],
  cap: () => ['WARNING', '주장 추출 안전 한도에 도달했습니다.'],
  empty: () => ['WARNING', '검증 가능한 주장이 없어 검색과 판정을 생략합니다.'],
  search: d => ['INFO', `주장 ${number(d.claimId)}: Tavily 외부 근거 검색 시작`],
  searchCache: d => ['INFO', `주장 ${number(d.claimId)}: 검색 캐시 재사용`],
  searchShared: d => ['INFO', `주장 ${number(d.claimId)}: 진행 중인 검색 공유`],
  searchFallback: () => ['WARNING', 'Tavily HTTP 400 · 본문 옵션을 조정해 다시 검색합니다.'],
  sources: d => [d.count ? 'SUCCESS' : 'WARNING', `주장 ${number(d.claimId)}: 출처 필터링 후 유효 근거 ${number(d.count)}개`],
  judgment: () => ['INFO', '검색 근거를 전체 주장과 일괄 비교합니다.'],
  noEvidence: () => ['WARNING', '유효한 외부 근거가 없어 Gemini 판정을 생략합니다.'],
  queued: d => ['INFO', `${phase(d.purpose)}: Gemini 전송 대기열 진입`],
  waiting: d => ['INFO', `${phase(d.purpose)}: Gemini 전송 한도 대기 ${Math.ceil(number(d.ms) / 1000)}초`],
  call: d => ['INFO', `${phase(d.purpose)}: Gemini 호출 ${number(d.calls)}회 · 이번 시도 ${number(d.attempt)} · 일일 ${number(d.dailyUsed)}/${number(d.rpd)}회`],
  apiSuccess: d => ['SUCCESS', `${phase(d.purpose)}: Gemini 응답 수신`],
  retry: d => ['WARNING', `Gemini HTTP ${number(d.status)} · 재시도 ${number(d.retry)}/${number(d.maxRetries)} · ${Math.ceil(number(d.ms) / 1000)}초 후 재시도`],
  cache: () => ['SUCCESS', '검증 결과 캐시 재사용 · 추가 Gemini 호출 0회'],
  shared: () => ['INFO', '동일 입력의 진행 중인 검증을 공유합니다. 이후 호출 수는 공유 작업 기준입니다.'],
  error: d => ['ERROR', `${Object.hasOwn(errorReasons, d.code) ? errorReasons[d.code] : '검증 처리 실패'} · HTTP ${number(d.status) || 500} · Gemini 호출 ${number(d.calls)}회 (재시도 ${number(d.retries)}회 포함)`],
  done: d => ['SUCCESS', `검증 완료 · 이번 요청의 Gemini 호출 ${number(d.calls)}회 (재시도 ${number(d.retries)}회 포함)`],
  end: () => ['INFO', '이 검증의 로그 수신이 완료되었습니다.']
};
export function makeEvent(type, data = {}) {
  if (!Object.hasOwn(templates, type)) return null;
  const [level, message] = templates[type](data);
  return { type, level, message, time: new Date().toISOString() };
}
export function emitLog(type, data) { context.getStore()?.publish(type, data); }
export function createExecution(channel) {
  const channels = new Set(channel ? [channel] : []);
  const history = [];
  return {
    attach(next) { if (next) { for (const event of history) next.send(event); channels.add(next); } },
    detach(next) { channels.delete(next); },
    run(fn) { return context.run(this, fn); },
    publish(type, data) {
      const event = makeEvent(type, data);
      if (!event) return;
      history.push(event); if (history.length > 500) history.shift();
      for (const item of channels) item.send(event);
    }
  };
}

export function createLogStreams() {
  const sessions = new Map();
  const valid = id => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id || '');
  const cleanup = setInterval(() => {
    for (const [id, session] of sessions) if (!session.clients.size && !session.active && Date.now() - session.touched > 15 * 60_000) sessions.delete(id);
  }, 60_000);
  cleanup.unref();
  return {
    get(id) { return valid(id) ? sessions.get(id) : undefined; },
    connect(id, req, res) {
      if (!valid(id)) { res.writeHead(400).end(); return; }
      let session = sessions.get(id);
      if (!session) {
        if (sessions.size >= 1000) { res.writeHead(503).end(); return; }
        session = { clients: new Set(), events: [], seq: 0, touched: Date.now(), active: false, used: false,
          send(event) {
            this.touched = Date.now();
            const entry = { ...event, id: ++this.seq };
            this.events.push(entry); if (this.events.length > 500) this.events.shift();
            const packet = `id: ${entry.id}\ndata: ${JSON.stringify(entry)}\n\n`;
            for (const client of this.clients) if (!client.write(packet)) client.destroy();
          }
        };
        sessions.set(id, session);
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-store', 'X-Accel-Buffering': 'no', 'Referrer-Policy': 'no-referrer' });
      res.write(': connected\n\n');
      const last = Number(req.headers['last-event-id']) || 0;
      for (const entry of session.events) if (entry.id > last) res.write(`id: ${entry.id}\ndata: ${JSON.stringify(entry)}\n\n`);
      session.clients.add(res); session.touched = Date.now();
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
      res.on('close', () => { clearInterval(heartbeat); session.clients.delete(res); session.touched = Date.now(); });
    }
  };
}
