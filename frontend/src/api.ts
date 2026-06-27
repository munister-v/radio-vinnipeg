export type User = {
  id: number
  nickname: string
  color: string
  city?: string
}

export type Reaction = { emoji: string; count: number; reacted: boolean }

export type ReplyPreview = {
  id: number
  nickname: string
  color: string
  text: string
}

export type ChatMessage = {
  id: number
  user_id: number
  nickname: string
  color: string
  city?: string
  text: string
  is_deleted: boolean
  created_at: string
  reply_to_id: number | null
  reply_to: ReplyPreview | null
  edited_at: string | null
  reactions: Reaction[]
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

export type Room = {
  slug: string
  title: string
  in_call: number
  now_playing: { video_id: string; title: string; is_playing: boolean } | null
}

export async function fetchRooms() {
  return request<Room[]>('/rooms')
}

export async function fetchMessages(room = 'lounge') {
  return request<ChatMessage[]>(`/chat/messages?room=${room}`)
}

export async function clearRoomChat(room = 'lounge') {
  return request<void>(`/chat/messages?room=${room}`, { method: 'DELETE' })
}

export type Typer = { nickname: string; color: string }
export type ReactionUpdate = { message_id: number; reactions: Reaction[] }
export type PollResult = {
  messages: ChatMessage[]
  typing: Typer[]
  reaction_updates: ReactionUpdate[]
}

export async function pollMessages(afterId: number, room = 'lounge'): Promise<PollResult> {
  return request<PollResult>(`/chat/poll?after_id=${afterId}&room=${room}`)
}

export async function sendTyping(room = 'lounge'): Promise<void> {
  return request<void>(`/chat/typing?room=${room}`, { method: 'POST' })
}

export async function reactToMessage(msgId: number, emoji: string) {
  return request<{ message_id: number; reactions: Reaction[] }>(`/chat/messages/${msgId}/react`, {
    method: 'POST',
    body: JSON.stringify({ emoji }),
  })
}

export async function editMessage(msgId: number, text: string) {
  return request<{ id: number; text: string; edited_at: string }>(`/chat/messages/${msgId}`, {
    method: 'PUT',
    body: JSON.stringify({ text }),
  })
}

export async function sendMessage(text: string, replyToId?: number, room = 'lounge') {
  return request<ChatMessage>(`/chat/messages?room=${room}`, {
    method: 'POST',
    body: JSON.stringify({ text, reply_to_id: replyToId ?? null }),
  })
}

export async function deleteMessage(id: number) {
  return request<void>(`/chat/messages/${id}`, { method: 'DELETE' })
}

export async function fetchOnline() {
  return request<{ nickname: string; color: string }[]>('/chat/online')
}

// ── Розмова (груповий голосовий чат, mesh) ────────────────────────────────────

export type CallMember = {
  user_id: number
  nickname: string
  color: string
  mic_on: boolean
  joined_at: string
}

export type ActiveCall = {
  call_id: number
  created_at: string
  members: CallMember[]
  joined: boolean
} | null

export type CallSignal = {
  id: number
  from_user_id: number
  signal_type: 'offer' | 'answer' | 'ice' | 'bye'
  payload: string
  created_at: string
}

export async function getCallConfig() {
  return request<{ ice_servers: RTCIceServer[] }>('/calls/config')
}

export async function getActiveCall(room = 'lounge') {
  return request<ActiveCall>(`/calls/active?room=${room}`)
}

export async function joinCall(room = 'lounge') {
  return request<{ call_id: number; members: CallMember[]; latest_signal_id: number }>(`/calls/join?room=${room}`, { method: 'POST' })
}

export async function createRoom(title: string) {
  return request<Room>('/rooms', { method: 'POST', body: JSON.stringify({ title }) })
}

export type NowPlaying = {
  video_id: string; title: string; is_playing: boolean
  position_sec: number; server_time: number; updated_at: string
} | null

export async function getNowPlaying(room: string) {
  return request<NowPlaying>(`/rooms/${room}/now-playing`)
}

export async function setNowPlaying(room: string, data: {
  video_id?: string; title?: string; position_sec?: number; is_playing?: boolean
}) {
  return request<NowPlaying>(`/rooms/${room}/now-playing`, {
    method: 'PUT', body: JSON.stringify(data),
  })
}

export async function leaveCall(callId: number) {
  return request<void>(`/calls/${callId}/leave`, { method: 'PUT' })
}

export async function setCallMic(callId: number, on: boolean) {
  return request<void>(`/calls/${callId}/mic`, {
    method: 'PUT',
    body: JSON.stringify({ on }),
  })
}

export async function getCallMembers(callId: number) {
  return request<CallMember[]>(`/calls/${callId}/members`)
}

export async function sendCallSignal(
  callId: number,
  toUserId: number,
  signalType: 'offer' | 'answer' | 'ice' | 'bye',
  payload: unknown,
) {
  return request<void>(`/calls/${callId}/signals`, {
    method: 'POST',
    body: JSON.stringify({ to_user_id: toUserId, signal_type: signalType, payload }),
  })
}

export async function pollCallSignals(callId: number, afterId: number) {
  return request<CallSignal[]>(`/calls/${callId}/signals?after_id=${afterId}`)
}

export { ApiError }
