import { initializeLiff, DEFAULT_LIFF_ID } from './liff-client.mjs';
export const LIFF_ID = DEFAULT_LIFF_ID;
// Initialize before the app can process navigation; keep existing server session auth.
try {
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
    script.charset = 'utf-8';
    const timer = setTimeout(() => reject(new Error('LIFF_LOAD_TIMEOUT')), 8000);
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); reject(new Error('LIFF_LOAD_FAILED')); };
    document.head.append(script);
  });
  const environment = await initializeLiff(LIFF_ID);
  document.documentElement.dataset.lineClient = String(environment.inClient);
  if (environment.inClient && environment.loggedIn) {
    const session = await fetch('/api/session', {credentials: 'same-origin', cache: 'no-store'});
    if (!session.ok) throw new Error('SESSION_UNAVAILABLE');
    if (!(await session.json()).authenticated) {
      const idToken = globalThis.liff.getIDToken();
      if (!idToken) throw new Error('LIFF_TOKEN_UNAVAILABLE');
      const login = await fetch('/auth/liff', {method: 'POST', credentials: 'same-origin',
        headers: {'content-type': 'application/json'}, body: JSON.stringify({idToken})});
      if (!login.ok) throw new Error('LIFF_LOGIN_FAILED');
    }
  }
} catch {
  // SDK failure must not prevent the existing authenticated web app from loading.
  document.documentElement.dataset.lineClient = 'unavailable';
}
await import('./app.mjs');
