const API_URL = import.meta.env.DEV ? '/api' : (import.meta.env.VITE_API_URL || '/api')

async function request(path, options = {}, token) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message || 'Request failed')
  return body
}

export const requestSignupCode = (email) => request('/auth/request-otp', { method: 'POST', body: JSON.stringify({ email, purpose: 'signup' }) })
export const signUp = (email, password, name, college, year, branch) => request('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, name, college, year, branch }) })
export const verifySignupCode = (email, code, password, name, college, year, branch) => request('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email, code, password, name, college, year, branch }) })
export const updateProfile = (profile, token) => request('/me', { method: 'PATCH', body: JSON.stringify(profile) }, token)
export const signIn = (email, password) => request('/auth/signin', { method: 'POST', body: JSON.stringify({ email, password }) })
export const changePassword = (currentPassword, newPassword, token) => request('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }, token)
export const forgotPassword = (email) => request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) })
export const resetPassword = (token, password) => request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) })
export const getNotes = (token) => request('/notes', {}, token)
export const createNote = (note, token) => request('/notes', { method: 'POST', body: JSON.stringify(note) }, token)
export const getFolders = (token) => request('/folders', {}, token)
export const createFolder = (folder, token) => request('/folders', { method: 'POST', body: JSON.stringify(folder) }, token)
export const updateFolder = (id, changes, token) => request(`/folders/${id}`, { method: 'PATCH', body: JSON.stringify(changes) }, token)
export const deleteFolder = (id, token) => request(`/folders/${id}`, { method: 'DELETE' }, token)
export const getAdminNotes = (token) => request('/admin/notes', {}, token)
export const updateNote = (id, changes, token) => request(`/notes/${id}`, { method: 'PATCH', body: JSON.stringify(changes) }, token)
export const deleteNote = (id, token) => request(`/notes/${id}`, { method: 'DELETE' }, token)
export const getAdminUsers = (token) => request('/admin/users', {}, token)
export const setUserBlocked = (id, blocked, token) => request(`/admin/users/${id}/block`, { method: 'PATCH', body: JSON.stringify({ blocked }) }, token)
export const setUserRole = (id, role, token) => request(`/admin/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }, token)
export const deleteAdminUser = (id, token) => request(`/admin/users/${id}`, { method: 'DELETE' }, token)
export const getExportUrl = (token) => `${API_URL}/admin/users/export?token=${encodeURIComponent(token)}`
