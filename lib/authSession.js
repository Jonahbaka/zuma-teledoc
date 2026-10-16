let generation = 0;
let cookieWrites = Promise.resolve();
let observedOwner;
let observedTransition;
let unconfirmedOwner = false;
const listeners = new Set();
const TRANSITION_KEY = 'doctarx.auth.transition';

function storageOwner() {
  if (typeof localStorage === 'undefined') return null;
  const token = localStorage.getItem('accessToken');
  return token ? authTokenOwnerHint(token) || token : null;
}
export function synchronizeAuthSession() {
  const owner = storageOwner();
  const transition = typeof localStorage === 'undefined' ? null : localStorage.getItem(TRANSITION_KEY);
  if (observedOwner === undefined) { observedOwner = owner; observedTransition = transition; }
  else if (observedOwner !== owner || observedTransition !== transition) {
    observedOwner = owner; observedTransition = transition; generation++; unconfirmedOwner = true;
    const notificationGeneration = generation;
    for (const listener of listeners) Promise.resolve().then(() => {
      if (listeners.has(listener) && generation === notificationGeneration && observedOwner === owner) listener();
    });
  }
  return generation;
}
export function subscribeAuthSession(listener) {
  synchronizeAuthSession(); listeners.add(listener);
  const changed = event => { if (!event || !event.key || ['accessToken','refreshToken',TRANSITION_KEY].includes(event.key)) synchronizeAuthSession(); };
  if (typeof window !== 'undefined') { window.addEventListener?.('storage', changed); window.addEventListener?.('focus', changed); }
  return () => { listeners.delete(listener); if (typeof window !== 'undefined') { window.removeEventListener?.('storage', changed); window.removeEventListener?.('focus', changed); } };
}
export function assertAuthSessionConfirmed() { synchronizeAuthSession(); if (unconfirmedOwner) throw staleAuthSessionError(); }
export function confirmAuthSessionOwner(owner) {
  synchronizeAuthSession();
  if (owner === null) { if (storageOwner() !== null) throw staleAuthSessionError(); unconfirmedOwner = false; return; }
  if (authTokenOwnerHint(typeof localStorage === 'undefined' ? null : localStorage.getItem('accessToken')) !== owner) throw staleAuthSessionError();
  unconfirmedOwner = false;
}
export function writeAuthSessionTokens(accessToken, refreshToken) {
  if (typeof localStorage === 'undefined') return;
  if (accessToken) localStorage.setItem('accessToken', accessToken); else localStorage.removeItem('accessToken');
  if (refreshToken) localStorage.setItem('refreshToken', refreshToken); else localStorage.removeItem('refreshToken');
  if (observedTransition === undefined) observedTransition = localStorage.getItem(TRANSITION_KEY);
  observedOwner = storageOwner(); unconfirmedOwner = false;
}

export function authSessionGeneration() { return synchronizeAuthSession(); }
export function beginAuthSessionTransition() {
  synchronizeAuthSession(); generation++;
  // This nonce orders browser intent only; it never authenticates an account.
  if (typeof localStorage !== 'undefined') { observedTransition = `${Date.now()}-${Math.random()}`; localStorage.setItem(TRANSITION_KEY, observedTransition); }
  return generation;
}
export function staleAuthSessionError() { return Object.assign(new Error('The account session changed. Use the current sign-in request.'), { code: 'AUTH_CONTEXT_CHANGED' }); }
export function isAuthCookieMutation(config = {}) {
  return String(config.method || 'get').toLowerCase() !== 'get' && /^\/?auth\//.test(String(config.url || '').replace(/^\/api(?=\/)/, ''));
}
export async function acquireAuthCookieWrite(expectedGeneration = generation) {
  if (expectedGeneration !== authSessionGeneration()) throw staleAuthSessionError();
  const previous = cookieWrites; let unlock;
  cookieWrites = new Promise(resolve => { unlock = resolve; });
  await previous;
  let originUnlock;
  let released = false; const release = () => { if (!released) { released = true; originUnlock?.(); unlock(); } };
  if (expectedGeneration !== authSessionGeneration()) { release(); throw staleAuthSessionError(); }
  if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
    if (!navigator.locks?.request) { release(); throw Object.assign(new Error('Secure browser session coordination is unavailable. Use a supported browser over HTTPS.'), {code:'AUTH_COORDINATION_UNAVAILABLE'}); }
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      await new Promise((resolve, reject) => {
        navigator.locks.request('doctarx-auth-cookie-write', { mode:'exclusive', signal:controller.signal }, async () => {
          if (expectedGeneration !== authSessionGeneration()) { reject(staleAuthSessionError()); return; }
          const held = new Promise(done => { originUnlock = done; }); resolve(); await held;
        }).catch(reject);
      });
    } catch (error) { release(); throw error; }
    finally { clearTimeout(timeout); }
  }
  return release;
}

// A consistency hint only. The backend remains the JWT/role/market authority.
export function authTokenOwnerHint(token) {
  try {
    const body = String(token).split('.')[1];
    if (!body) return null;
    const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.userId === 'string' ? payload.userId : null;
  } catch { return null; }
}
