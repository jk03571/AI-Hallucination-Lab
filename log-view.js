export function setupLogs() {
  const dialog = document.querySelector('#logs-dialog');
  const list = document.querySelector('#verification-log');
  const empty = document.querySelector('#logs-empty');
  const status = document.querySelector('#logs-status');
  const copyButton = document.querySelector('#copy-logs');
  const entries = [];
  let stream;
  const bottom = () => { list.scrollTop = list.scrollHeight; };
  document.querySelector('#logs-button').addEventListener('click', () => { dialog.showModal(); bottom(); });
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
  // Native <dialog> handles Escape, focus trapping and focus restoration.
  document.querySelector('#clear-logs').addEventListener('click', () => {
    entries.length = 0; list.replaceChildren(); empty.hidden = false;
    copyButton.textContent = '로그 복사';
  });
  copyButton.addEventListener('click', async () => {
    const text = entries.map(item => `[${item.time}] ${item.level} ${item.message}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      copyButton.textContent = '복사 완료';
    } catch {
      // Support HTTP deployments where Clipboard API is unavailable.
      const textarea = document.createElement('textarea'); textarea.value = text;
      textarea.className = 'clipboard-buffer'; dialog.append(textarea); textarea.select();
      let copied = false;
      try { copied = document.execCommand('copy'); } catch { /* Show actionable state below. */ }
      textarea.remove(); copyButton.focus();
      copyButton.textContent = copied ? '복사 완료' : '복사 실패 · 다시 시도';
    }
  });
  return {
    async connect() {
      stream?.close();
      const id = crypto.randomUUID();
      const current = new EventSource(`/api/logs/${id}`);
      stream = current;
      let lastId = 0;
      status.textContent = '서버 로그 연결 중…';
      current.onmessage = event => {
        let item;
        try { item = JSON.parse(event.data); } catch { return; }
        if (!['INFO', 'SUCCESS', 'WARNING', 'ERROR'].includes(item.level) || typeof item.message !== 'string' || !Number.isInteger(item.id) || item.id <= lastId) return;
        lastId = item.id;
        entries.push(item);
        const row = document.createElement('div'); row.className = `log-entry log-${item.level.toLowerCase()}`;
        const time = document.createElement('time'); time.dateTime = item.time;
        time.textContent = new Date(item.time).toLocaleTimeString('ko-KR', { hour12: false });
        const level = document.createElement('span'); level.className = 'log-level'; level.textContent = item.level;
        const message = document.createElement('span'); message.className = 'log-message'; message.textContent = item.message;
        row.append(time, level, message); list.append(row); empty.hidden = true; bottom();
        copyButton.textContent = '로그 복사';
        status.textContent = '서버 로그 수신 중';
        if (item.type === 'end') { current.close(); status.textContent = '수신 완료 · 기록 유지 중'; }
      };
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { current.close(); reject(new Error('서버 로그 연결 시간이 초과되었습니다. 다시 시도해주세요.')); }, 10000);
        current.onopen = () => { clearTimeout(timeout); status.textContent = '서버 로그 연결됨'; resolve(); };
        current.onerror = () => {
          status.textContent = '서버 로그 연결 끊김 · 재연결 대기 중';
          // After opening, EventSource automatically reconnects using Last-Event-ID.
          // During initial connection, fail before sending the verification request.
        };
      });
      return id;
    }
  };
}
