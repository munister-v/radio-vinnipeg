"""Self-hosted speech translation for live room audio."""
from __future__ import annotations

import os
import tempfile
import time
import threading
from pathlib import Path

from flask import Blueprint, jsonify, request

from .helpers import _client_ip, api_error, auth_required, rate_limit

translation_bp = Blueprint('translation', __name__, url_prefix='/api/translation')
_MODEL = None
_MODEL_LOCK = threading.Lock()
_TRANSCRIBE_LOCK = threading.Lock()

# ── Спільне розпізнавання на кімнату ─────────────────────────────────────────
# Кожен слухач писав свій шматок і слав його окремо, хоча всі чують ОДНЕ Й ТЕ
# САМЕ. Розпізнавання однопотокове, тож п'ятеро слухачів давали п'ятикратне
# навантаження на одне ядро, четверо з них ловили 429 і лишались без тексту.
# Тепер на кімнату працює один запит: перший, хто прийшов, стає ведучим і
# рахує, решта чекають його результат і отримують той самий рядок. Аудиторія
# коштує стільки ж процесора, скільки одна людина.
_ROOM_LOCK = threading.Lock()
_ROOM_JOBS: dict[str, dict] = {}
# Скільки готовий результат ще роздається тим, хто прийшов трохи пізніше.
# Дублі різних слухачів розходяться на частки секунди, але не більше.
_JOB_FRESH_S = 3.0
# Скільки відомий чекає на ведучого. Розпізнавання шестисекундного дубля на
# цій машині займає близько п'яти секунд; беремо з великим запасом.
_JOB_WAIT_S = 25.0
_MAX_BYTES = 2 * 1024 * 1024
_ALLOWED_TYPES = {'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.mp4', 'audio/wav': '.wav', 'audio/x-wav': '.wav'}


# Фрази, які модель видає на тиші й на шумі. Порівнюємо за нормалізованим
# виглядом, без розділових знаків і регістру.
_HALLUCINATIONS = {
    'thank you', 'thanks for watching', 'thank you for watching',
    'please subscribe', 'subscribe to my channel', 'bye', 'bye bye',
    'you', 'so', 'okay', 'oh', 'mm', 'mhm', 'uh', 'um',
    "i'm not going to say anything", 'i am not going to say anything',
    'silence', 'music', 'applause', 'no', 'yes',
    'subtitles by the amaraorg community', 'amaraorg',
}


def _is_hallucination(text: str) -> bool:
    flat = ''.join(ch for ch in text.lower() if ch.isalnum() or ch.isspace())
    flat = ' '.join(flat.split())
    if not flat:
        return True
    if flat in _HALLUCINATIONS:
        return True
    # Одне-два слова на шестисекундному дублі майже завжди сміття моделі.
    return len(flat) <= 3


def _get_model():
    global _MODEL
    if _MODEL is None:
        with _MODEL_LOCK:
            if _MODEL is None:
                from faster_whisper import WhisperModel
                _MODEL = WhisperModel(
                    os.getenv('WHISPER_MODEL', 'tiny'), device='cpu',
                    compute_type=os.getenv('WHISPER_COMPUTE_TYPE', 'int8'),
                    cpu_threads=max(1, int(os.getenv('WHISPER_CPU_THREADS', '1'))), num_workers=1,
                )
    return _MODEL


@translation_bp.get('/health')
def health():
    return jsonify({'ok': True, 'data': {'enabled': True, 'model': os.getenv('WHISPER_MODEL', 'tiny')}})


