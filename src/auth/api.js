async function request(path, options = {}) {
  const response = await fetch(`/api/v1/auth${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.code = data.code;
    throw error;
  }
  return data;
}
const post = (path, body) => request(path, {
  method: 'POST',
  body: JSON.stringify(body)
});
export const register = (displayName, email, password) =>
  post('/register', { displayName, email, password });
export const login = (email, password) => post('/login', { email, password });
export const logout = () => request('/logout', { method: 'POST' });
export const getCurrentAccount = () => request('/me');
export const resendVerificationCode = email =>
  post('/verify-email/resend', { email });
export const verifyEmailCode = (email, code) =>
  post('/verify-email/confirm', { email, code });
