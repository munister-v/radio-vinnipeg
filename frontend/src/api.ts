export type User = {
  id: number
  nickname: string
  color: string
}

export type ChatMessage = {
  id: number
  user_id: number
  nickname: string
  color: string
  text: string
  is_deleted: boolean
  created_at: string
}

const TOKEN_KEY = 'vinnipeg_token'
const USER_KEY = 'vinnipeg_user'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function getStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as User
  } catch {
    return null
  }
}

export function saveSession(token: string, user: User) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function saveUser(user: User) {
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

class ApiError extends Error {}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`/api${path}`, { ...options, headers })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.ok === false) {
    throw new ApiError(body.error || `Помилка запиту (${res.status})`)
  }
  return body.data as T
}

// ── Auth (гостьовий доступ, без пароля) ──────────────────────────────────────

export async function guestJoin(nickname?: string) {
  return request<{ token: string; user: User }>('/auth/guest', {
    method: 'POST',
    body: JSON.stringify(nickname ? { nickname } : {}),
  })
}

export async function fetchMe() {
  return request<User>('/auth/me')
}

export async function renameMe(nickname: string) {
  return request<User>('/auth/me', {
    method: 'PUT',
    body: JSON.stringify({ nickname }),
  })
}

export async function logout() {
  return request<void>('/auth/logout', { method: 'POST' })
}

// ── Chat ─────────────────────────────────────────────────────────────────────

export async function fetchMessages() {
  return request<ChatMessage[]>('/chat/messages')
}

export async function pollMessages(afterId: number) {
  return request<ChatMessage[]>(`/chat/poll?after_id=${afterId}`)
}

export async function sendMessage(text: string) {
  return request<ChatMessage>('/chat/messages', {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

export async function deleteMessage(id: number) {
  return request<void>(`/chat/messages/${id}`, { method: 'DELETE' })
}

export async function fetchOnline() {
  return request<{ nickname: string; color: string }[]>('/chat/online')
}

// ── Broadcast (живий ефір) ───────────────────────────────────────────────────

export type LiveBroadcast = {
  broadcast_id: number
  title: string
  host_user_id: number
  host_nickname: string
  host_color: string
  started_at: string
  listener_count: number
  is_host: boolean
  is_listening: boolean
} | null

export type BroadcastListener = {
  user_id: number
  nickname: string
  color: string
  joined_at: string
}

export type BroadcastSignal = {
  id: number
  from_user_id: number
  signal_type: 'offer' | 'answer' | 'ice' | 'bye'
  payload: string
  created_at: string
}

export async function getBroadcastConfig() {
  return request<{ ice_servers: RTCIceServer[] }>('/broadcasts/config')
}

export async function getLiveBroadcast() {
  return request<LiveBroadcast>('/broadcasts/live')
}

export async function startBroadcast(title: string) {
  return request<{ broadcast_id: number }>('/broadcasts/start', {
    method: 'POST',
    body: JSON.stringify({ title }),
  })
}

export async function stopBroadcast(broadcastId: number) {
  return request<void>(`/broadcasts/${broadcastId}/stop`, { method: 'PUT' })
}

export async function listenBroadcast(broadcastId: number) {
  return request<{ host_user_id: number }>(`/broadcasts/${broadcastId}/listen`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function leaveBroadcast(broadcastId: number) {
  return request<void>(`/broadcasts/${broadcastId}/leave`, { method: 'PUT' })
}

export async function getBroadcastListeners(broadcastId: number) {
  return request<BroadcastListener[]>(`/broadcasts/${broadcastId}/listeners`)
}

export async function sendBroadcastSignal(
  broadcastId: number,
  toUserId: number,
  signalType: 'offer' | 'answer' | 'ice' | 'bye',
  payload: unknown,
) {
  return request<void>(`/broadcasts/${broadcastId}/signals`, {
    method: 'POST',
    body: JSON.stringify({ to_user_id: toUserId, signal_type: signalType, payload }),
  })
}

export async function pollBroadcastSignals(broadcastId: number, afterId: number) {
  return request<BroadcastSignal[]>(`/broadcasts/${broadcastId}/signals?after_id=${afterId}`)
}

export { ApiError }
