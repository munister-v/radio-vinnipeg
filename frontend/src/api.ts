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

export async function joinChat(nickname: string, password: string) {
  return request<{ token: string; user: User }>('/auth/join', {
    method: 'POST',
    body: JSON.stringify({ nickname, password }),
  })
}

export async function fetchMe() {
  return request<User>('/auth/me')
}

export async function logout() {
  return request<void>('/auth/logout', { method: 'POST' })
}

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

export { ApiError }
