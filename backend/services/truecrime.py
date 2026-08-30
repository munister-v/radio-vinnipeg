"""Стрічка американського true crime, що оновлюється сама.

Джерела — публічні RSS/Atom: подкасти великих американських редакцій
(Dateline NBC, 48 Hours, Crime Junkie) і YouTube-канали (Law&Crime,
Court TV). Ми тягнемо лише метадані й посилання на оригінал: аудіо
лишається на серверах видавця, відео грає з YouTube.

Парсимо стандартною бібліотекою (xml.etree + urllib) — свідомо без
feedparser/requests, щоб не додавати залежностей до requirements.txt
і не ускладнювати деплой.

Оновлення: `ensure_fresh()` дивиться на вік кешу і, якщо він старший за
REFRESH_TTL, запускає оновлення у фоновому демон-потоці. Тобто перший
відвідувач після протухання кешу бачить старі дані миттєво, а наступний
уже свіжі. Ніякого cron і systemd-таймера не потрібно.
"""
from __future__ import annotations

import html
import re
import threading
import time
import urllib.error
import urllib.request
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree as ET

from ..database import get_connection


REFRESH_TTL = 30 * 60          # кеш живе 30 хвилин
FETCH_TIMEOUT = 20             # сек на одну стрічку
PER_FEED_LIMIT = 12            # скільки свіжих записів брати з кожного джерела
KEEP_ITEMS = 240               # скільки записів тримати в БД
USER_AGENT = 'WinnipegNights/1.0 (+https://radio.munister.com.ua)'

# slug, назва, вид медіа, регіон, URL стрічки.
# Регіон — щоб канадське можна було відфільтрувати окремо: станція з Вінніпега,
# і сусідські справи тут доречні не менше за американські.
FEEDS = (
    ('court-tv',     'Court TV',              'video', 'us',
     'https://www.youtube.com/feeds/videos.xml?channel_id=UCo5E9pEhK_9kWG7-5HHcyRg'),
    ('law-crime',    'Law&Crime',             'video', 'us',
     'https://www.youtube.com/feeds/videos.xml?channel_id=UCz8K1occVvDTYDfFo7N5EZw'),
    ('fifth-estate', 'The Fifth Estate',      'video', 'ca',
     'https://www.youtube.com/feeds/videos.xml?channel_id=UCa-bX3gZC3YnCThlGM5d38Q'),
    ('dateline',     'Dateline NBC',          'audio', 'us',
     'https://podcastfeeds.nbcnews.com/dateline-nbc'),
    ('48-hours',     '48 Hours',              'audio', 'us',
     'https://rss.art19.com/48-hours'),
    ('crime-junkie', 'Crime Junkie',          'audio', 'us',
     'https://feeds.simplecast.com/qm_9xx0g'),
    ('cbc-uncover',  'CBC Uncover',           'audio', 'ca',
     'https://www.cbc.ca/podcasting/includes/uncover.xml'),
    ('cbc-sks',      'Someone Knows Something', 'audio', 'ca',
     'https://www.cbc.ca/podcasting/includes/sks.xml'),
)

NS = {
    'atom':    'http://www.w3.org/2005/Atom',
    'media':   'http://search.yahoo.com/mrss/',
    'yt':      'http://www.youtube.com/xml/schemas/2015',
    'itunes':  'http://www.itunes.com/dtds/podcast-1.0.dtd',
    'content': 'http://purl.org/rss/1.0/modules/content/',
}

_TAG_RE = re.compile(r'<[^>]+>')
_WS_RE = re.compile(r'\s+')
_refresh_lock = threading.Lock()
_refreshing = False


# ── Утиліти ─────────────────────────────────────────────────────────────────

def _clean(text: str | None, limit: int = 320) -> str:
    """Знімає HTML-розмітку з опису й ріже до одного абзацу."""
    if not text:
        return ''
    plain = html.unescape(_TAG_RE.sub(' ', text))
    plain = _WS_RE.sub(' ', plain).strip()
    if len(plain) > limit:
        plain = plain[:limit].rsplit(' ', 1)[0] + '…'
    return plain


def _ts(raw: str | None) -> float:
    """RFC-822 (RSS) або ISO-8601 (Atom) -> epoch-секунди."""
    raw = (raw or '').strip()
    if not raw:
        return 0.0
    try:
        return parsedate_to_datetime(raw).timestamp()
    except (TypeError, ValueError):
        pass
    try:
        return __import__('datetime').datetime.fromisoformat(
            raw.replace('Z', '+00:00')).timestamp()
    except ValueError:
        return 0.0


def _fetch(url: str) -> bytes | None:
    req = urllib.request.Request(url, headers={
        'User-Agent': USER_AGENT,
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml',
    })
    try:
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
            return resp.read()
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
        return None


# ── Парсери ─────────────────────────────────────────────────────────────────

def _parse_youtube(root: ET.Element, slug: str, source: str, region: str) -> list[dict]:
    items: list[dict] = []
    for entry in root.findall('atom:entry', NS)[:PER_FEED_LIMIT]:
        vid = entry.findtext('yt:videoId', default='', namespaces=NS)
        if not vid:
            continue
        group = entry.find('media:group', NS)
        thumb = group.find('media:thumbnail', NS) if group is not None else None
        items.append({
            'guid': f'yt:{vid}',
            'source': source,
            'source_slug': slug,
            'media_kind': 'video',
            'region': region,
            'title': _clean(entry.findtext('atom:title', default='', namespaces=NS), 200),
            'summary': _clean(group.findtext('media:description', default='', namespaces=NS)
                              if group is not None else ''),
            'link': f'https://www.youtube.com/watch?v={vid}',
            'image': (thumb.get('url') if thumb is not None else None)
                     or f'https://i.ytimg.com/vi/{vid}/hqdefault.jpg',
            'media_url': None,
            'video_id': vid,
            'duration': None,
            'published_at': _ts(entry.findtext('atom:published', namespaces=NS)),
        })
    return items


