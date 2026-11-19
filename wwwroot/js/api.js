// Talks to the server. Every call sends the X-Quietly header the server requires for changes,
// and asks the browser not to cache or send a referrer.

async function call(method, path, body) {
  const headers = { 'X-Quietly': '1' };
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch('/api' + path, {
    method,
    headers,
    body: payload,
    credentials: 'same-origin',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  });
  let data = null;
  if (res.status !== 204) {
    try { data = await res.json(); } catch { data = null; }
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || 'Something went wrong. Please try again.');
    err.status = res.status;
    throw err;
  }
  return data;
}

// Passphrases are normalized here, in the browser, so "é" typed as one character or as e + accent gives the same key
// on every device. (The server also normalizes, but .NET's invariant-globalization mode skips that step.)
const pw = (s) => String(s == null ? '' : s).normalize('NFKC');

export const api = {
  me: () => call('GET', '/me'),
  register: (username, passphrase) => call('POST', '/auth/register', { username, passphrase: pw(passphrase) }),
  login: (username, passphrase) => call('POST', '/auth/login', { username, passphrase: pw(passphrase) }),
  logout: () => call('POST', '/auth/logout'),
  getState: () => call('GET', '/state'),
  putState: (json) => call('PUT', '/state', json),
  journalList: () => call('GET', '/journal'),
  journalAdd: (text, day) => call('POST', '/journal', { text, day }),
  journalDelete: (id) => call('DELETE', '/journal/' + id),
  assistantStatus: () => call('GET', '/assistant'),
  assistantAsk: (messages) => call('POST', '/assistant', { messages }),
  deleteAccount: (passphrase) => call('POST', '/account/delete', { passphrase: pw(passphrase) }),
};

/** Sign out even while the page is going away (used by Quick exit). */
export function logoutNow() {
  try {
    fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Quietly': '1' }, keepalive: true, credentials: 'same-origin' });
  } catch { /* nothing to do */ }
}
