# Event E-Ticketing & WhatsApp Pass Delivery

One general-admission event, about 3,000 bookings. The organiser uploads a spreadsheet of
bookings; each booking gets a WhatsApp message linking to its passes; each pass has its own QR
code that admits one person, once.

> Build status: **Phase 5 of 8** (admin login, event settings, spreadsheet upload with preview,
> bookings table, signed QR passes, public pass pages, WhatsApp sending with queue and webhook,
> gate scanner). Deployment and the event-day checklist are documented in Phase 8.

## Layout

- `apps/api` – Express + TypeScript API, Prisma schema and migrations, tests
- `apps/web` – Next.js (App Router) + Tailwind. The browser only talks to this app; it forwards
  `/api/*` to the API, so cookies stay first-party.

## Local setup

Requires Node.js 20 or newer.

1. `npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL` and `DIRECT_URL` – from Supabase (**Connect → ORMs → Prisma**), or the local
     docker-compose URL shown in `.env.example` (`docker compose up -d`).
   - `QR_SECRET` and `SESSION_SECRET` – long random strings (command in `.env.example`).
3. `npm run db:deploy` – creates the tables (in the Postgres schema named by `DB_SCHEMA`).
4. `npm run seed` – demo event, two gates, an admin login and 3,000 fake bookings. The admin
   password and gate PINs are printed once.
5. `npm run dev` – web on http://localhost:3000, API on http://localhost:4000.
6. Sign in at http://localhost:3000/admin.

For a real event, skip the seed and create your login with
`npm run create-admin -- --email you@example.com --name "Your Name"`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Run web and API together |
| `npm test` | Unit tests, then integration tests |
| `npm run test:unit` | Unit tests only (no database needed) |
| `npm run test:integration` | API tests against the database, in the `<DB_SCHEMA>_test` schema |
| `npm run typecheck` | TypeScript check for both apps |
| `npm run db:deploy` | Apply migrations |
| `npm run db:migrate -- --name <change>` | Create a migration after editing `schema.prisma` |
| `npm run seed` | Load demo data (`-- --count=200` for fewer bookings) |
| `npm run create-admin -- --email …` | Create an organiser login or reset its password |

## Uploading bookings

Admin → **Upload** takes an `.xlsx`, `.xls` or `.csv` file (first sheet, first row = column names,
up to 5 MB / 10,000 rows). A sample is at `/sample-bookings.csv`.

| Column | Required | Rule |
|---|---|---|
| `order_id` | yes | Unique in the file. An order ID already in the database **updates** that booking. |
| `name` | yes | 2–80 characters |
| `phone` | yes | 10-digit Indian mobile, stored as `+91XXXXXXXXXX`; `+91`, `91`, `0` prefixes, spaces and dashes are accepted. Other countries must include `+` and the country code. |
| `passes` | yes | Whole number, 1 up to "max passes per booking" in Settings |
| `amount` | no | Number (INR) |
| `category` | no | Free text |
| `email` | no | Valid email |

1. **Check file** parses the file and shows every row as new, update, unchanged or invalid, with
   the exact reason (for example `Row 214: phone has 9 digits`). No booking is touched.
2. **Save** writes only the valid rows, creating bookings and their passes in one transaction.

Details worth knowing:

- The spreadsheet is parsed in memory and never written to disk.
- An optional column that is missing from the file leaves stored values alone; a column that is
  present but blank clears them.
- Reducing `passes` removes only unused passes. A row that would delete a used pass is refused.
- In Excel, format the phone column as **Text** if it contains international numbers, otherwise
  Excel drops the leading `+`. CSV files do not have this problem.
- The Excel reader (`xlsx`, SheetJS) is installed from `cdn.sheetjs.com` rather than npm, because
  the copy on npm is an old release with known security advisories.

## Pass pages and QR codes

- `/b/{code}` – the buyer's page: every pass in the booking as a swipeable card with its QR
  code, entry status, and a **Share this pass** button that opens WhatsApp with that pass's link.
- `/p/{code}` – one pass, for a group member. It shows no buyer details, no other passes and no
  link back to the booking; the API it reads from does not return them.
- Neither page needs a login. The 12-character code in the link is the credential, so treat
  links as secrets. Repeated wrong guesses from one address are rate-limited.
- In Admin → Bookings, **Passes** opens a booking's page.

QR codes contain `passId.signature`, where the signature is HMAC-SHA256 of the pass ID with
`QR_SECRET` (first 16 bytes, base64url). There is no order ID, name or phone number in the code,
and a QR that was not issued by this server fails verification. **Changing `QR_SECRET`
invalidates every QR code already sent**, so set it once before sending and keep it safe.

After the event's end time the pages show "Event over" and no QR codes.

### Offline

A service worker (`apps/web/public/sw.js`) saves each pass page the first time it is opened, so
it opens again with no signal at the venue. When online it always tries the network first (so
entry status is current) and falls back to the saved copy after 4 seconds. Saving is
best-effort: if the phone's storage is full or blocked the page still works online.

The service worker is only active in a production build (`npm run build -w apps/web`, then
`npm run start -w apps/web`), not under `npm run dev`. It also needs HTTPS (or `localhost`).

## Sending passes on WhatsApp

Admin → **Send** queues messages; a worker sends them at a steady pace and records what happened.

