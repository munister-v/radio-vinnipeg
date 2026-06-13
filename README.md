# Radio Vinnipeg 🎙

Відкрите радіо з **груповою голосовою розмовою наживо** та чатом для слухачів.
Заходити можна без реєстрації — кожен браузер отримує гостьовий нік.

- **Голосова розмова** — будь-хто приєднується до спільної кімнати. Слухати
  можна без мікрофона; мікрофон вмикається за бажанням (хто завгодно, коли
  завгодно). Технологія: mesh-WebRTC із perfect-negotiation.
- **Чат** — спільна кімната, повідомлення шифруються at-rest.
- **Дизайн** — світла тема в стилі bazilik-school.com.ua (базиліковий зелений,
  serif-заголовки, кнопки-пігулки).

Стек: **Flask** (Python) + **React/Vite/TypeScript**, база — SQLite.

---

## Локальна розробка

```bash
# 1) Бекенд (термінал A)
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
PORT=5050 .venv/bin/python -m flask --app backend.app run --port 5050
#   (фронтенд у dev проксіює /api на http://127.0.0.1:5050)

# 2) Фронтенд (термінал B)
cd frontend
npm install
npm run dev          # відкриє http://localhost:5173
```

Локально (один комп'ютер / одна мережа) дзвінок з'єднується і без TURN.

---

## Як працюють групові дзвінки

Кожен учасник з'єднується з кожним напряму (mesh). Сигналінг іде через
HTTP-опитування (`/api/calls/.../signals`), без WebSocket — це сумісно зі
звичайним gunicorn без додаткової інфраструктури.

Щоб з'єднання не «зривалось» при кількох учасниках:

- **Рівно один ініціатор на пару** — offer робить учасник із більшим `id`,
  інший лише відповідає. Це усуває зустрічні offer-и (glare) і подвійні m-line.
- **Perfect negotiation** через `setLocalDescription()` без аргументів — браузер
  сам формує offer/answer і робить rollback у «ввічливого» при колізії.
- **Самовідновлення** — peer, що впав (`failed`), прибирається й автоматично
  відтворюється при наступному опитуванні учасників.

### ⚠️ TURN — обов'язковий для різних мереж

Без TURN дзвінок працює лише коли учасники в WebRTC-дружніх мережах. Мобільний
інтернет, суворі фаєрволи та симетричний NAT вимагають ретрансляції. Постав
coturn на тому ж сервері **один раз**:

```bash
sudo bash deploy/install-coturn.sh
# встав надруковані MESSENGER_TURN_* у /opt/radio-vinnipeg/.env
sudo systemctl restart radio-vinnipeg
```

ICE-сервери віддаються фронтенду через `GET /api/calls/config` із `.env`
(`MESSENGER_TURN_URLS`, `MESSENGER_TURN_USERNAME`, `MESSENGER_TURN_CREDENTIAL`).

---

## Деплой (VPS, git-pull)

```bash
cd /opt/radio-vinnipeg && git pull
bash deploy/install-on-server.sh      # venv + npm build + systemd + nginx
sudo bash deploy/install-coturn.sh    # один раз, для TURN
```

Конфіги: `deploy/gunicorn.conf.py`, `deploy/radio-vinnipeg.service`,
`deploy/nginx-radio.conf`.

> При зміні схеми БД видали старий файл бази (`database/*.db`) перед рестартом —
> схема застосовується через `CREATE TABLE IF NOT EXISTS`.