def _parse_rss(root: ET.Element, slug: str, source: str, region: str) -> list[dict]:
    channel = root.find('channel')
    if channel is None:
        return []
    # Обкладинка шоу — запасний варіант для епізодів без власної картинки.
    show_img = None
    ch_itunes = channel.find('itunes:image', NS)
    if ch_itunes is not None:
        show_img = ch_itunes.get('href')
    if not show_img:
        show_img = channel.findtext('image/url')

    items: list[dict] = []
    for item in channel.findall('item')[:PER_FEED_LIMIT]:
        enclosure = item.find('enclosure')
        audio = enclosure.get('url') if enclosure is not None else None
        if not audio:
            continue
        guid = item.findtext('guid') or audio
        img_el = item.find('itunes:image', NS)
        items.append({
            'guid': f'{slug}:{guid.strip()}',
            'source': source,
            'source_slug': slug,
            'media_kind': 'audio',
            'region': region,
            'title': _clean(item.findtext('title'), 200),
            'summary': _clean(item.findtext('description')
                              or item.findtext('content:encoded', namespaces=NS)),
            'link': item.findtext('link'),
            'image': (img_el.get('href') if img_el is not None else None) or show_img,
            'media_url': audio,
            'video_id': None,
            'duration': (item.findtext('itunes:duration', namespaces=NS) or '').strip() or None,
            'published_at': _ts(item.findtext('pubDate')),
        })
    return items


def _parse(raw: bytes, slug: str, source: str, region: str) -> list[dict]:
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return []
    if root.tag.endswith('}feed'):        # Atom (YouTube)
        return _parse_youtube(root, slug, source, region)
    return _parse_rss(root, slug, source, region)


# ── Оновлення ───────────────────────────────────────────────────────────────

def refresh() -> int:
    """Тягне всі стрічки й записує нові елементи. Повертає їх кількість."""
    now = time.time()
    fetched: list[dict] = []
    for slug, source, _kind, region, url in FEEDS:
        raw = _fetch(url)
        if raw:
            fetched.extend(_parse(raw, slug, source, region))

    if not fetched:
        # Мережа лягла — не чіпаємо кеш, лише зсуваємо мітку, щоб не
        # довбати джерела на кожен запит.
        _set_state('truecrime_attempt_at', now)
        return 0

    with get_connection() as conn:
        for it in fetched:
            conn.execute(
                """INSERT INTO truecrime_items
                     (guid, source, source_slug, media_kind, region, title, summary, link,
                      image, media_url, video_id, duration, published_at, fetched_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT(guid) DO UPDATE SET
                     title=excluded.title, summary=excluded.summary,
                     image=excluded.image, link=excluded.link,
                     media_url=excluded.media_url, fetched_at=excluded.fetched_at""",
                (it['guid'], it['source'], it['source_slug'], it['media_kind'],
                 it['region'], it['title'], it['summary'], it['link'], it['image'],
                 it['media_url'], it['video_id'], it['duration'],
                 it['published_at'], now),
            )
        # Тримаємо лише свіжий хвіст.
        conn.execute(
            """DELETE FROM truecrime_items WHERE id NOT IN (
                   SELECT id FROM truecrime_items
                   ORDER BY published_at DESC LIMIT %s)""",
            (KEEP_ITEMS,),
        )
    _set_state('truecrime_updated_at', now)
    _set_state('truecrime_attempt_at', now)
    return len(fetched)


def _set_state(key: str, value: float) -> None:
    with get_connection() as conn:
        conn.execute(
            """INSERT INTO app_state (key, value, updated_at) VALUES (%s,%s,%s)
               ON CONFLICT(key) DO UPDATE SET value=excluded.value,
                                              updated_at=excluded.updated_at""",
            (key, str(value), time.time()),
        )


def _get_state(key: str) -> float:
    with get_connection() as conn:
        row = conn.execute('SELECT value FROM app_state WHERE key = %s', (key,)).fetchone()
    try:
        return float(row['value']) if row else 0.0
    except (TypeError, ValueError):
        return 0.0


def ensure_fresh(force: bool = False) -> None:
    """Якщо кеш протух — оновлює його у фоні, не блокуючи відповідь."""
    global _refreshing
    age = time.time() - _get_state('truecrime_attempt_at')
    if not force and age < REFRESH_TTL:
        return
    with _refresh_lock:
        if _refreshing:
            return
        _refreshing = True

    def worker() -> None:
        global _refreshing
        try:
            refresh()
        except Exception:      # noqa: BLE001 — фонова задача не має валити застосунок
            pass
        finally:
            _refreshing = False

    threading.Thread(target=worker, name='truecrime-refresh', daemon=True).start()


def get_items(limit: int = 24, kind: str | None = None,
              region: str | None = None) -> list[dict]:
    sql = 'SELECT * FROM truecrime_items'
    where: list[str] = []
    params: list = []
    if kind in ('audio', 'video'):
        where.append('media_kind = %s')
        params.append(kind)
    if region in ('us', 'ca'):
        where.append('region = %s')
        params.append(region)
    if where:
        sql += ' WHERE ' + ' AND '.join(where)
    sql += ' ORDER BY published_at DESC LIMIT %s'
    params.append(max(1, min(limit, 60)))
    with get_connection() as conn:
        return conn.execute(sql, tuple(params)).fetchall()


def updated_at() -> float:
    return _get_state('truecrime_updated_at')
