// Credentials stay in server-side environment variables and are never printed.
export async function smokeSession(roles) {
  const base = process.env.APP_URL || 'http://127.0.0.1:3000';
  const { PASSCHECK_SMOKE_EMAIL: email, PASSCHECK_SMOKE_PASSWORD: password } = process.env;
  if (!email || !password) throw new Error('Set PASSCHECK_SMOKE_EMAIL and PASSCHECK_SMOKE_PASSWORD to an authorized test account. Never use NEXT_PUBLIC_ variables.');
  const response = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('Smoke account sign-in failed');
  const { user } = await response.json();
  if (!roles.includes(user.role)) throw new Error(`Use a ${roles.join(' or ')} test account`);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Session cookie missing');
  return (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { Cookie: cookie, 'Content-Type': 'application/json', ...options.headers }, signal: options.signal || AbortSignal.timeout(15_000) });
}
