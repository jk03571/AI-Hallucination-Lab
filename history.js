export const HISTORY_LIMIT = 10;
const databaseName = 'hallucination-lab-history';
const settingKey = 'hallucination-lab-save-history';
let connection;

export function historyEnabled() {
  try { return localStorage.getItem(settingKey) !== 'off'; } catch { return false; }
}
export function setHistoryEnabled(enabled) { localStorage.setItem(settingKey, enabled ? 'on' : 'off'); }

function openDatabase() {
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('results', { keyPath: 'id' });
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); connection = null; };
      resolve(db);
    };
    request.onerror = () => { connection = null; reject(request.error); };
    request.onblocked = () => { connection = null; reject(new Error('저장소가 다른 탭에서 사용 중입니다.')); };
  });
  return connection;
}

async function transaction(mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('results', mode);
    let value;
    tx.oncomplete = () => resolve(value);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('검증 내역 저장소를 사용할 수 없습니다.'));
    action(tx.objectStore('results'), result => { value = result; });
  });
}

export function listHistory() {
  return transaction('readonly', (store, done) => {
    store.getAll().onsuccess = event => done(event.target.result.sort((a, b) => b.savedAt - a.savedAt).slice(0, HISTORY_LIMIT));
  });
}

export function saveHistory(original, result) {
  return transaction('readwrite', (store, done) => {
    // The insert and eviction are atomic, including writes from multiple tabs.
    const entry = { id: crypto.randomUUID(), savedAt: Date.now(), original, result, version: 1 };
    store.put(entry);
    store.getAll().onsuccess = event => {
      const entries = event.target.result.sort((a, b) => b.savedAt - a.savedAt || (a.id === entry.id ? -1 : b.id === entry.id ? 1 : a.id.localeCompare(b.id)));
      for (const old of entries.slice(HISTORY_LIMIT)) store.delete(old.id);
      done(entry);
    };
  });
}
export function deleteHistory(id) { return transaction('readwrite', store => { store.delete(id); }); }
export function clearHistory() { return transaction('readwrite', store => { store.clear(); }); }
