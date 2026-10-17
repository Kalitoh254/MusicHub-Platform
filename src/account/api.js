async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
const json = (method, body) => ({ method, body: JSON.stringify(body) });
export const getProfile = () => request('/api/v1/profile');
export const updateProfile = data => request('/api/v1/profile', json('PATCH', data));
export const getAdminSummary = () => request('/api/v1/admin/summary');
export const listAccounts = search => request('/api/v1/admin/accounts?search=' + encodeURIComponent(search || ''));
export const updateRole = (id, role) => request(`/api/v1/admin/accounts/${encodeURIComponent(id)}/role`, json('PATCH', { role }));
export const updateStatus = (id, disabled) => request(`/api/v1/admin/accounts/${encodeURIComponent(id)}/status`, json('PATCH', { disabled }));
export const revokeSessions = id => request(`/api/v1/admin/accounts/${encodeURIComponent(id)}/revoke-sessions`, { method: 'POST' });
