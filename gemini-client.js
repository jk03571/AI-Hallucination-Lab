import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

const quotaError = (message, code, retryAfterMs) => Object.assign(new Error(message), { status: 429, code, retryAfterMs });
export function positiveInteger(value, fallback) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value)) || Number(value) < 1) throw new Error('Gemini quota settings must be positive integers');
  return Number(value);
}
export function retryAfterMs(response, now = Date.now()) {
  const value = response.headers.get('retry-after');
  if (!value) return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(value) - now) || 0;
}
const quotaDay = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));

// One gate for every Gemini attempt, including retries and concurrent verifications.
// The ledger contains counters only. Use one server process per API project.
export function createGeminiGate({ rpm = 5, rpd = 20, statePath, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), maxWaitMs = 180_000 } = {}) {
  let tail = Promise.resolve();
  let state;
  let persistTail = Promise.resolve();
  let cooldownUntil = 0;
  async function load() {
    if (state) return;
    try {
      const saved = JSON.parse(await readFile(statePath, 'utf8'));
      if (typeof saved.day !== 'string' || !Number.isInteger(saved.count) || saved.count < 0 || !Array.isArray(saved.starts) || !saved.starts.every(Number.isFinite) || !Number.isFinite(saved.cooldownUntil ?? 0)) throw new Error('invalid ledger');
      state = saved;
      cooldownUntil = saved.cooldownUntil || 0;
    } catch (error) {
      if (error.code !== 'ENOENT' && statePath) throw Object.assign(new Error('Gemini 사용량 파일을 읽지 못했습니다. 서버의 .runtime 폴더를 확인해주세요.'), { status: 503, code: 'QUOTA_STATE' });
      state = { day: quotaDay(now()), count: 0, starts: [] };
    }
  }
  function persist() {
    if (!statePath) return Promise.resolve();
    const snapshot = JSON.stringify({ ...state, cooldownUntil });
    const run = persistTail.then(async () => {
      await mkdir(dirname(statePath), { recursive: true });
      const temp = `${statePath}.tmp`;
      await writeFile(temp, snapshot, { mode: 0o600 });
      await rename(temp, statePath);
    });
    persistTail = run.catch(() => {});
    return run;
  }
  return {
    async cooldown(ms) { cooldownUntil = Math.max(cooldownUntil, now() + ms); await persist(); },
    async exhaustDay() { state.blockedDay = quotaDay(now()); await persist(); },
    acquire() {
      const queuedAt = now();
      const run = tail.then(async () => {
        await load();
        while (true) {
          const time = now();
          if (state.day !== quotaDay(time)) { state.day = quotaDay(time); state.count = 0; }
          state.starts = state.starts.filter(start => time - start < 60_100);
          if (state.count >= rpd || state.blockedDay === state.day) throw quotaError('Gemini 일일 요청 예산에 도달했습니다. Pacific 시간 자정 이후 다시 시도해주세요.', 'GEMINI_DAILY_LIMIT');
          const last = state.starts.at(-1);
          const wait = Math.max(0, cooldownUntil - time,
            last === undefined ? 0 : last + Math.ceil(60_100 / rpm) - time,
            state.starts.length >= rpm ? state.starts[0] + 60_100 - time : 0);
          if (time - queuedAt + wait > maxWaitMs) throw quotaError('Gemini 요청 대기 시간이 길어졌습니다. 잠시 후 다시 시도해주세요.', 'GEMINI_QUEUE_LIMIT', wait);
          if (wait > 0) { await sleep(wait); continue; }
          state.starts.push(time);
          state.count += 1; // Count failed/429 attempts conservatively, too.
          try { await persist(); }
          catch { throw Object.assign(new Error('Gemini 사용량을 저장하지 못해 요청을 중단했습니다.'), { status: 503, code: 'QUOTA_STATE' }); }
          return { dailyUsed: state.count, rpd, rpm };
        }
      });
      tail = run.catch(() => {});
      return run;
    }
  };
}

export async function requestGemini({ request, gate, usage, purpose, maxRetries = 2,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), random = Math.random, log = console.log }) {
  for (let attempt = 0; ; attempt++) {
    const quota = await gate.acquire();
    usage.geminiCalls++;
    if (attempt) usage.geminiRetries++;
    usage.byPurpose[purpose] = (usage.byPurpose[purpose] || 0) + 1;
    log(`[verify ${usage.requestId}] Gemini call=${usage.geminiCalls} purpose=${purpose} attempt=${attempt + 1} daily=${quota.dailyUsed}/${quota.rpd} rpm=${quota.rpm}`);
    let response;
    try { response = await request(); }
    catch { throw Object.assign(new Error('Gemini API에 연결하지 못했습니다.'), { status: 502, code: 'GEMINI_NETWORK' }); }
    if (response.ok) return response;
    // Never log or return provider payloads: they can echo request contents or keys.
    const payload = await response.json().catch(() => ({}));
    const details = payload.error?.details || [];
    const daily = /per.?day|requestsperday/i.test(JSON.stringify(details));
    const zeroQuota = /"quotaValue"\s*:\s*"?0"?/.test(JSON.stringify(details));
    const retryInfo = details.find(item => String(item['@type']).endsWith('RetryInfo'));
    const retrySeconds = /^([\d.]+)s$/.exec(retryInfo?.retryDelay || '');
    const backoff = 1000 * 2 ** attempt + Math.floor(random() * 1000);
    const delay = Math.max(retryAfterMs(response), retrySeconds ? Number(retrySeconds[1]) * 1000 : 0, backoff, response.status === 429 ? 60_100 : 0);
    if (response.status === 429) await gate.cooldown(delay);
    if (daily || zeroQuota) {
      if (daily) await gate.exhaustDay?.();
      throw quotaError('Gemini 일일 한도 또는 사용 가능한 할당량이 소진되었습니다. AI Studio의 모델별 한도를 확인해주세요.', 'GEMINI_QUOTA_EXHAUSTED');
    }
    const retryable = [429, 500, 502, 503, 504].includes(response.status);
    if (retryable && attempt < maxRetries && delay <= 180_000) {
      log(`[verify ${usage.requestId}] Gemini status=${response.status} retry=${attempt + 1}/${maxRetries} waitMs=${delay}`);
      await sleep(delay);
      continue;
    }
    const status = response.status;
    const message = status === 429 ? 'Gemini API 요청 한도에 도달했습니다. 잠시 후 다시 시도해주세요.' : status === 401 || status === 403 ? 'Gemini API 키 또는 접근 권한을 확인해주세요.' : status === 404 ? 'Gemini 모델 설정을 확인해주세요.' : 'Gemini 분석 요청에 실패했습니다. 잠시 후 다시 시도해주세요.';
    throw Object.assign(new Error(message), { status: status === 429 ? 429 : 502, code: status === 429 ? 'GEMINI_RATE_LIMIT' : 'GEMINI_ERROR', retryAfterMs: status === 429 ? delay : undefined });
  }
}