- **Send passes** – to bookings that have never been sent, optionally only the next *N* (oldest
  first). Use this to send in batches: 10 as a test, then 200, then the rest. A booking that was
  already sent is never sent again from here.
- **Resend failed** – retries every booking whose message failed.
- **Send / Resend** on a booking in Admin → Bookings – one booking, for example after fixing its
  phone number.
- **Test message** – sends the first booking's real message to your own numbers. The booking is
  not marked as sent.
- **Reminder** – `event_reminder_v1` to bookings that still have unused passes.
- **Pause / Resume**, with live progress.

How it behaves:

- About 20 messages per second (`SEND_RATE_PER_SECOND`).
- A temporary error (rate limit, outage, network) is retried up to 3 times, waiting 2 s, 4 s, 8 s.
  A permanent one (number not on WhatsApp, template problem) is not retried.
- If more than 10% of recent messages fail (after at least 10), sending **pauses itself**. The
  waiting messages stay queued; fix the cause and press Resume.
- Message status (sent → delivered → read, or failed with Meta's reason) comes back through the
  webhook and is shown in Bookings.

### Redis

The queue lives in Redis (`REDIS_URL`).

- With Docker: `docker compose up -d redis`.
- On Windows without Docker: download a portable build from
  <https://github.com/redis-windows/redis-windows/releases>, and put `redis-server.exe` and its
  `.dll` files in `.tools/redis/` (git-ignored). `npm run dev` then starts it automatically;
  `npm run redis` starts it on its own.

In production use a managed Redis with persistence enabled, so queued messages survive a restart.

### Test mode and real sending

`MESSAGE_SENDER=mock` (the default) only writes each message to the server log. Nothing reaches
WhatsApp, which makes it safe to try everything with demo data.

To send for real:

1. In Meta's WhatsApp Manager, create and get approval for the template in
   [docs/whatsapp-template.md](docs/whatsapp-template.md).
2. Set in `.env`:

   | Variable | Where to find it |
   |---|---|
   | `MESSAGE_SENDER=cloud` | – |
   | `WA_PHONE_NUMBER_ID` | Meta app → WhatsApp → API Setup → Phone number ID |
   | `WA_ACCESS_TOKEN` | A permanent System User token with `whatsapp_business_messaging` |
   | `WA_APP_SECRET` | Meta app → App settings → Basic → App secret |
   | `WA_VERIFY_TOKEN` | Any long random string you invent |
   | `WA_GRAPH_VERSION` | The API version shown in the Meta dashboard, e.g. `v23.0` |
   | `PUBLIC_BASE_URL` | The site's real https address; it must match the template's button URL |

3. Register the webhook (needs the site online with https): Meta app → WhatsApp → Configuration →
   Callback URL `https://YOUR-DOMAIN/api/whatsapp/webhook`, Verify token = `WA_VERIFY_TOKEN`, and
   subscribe to the **messages** field.
4. Use **Test message** first, then a small batch.

Every webhook POST must carry a valid `X-Hub-Signature-256` (HMAC-SHA256 of the body with
`WA_APP_SECRET`); anything else is rejected with 401.

To use a provider such as AiSensy or Interakt instead, implement the `MessageSender` interface
(`apps/api/src/messaging/types.ts`) and return it from `getSender()` in
`apps/api/src/messaging/index.ts`.

The worker runs inside the API process. To run it separately, set `RUN_WORKER=false` for the API
and start `npm run worker`.

## Gate scanner

Volunteers open `/scan` on their phone, enter their gate's PIN (set in Admin → Settings), allow
the camera, and point it at a pass. The whole screen shows the result:

| Screen | Meaning |
|---|---|
| Green **Admitted** | Name, category, "Pass 2 of 4 · 2 still to come". **Admit all remaining (N)** admits the rest of the group in one tap. |
| Red **Already used** | Time and gate of the first entry. Do not admit. |
| Red **Invalid pass** | Not a pass issued by this system (forged, altered, or some other QR code). |
| Amber **Cancelled** | The booking was cancelled. Do not admit. |

It returns to the camera after 3 seconds, with a beep and vibration per result. **Find booking**
admits by hand when a QR will not scan: search an exact order ID or the last 4 digits of the
buyer's phone, then **Admit 1** or **Admit all**.

How it is kept safe:

- The server verifies the QR signature; nothing on the phone decides who gets in.
- A check-in is one conditional database update (`... SET status='used' WHERE id=$1 AND
  status='valid'`). If two gates scan the same pass at the same instant, exactly one succeeds.
- Every attempt is stored in `Checkin` with gate, device and result, including invalid ones.
- Volunteers see only a name, category and pass counts: no phone number, email or order ID.
- A gate session ends when it expires (`GATE_SESSION_HOURS`, default 16), when the gate is
  switched off, or as soon as its PIN is reset.
- Wrong PINs and scans are rate-limited (scans per device, so a busy gate is not slowed by others).

The camera needs **https** (or `localhost`), so on real phones the site must be deployed.

## Notes

- Tables live in the `ticketing` Postgres schema rather than `public`, because Supabase exposes
  `public` through its auto-generated Data API.
- Integration tests empty their tables before each test. They only ever run in a schema whose
  name ends in `_test`.
- Event times are stored as `timestamptz` and entered/shown in Asia/Kolkata.
- Gate PINs are stored as bcrypt hashes; they can be reset but not viewed.
