"""Публічна стрічка true crime: читання без авторизації."""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..services import truecrime

truecrime_bp = Blueprint('truecrime', __name__, url_prefix='/api/truecrime')


@truecrime_bp.get('')
@truecrime_bp.get('/')
def list_items():
    truecrime.ensure_fresh()          # оновлення йде у фоні, відповідь не чекає
    kind = request.args.get('kind')
    try:
        limit = int(request.args.get('limit') or 24)
    except ValueError:
        limit = 24
    items = truecrime.get_items(limit=limit, kind=kind,
                                region=request.args.get('region'))
    return jsonify({'ok': True, 'data': {
        'items': items,
        'updated_at': truecrime.updated_at(),
        'sources': [{'slug': s, 'name': n, 'kind': k, 'region': r}
                    for s, n, k, r, _ in truecrime.FEEDS],
    }})
