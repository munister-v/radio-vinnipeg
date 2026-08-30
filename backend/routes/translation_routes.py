"""Self-hosted speech translation for live room audio."""
from __future__ import annotations

import os
import tempfile
import threading
from pathlib import Path

from flask import Blueprint, jsonify, request

from .helpers import _client_ip, api_error, auth_required, rate_limit

translation_bp = Blueprint('translation', __name__, url_prefix='/api/translation')
_MODEL = None
_MODEL_LOCK = threading.Lock()
_TRANSCRIBE_LOCK = threading.Lock()
_MAX_BYTES = 2 * 1024 * 1024
_ALLOWED_TYPES = {'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.mp4', 'audio/wav': '.wav', 'audio/x-wav': '.wav'}


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
    if not _TRANSCRIBE_LOCK.acquire(blocking=False):
        return api_error('Розпізнавання зайняте. Спробуйте наступний фрагмент.', 429)
    path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(prefix='whisper-', suffix=suffix, delete=False) as handle:
            handle.write(audio)
            path = Path(handle.name)
        segments, info = _get_model().transcribe(
            str(path), task='translate', beam_size=1, best_of=1, temperature=0,
            vad_filter=True, condition_on_previous_text=False,
        )
        text = ' '.join(s.text.strip() for s in segments if s.text.strip()).strip()
        return jsonify({'ok': True, 'data': {'text': text, 'language': getattr(info, 'language', None), 'duration': round(float(getattr(info, 'duration', 0) or 0), 2)}})
    except Exception as exc:
        print(f'[translation] inference error: {exc}', flush=True)
        return api_error('Розпізнавання тимчасово недоступне.', 503)
    finally:
        if path:
            try: path.unlink(missing_ok=True)
            except OSError: pass
        _TRANSCRIBE_LOCK.release()
