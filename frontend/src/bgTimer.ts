// Фоновий таймер на Web Worker.
//
// НАВІЩО: браузери жорстко дроселюють (а на заблокованому екрані — фактично
// заморожують) `setInterval` у головному потоці згорнутої вкладки. Через це
// опитування чату та WebRTC-сигналінг «залипають», і дзвінок/повідомлення не
// оновлюються, поки користувач не розблокує телефон.
//
// Таймери всередині Web Worker дроселюються значно слабше, тож опитування
// продовжує йти у фоні (особливо в Android-PWA). Якщо Worker недоступний —
// прозоро відкочуємось на звичайний setInterval.

export type BgTimer = { stop: () => void }

const workerSrc = `
  const timers = {};
  onmessage = (e) => {
    const { id, action, ms } = e.data;
    if (action === 'start') {
      timers[id] = setInterval(() => postMessage(id), ms);
    } else if (action === 'stop') {
      clearInterval(timers[id]);
      delete timers[id];
    }
  };
`

let worker: Worker | null = null
let workerFailed = false
let nextId = 1
const callbacks = new Map<number, () => void>()

function ensureWorker(): Worker | null {
  if (worker || workerFailed) return worker
  try {
    const url = URL.createObjectURL(new Blob([workerSrc], { type: 'application/javascript' }))
    worker = new Worker(url)
    worker.onmessage = (e: MessageEvent<number>) => {
      const cb = callbacks.get(e.data)
      if (cb) cb()
    }
    worker.onerror = () => { workerFailed = true }
  } catch {
    workerFailed = true
    worker = null
  }
  return worker
}

/** Як `setInterval`, але переживає згортання/блокування екрана. */
export function setBackgroundInterval(cb: () => void, ms: number): BgTimer {
  const w = ensureWorker()
  if (!w) {
    const handle = window.setInterval(cb, ms)
    return { stop: () => window.clearInterval(handle) }
  }
  const id = nextId++
  callbacks.set(id, cb)
  w.postMessage({ id, action: 'start', ms })
  return {
    stop: () => {
      callbacks.delete(id)
      w.postMessage({ id, action: 'stop' })
    },
  }
}
