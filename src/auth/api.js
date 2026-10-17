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
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

export const register = (displayName, email, password) =>
  request('/register', {
    method: 'POST',
    body: JSON.stringify({ displayName, email, password })
  });

export const login = (email, password) =>
  request('/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });

export const logout = () => request('/logout', { method: 'POST' });
export const getCurrentAccount = () => request('/me');