@translation_bp.post('/transcribe')
@auth_required
@rate_limit(24, 60, key_func=lambda: f'transcribe:{_client_ip()}')
def transcribe():
    if request.content_length and request.content_length > _MAX_BYTES:
        return api_error('Аудіофрагмент завеликий.', 413)
    suffix = _ALLOWED_TYPES.get((request.mimetype or '').lower())
    if not suffix:
        return api_error('Непідтримуваний формат аудіо.', 415)
    audio = request.get_data(cache=False, as_text=False)
    if not audio or len(audio) > _MAX_BYTES:
        return api_error('Порожній або завеликий аудіофрагмент.', 413)
    # Ключ спільної роботи - кімната ПЛЮС мовець. У розмові кількох людей
    # реплики різних людей розпізнаються паралельними запитами, і зводити їх
    # до одного ключа означало б, що репліку другого викине як дублікат
    # першого.
    room = (request.args.get('room') or '').strip()[:64]
    speaker = (request.args.get('speaker') or '').strip()[:32]
    if room and speaker:
        room = f'{room}#{speaker}'

    # Відомий: хтось уже рахує цю ж мову або щойно порахував.
    if room:
        with _ROOM_LOCK:
            now = time.time()
            # Кімнати й люди приходять і йдуть; без прибирання словник ріс би
            # весь час роботи сервісу.
            if len(_ROOM_JOBS) > 64:
                for k, v in list(_ROOM_JOBS.items()):
                    if v['event'].is_set() and now - v['done_at'] > 300:
                        _ROOM_JOBS.pop(k, None)
            job = _ROOM_JOBS.get(room)
            if job is not None and job['event'].is_set() and now - job['done_at'] > _JOB_FRESH_S:
                job = None
            if job is None:
                job = {'event': threading.Event(), 'text': '', 'lang': None, 'dur': 0.0,
                       'done_at': 0.0, 'error': None}
                _ROOM_JOBS[room] = job
                leader = True
            else:
                leader = False
        if not leader:
            job['event'].wait(_JOB_WAIT_S)
            if job['error']:
                return api_error(job['error'], 503)
            return jsonify({'ok': True, 'data': {
                'text': job['text'], 'language': job['lang'], 'duration': job['dur'], 'shared': True,
            }})
    else:
        job = None

    def _finish(text: str, lang, dur: float, error=None):
        if job is not None:
            job['text'], job['lang'], job['dur'] = text, lang, dur
            job['error'] = error
            job['done_at'] = time.time()
            job['event'].set()

    # Ведучий заходить у розпізнавання. Чекає на замок, а не відмовляє одразу:
    # відмовити тепер означає лишити без тексту всю кімнату, а не одного.
    if not _TRANSCRIBE_LOCK.acquire(timeout=_JOB_WAIT_S if room else 0):
        _finish('', None, 0.0, 'Розпізнавання зайняте. Спробуйте наступний фрагмент.')
        return api_error('Розпізнавання зайняте. Спробуйте наступний фрагмент.', 429)
    path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(prefix='whisper-', suffix=suffix, delete=False) as handle:
            handle.write(audio)
            path = Path(handle.name)
        # beam_size=5 замість жадібного пошуку. На коротких репліках це майже
        # безкоштовно: основний час з'їдає прохід енкодера, і він однаковий за
        # будь-якого beam. Заміряно на цьому ж сервері, 5.46с звуку, модель base:
        #   beam 1 - 4.13с (0.76x реального часу)
        #   beam 3 - 4.27с (0.78x)
        #   beam 5 - 4.27с (0.78x), речення розбите правильно, без збігу в кому
        # Тобто три відсотки часу за помітно чистіший текст.
        segments, info = _get_model().transcribe(
            str(path), task='translate',
            beam_size=int(os.getenv('WHISPER_BEAM', '5')), temperature=0,
            vad_filter=True, condition_on_previous_text=False,
            no_speech_threshold=0.5,
        )
        # Whisper на тиші вигадує текст: у порожній кімнаті модель видала
        # «I'm not going to say anything.» - це не помилка запису, а відома
        # властивість моделі. Відсіюємо двома ситами: власною оцінкою моделі
        # (no_speech_prob) і списком фраз, які вона повторює на порожньому
        # звуці. Пропустити тиху репліку не так шкідливо, як писати вигадку:
        # слухач не має способу відрізнити її від справжніх слів.
        kept = []
        for seg in segments:
            body = (seg.text or '').strip()
            if not body:
                continue
            if float(getattr(seg, 'no_speech_prob', 0.0) or 0.0) > 0.5:
                continue
            if _is_hallucination(body):
                continue
            kept.append(body)
        text = ' '.join(kept).strip()
        lang = getattr(info, 'language', None)
        dur = round(float(getattr(info, 'duration', 0) or 0), 2)
        _finish(text, lang, dur)
        return jsonify({'ok': True, 'data': {'text': text, 'language': lang, 'duration': dur, 'shared': False}})
    except Exception as exc:
        print(f'[translation] inference error: {exc}', flush=True)
        _finish('', None, 0.0, 'Розпізнавання тимчасово недоступне.')
        return api_error('Розпізнавання тимчасово недоступне.', 503)
    finally:
        if path:
            try: path.unlink(missing_ok=True)
            except OSError: pass
        _TRANSCRIBE_LOCK.release()
        # Страховка: якщо ведучий вилетів десь поза обробленими гілками,
        # відомі не мають висіти на ньому всі двадцять п'ять секунд.
        if job is not None and not job['event'].is_set():
            _finish('', None, 0.0, 'Розпізнавання тимчасово недоступне.')
