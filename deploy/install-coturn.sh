#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# coturn (TURN/STUN) для групових дзвінків Radio Vinnipeg.
#
# НАВІЩО: WebRTC напряму (peer-to-peer) з'єднується лише в «дружніх» мережах.
# Мобільний інтернет, корпоративні фаєрволи та симетричний NAT блокують пряме
# з'єднання — і дзвінок «не працює». TURN-сервер ретранслює аудіо через себе,
# тож розмова з'єднується практично завжди.
#
# Запуск (на VPS, root):  sudo bash deploy/install-coturn.sh
# Після цього скрипт надрукує 3 рядки — встав їх у /opt/radio-vinnipeg/.env
# і перезапусти застосунок:  sudo systemctl restart radio-vinnipeg
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

REALM="${TURN_REALM:-radio.munister.com.ua}"
TURN_USER="${TURN_USER:-radio}"
# Сильний пароль, якщо не задано вручну.
TURN_PASS="${TURN_PASS:-$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 24)}"
# Діапазон портів для медіа-ретрансляції.
MIN_PORT="${TURN_MIN_PORT:-49152}"
MAX_PORT="${TURN_MAX_PORT:-65535}"

if [ "$(id -u)" -ne 0 ]; then
  echo "❌ Запусти з sudo/root." >&2
  exit 1
fi

echo "▶ Встановлюю coturn…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq coturn

# Зовнішня (публічна) IP-адреса сервера — потрібна coturn для коректних кандидатів.
EXT_IP="${TURN_EXTERNAL_IP:-$(curl -fsS --max-time 5 https://api.ipify.org || curl -fsS --max-time 5 https://ifconfig.me || hostname -I | awk '{print $1}')}"
echo "▶ Зовнішня IP: ${EXT_IP}"

echo "▶ Пишу /etc/turnserver.conf…"
cat > /etc/turnserver.conf <<EOF
# Згенеровано deploy/install-coturn.sh для Radio Vinnipeg
listening-port=3478
fingerprint
lt-cred-mech
user=${TURN_USER}:${TURN_PASS}
realm=${REALM}
external-ip=${EXT_IP}
min-port=${MIN_PORT}
max-port=${MAX_PORT}
# Безпека: лише ретрансляція, без доступу до приватних мереж.
no-cli
no-tlsv1
no-tlsv1_1
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
allowed-peer-ip=${EXT_IP}
stale-nonce=600
log-file=/var/log/turnserver.log
simple-log
EOF

# Увімкнути демон (Debian/Ubuntu пакет за замовчуванням «вимкнено»).
if [ -f /etc/default/coturn ]; then
  sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
  grep -q '^TURNSERVER_ENABLED=1' /etc/default/coturn || echo 'TURNSERVER_ENABLED=1' >> /etc/default/coturn
fi

# Відкрити порти у фаєрволі (якщо ufw активний).
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  echo "▶ Відкриваю порти у ufw…"
  ufw allow 3478/udp >/dev/null || true
  ufw allow 3478/tcp >/dev/null || true
  ufw allow "${MIN_PORT}:${MAX_PORT}/udp" >/dev/null || true
fi

echo "▶ Запускаю coturn…"
systemctl enable coturn >/dev/null 2>&1 || true
systemctl restart coturn
sleep 1
systemctl is-active --quiet coturn && echo "✅ coturn активний." || { echo "❌ coturn не стартував — дивись: journalctl -u coturn -n 50"; exit 1; }

cat <<EOF

════════════════════════════════════════════════════════════════════════════
✅ TURN готовий. Додай ці рядки у /opt/radio-vinnipeg/.env:

MESSENGER_TURN_URLS=turn:${EXT_IP}:3478?transport=udp,turn:${EXT_IP}:3478?transport=tcp
MESSENGER_TURN_USERNAME=${TURN_USER}
MESSENGER_TURN_CREDENTIAL=${TURN_PASS}

Потім перезапусти застосунок:
  sudo systemctl restart radio-vinnipeg

Перевірити TURN можна тут (встав URL/логін/пароль):
  https://icetest.info/  або  https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
════════════════════════════════════════════════════════════════════════════
EOF
