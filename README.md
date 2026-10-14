# Event E-Ticketing & WhatsApp Pass Delivery

One general-admission event, about 3,000 bookings. The organiser uploads a spreadsheet of
bookings; each booking gets a WhatsApp message linking to its passes; each pass has its own QR
code that admits one person, once.

What it does:

- **Organiser** (`/admin`): event settings and gates, spreadsheet upload with a row-by-row check,
  bookings table, WhatsApp sending in batches, live dashboard, CSV export, activity log.
- **Buyer** (`/b/{code}`): every pass in the booking, each with its own QR code and a button to
  forward it on WhatsApp. **Group member** (`/p/{code}`): just their pass. Both keep working
  offline once opened.
- **Gate volunteer** (`/scan`): phone-camera scanner with a full-screen green/red/amber result,
  admit-all for groups, manual lookup, and offline scanning that syncs later.

Contents: [Local setup](#local-setup) · [Uploading bookings](#uploading-bookings) ·
[Pass pages](#pass-pages-and-qr-codes) · [WhatsApp](#sending-passes-on-whatsapp) ·
[Gate scanner](#gate-scanner) · [Dashboard](#dashboard-export-and-activity-log) ·
[Data protection](#data-protection-dpdp-act-2023) ·
[Environment variables](#environment-variables) · [Security](#security) · [Testing](#testing) ·
[Deployment](#deployment) · [Event-day checklist](#event-day-checklist)

## Layout

- `apps/api` – Express + TypeScript API and WhatsApp send worker, Prisma schema and
  migrations, scripts (seed, create-admin, purge-data, loadtest, migrate), tests
- `apps/web` – Next.js (App Router) + Tailwind. The browser only talks to this app; it forwards
  `/api/*` to the API, so cookies stay first-party.
- `docs/whatsapp-template.md` – the WhatsApp template texts to submit to Meta
- `Dockerfile` + `deploy/start.mjs` – everything in one container (free hosting);
  `apps/*/Dockerfile` + `docker-compose.prod.yml` + `Caddyfile` – separate services

## Local setup

Requires Node.js 20 or newer, a Postgres database and Redis.

1. `npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL` and `DIRECT_URL` – from Supabase (**Connect → ORMs → Prisma**), or the local
     docker-compose URL shown in `.env.example` (`docker compose up -d`).
   - `REDIS_URL` – `redis://127.0.0.1:6379` (see [Redis](#redis)).
   - `QR_SECRET` and `SESSION_SECRET` – long random strings (command in `.env.example`).
3. `npm run db:deploy` – creates the tables (in the Postgres schema named by `DB_SCHEMA`).
4. `npm run seed` – demo event, two gates, an admin login and 3,000 fake bookings. The admin
   password and gate PINs are printed once.
5. `npm run dev` – Redis (if found in `.tools/redis`), web on http://localhost:3000 and API on
   http://localhost:4000.
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
| `npm run build` | Production builds of both apps |
| `npm run redis` | Start the local Redis from `.tools/redis` (Windows, no Docker) |
| `npm run worker` | Run the WhatsApp send worker on its own (with `RUN_WORKER=false` on the API) |
| `npm run loadtest` | Gate load test (demo data only) – see [Load test](#load-test) |
| `npm run purge-data` | Preview, then (`-- --confirm`) delete all booking data after the event |

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

### Scanning without a connection

Venue networks fail. The scanner is built to keep admitting people when they do.

**Before the gates open, each volunteer should open `/scan` once with a connection and sign in.**
That saves three things on the phone: the scanner page itself, the sign-in, and a list of every
valid pass. The scanner shows "Saved list: 9,268 valid passes, updated 18:02" and refreshes it
every two minutes while online. **Update list** refreshes it on demand.

Then, per scan:

1. The phone asks the server. With a normal connection this is the only step.
2. If there is no answer within 2.5 seconds, the phone checks the code against its saved list.
   A pass on the list is admitted at once (green, "Checked offline") and the entry is stored on
   the phone. A pass this phone already admitted is refused (red).
3. If the list cannot confirm the pass, the phone does not guess: it keeps waiting for the
   server, and only if no answer ever comes shows "Not valid" (not on the list) or "Cannot check".
4. Stored entries upload by themselves when the connection returns (checked every 15 seconds),
   and the list is refreshed. The scanner shows how many are still waiting.

A fully offline phone can reopen `/scan` and carry on without the PIN. **Find booking** and
**Admit all remaining** need a connection.

What makes this safe:

- **The list cannot be turned into passes.** It holds a short hash of each valid QR code, not
  the codes, pass IDs or any personal details. It is signed (ECDSA P-256) and the phone checks
  the signature when downloading and again every time it loads the list.
- **The server has the last word.** Uploaded entries carry the scanned QR text, and the server
  verifies each one itself. It never trusts the phone's verdict.
- **Nothing is counted twice.** Every scan has its own ID. If the server admits someone but its
  answer is lost on the way, the phone's later upload (or a rescan) carries the same ID and is
  recognised as the same entry.

The unavoidable limit: two gates that are both offline cannot know about each other. The same
pass shown at both will be admitted at both. Those cases, along with offline entries on a
cancelled booking or a code that was not a real pass, appear in **Admin → Conflicts** once the
phones upload. To keep them rare, keep phones online where possible; the list is at most two
minutes old when a connection drops.

Offline mode needs a production build (the service worker is not active under `npm run dev`).

## Dashboard, export and activity log

- **Admin → Overview** refreshes every 5 seconds: people entered and still to come, entries per
  gate with the time of the last one, bookings and passes, and WhatsApp messages by status.
- **Download CSV** (`GET /api/export.csv`) gives one row per booking: contact details, passes,
  passes used and remaining, booking status, message status and error, first and last entry time
  (IST) and the gates used. Cells that could be read as a spreadsheet formula are exported as
  text. Each download is recorded in the activity log, because the file contains every buyer's
  phone number.
- **Admin → Activity** shows the audit log: uploads, booking edits and cancellations, sends and
  resends, settings and gate changes, sign-ins, gate entries, exports. For booking edits it
  records which fields changed, not the old or new values.

## Data protection (DPDP Act 2023)

What is held, and why:

- Buyer name, phone, optional email, order ID, amount and category, taken from the organiser's
  spreadsheet. They are used only to deliver passes, send the optional reminder and control entry.
  The system sends no marketing messages and has no feature for it.
- Uploaded spreadsheets are parsed in memory and never stored. The checked rows are kept only
  until the upload is saved or for 24 hours, whichever comes first.
- Phone numbers are shown in full only to signed-in organisers. Pass pages show none, gate
  volunteers see a name, category and pass counts only, and server logs mask numbers.
- QR codes and the scanners' offline lists contain no personal data.

### Deleting the data: `npm run purge-data`

**Run this 30 days after the event ends.** Put a reminder in your calendar on event day.

```
npm run purge-data                       # preview: lists what would be deleted, changes nothing
npm run purge-data -- --confirm          # deletes, once 30 days have passed since the end time
npm run purge-data -- --confirm --force  # deletes now, even if the 30 days have not passed
```

It permanently deletes every booking, pass, WhatsApp message record, scan record and upload, and
strips identifying details (order IDs, email addresses typed at login) from the activity log.
Event settings, gates, admin logins and the outline of the activity log (what happened and when)
are kept. It runs as one transaction, records itself in the activity log with the counts, and
cannot be undone, so download the CSV first if you are required to keep a record.

Also delete, by hand: any CSV exports and spreadsheets on your own computers, and database
backups held by your hosting provider once their retention allows it.

## Environment variables

All configuration comes from the environment (`.env` locally; your host's settings in
production). Nothing secret is in the repository. `.env.example` lists every variable.

| Variable | Needed | What it is |
|---|---|---|
| `NODE_ENV` | production | `production` on the server. Turns on secure cookies and the start-up checks below. |
| `DATABASE_URL` | always | Postgres connection string. With a pooler (Supabase), the pooled one. |
| `DIRECT_URL` | with a pooler | Direct connection, used for migrations. Defaults to `DATABASE_URL`. |
| `DB_SCHEMA` | optional | Postgres schema for the tables. Default `ticketing`. |
| `REDIS_URL` | for sending | Redis for the WhatsApp send queue. Required in production. |
| `QR_SECRET` | always | Signs pass QR codes and the offline list. 32+ random characters. **Never change it after passes have been sent.** |
| `SESSION_SECRET` | always | Signs login sessions. 32+ random characters, different from `QR_SECRET`. Changing it signs everyone out. |
| `PUBLIC_BASE_URL` | always | The site's public address, e.g. `https://passes.example.com`. Used in pass links and must match the WhatsApp template's button URL. |
| `API_INTERNAL_URL` | web app | Where the web app reaches the API. Needed when the web app is **built** and when it runs. |
| `TRUST_PROXY` | production | How many proxies sit in front of the web app and add the visitor's address. Normally `1`. |
| `MESSAGE_SENDER` | optional | `mock` (default; logs only) or `cloud` (Meta WhatsApp Cloud API). |
| `WA_PHONE_NUMBER_ID`, `WA_ACCESS_TOKEN`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN` | for `cloud` | See [Test mode and real sending](#test-mode-and-real-sending). |
| `WA_GRAPH_VERSION` | optional | Graph API version, default `v23.0`. |
| `SEND_RATE_PER_SECOND` | optional | Messages per second, default 20. |
| `ADMIN_SESSION_HOURS`, `GATE_SESSION_HOURS` | optional | Sign-in lifetimes, default 12 and 16 hours. |

Generate a secret with:
`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

In production the API refuses to start, and says why, if `PUBLIC_BASE_URL` is not https, Redis is
missing, the two secrets are the same, or `MESSAGE_SENDER=cloud` without all four `WA_*` values.

## Security

- **Transport:** HTTPS only in production. The app sends HSTS, a Content-Security-Policy (no
  third-party scripts, no eval), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and
  `X-Robots-Tag: noindex`; `robots.txt` disallows everything.
- **Sessions:** signed, `HttpOnly`, `SameSite=Strict` cookies, `Secure` in production. Every admin
  and scanner write also needs a per-session CSRF token.
- **Passwords and PINs:** bcrypt. Failed admin logins, wrong gate PINs, scans (per device) and
  wrong pass links are all rate-limited. Failed attempts appear in the activity log.
- **Passes:** HMAC-signed QR codes, verified on the server. A check-in is a single conditional
  update, so one pass can never admit two people, even under simultaneous scans.
- **Least data:** volunteers see a name, category and pass counts. Pass pages show no phone
  numbers. The single-pass page shows nothing about the buyer or the rest of the booking.
- **Webhook:** every delivery report must carry Meta's `X-Hub-Signature-256`.
- **Inputs:** validated with zod; SQL goes through Prisma parameters; CSV export neutralises
  spreadsheet formulas.

Deployment rules that the security depends on:

- **Put a proxy that sets `X-Forwarded-For` in front of the web app** (Caddy, or the load balancer
  of Render/Railway). The rate limits identify visitors by that header. Never expose the web
  container's port directly to the internet.
- **Do not expose the API or Redis publicly.** Only the web app talks to the API.
- Use gate PINs of at least 6 digits, set them shortly before the event, and reset a gate's PIN
  if a phone is lost: that signs its volunteers out immediately.

## Testing

```
npm run typecheck           # both apps
npm run test:unit           # fast, no database
npm run test:integration    # against Postgres (schema <DB_SCHEMA>_test) and Redis
npm test                    # unit, then integration
```

Integration tests need `DATABASE_URL` and a running Redis. They create and empty their own
`_test` schema and never touch real bookings. Against a database on another continent the full
suite takes about 20 minutes; next to its database, a couple.

What is covered: phone normalisation, spreadsheet validation, code generation, QR signing;
upload → confirm → passes created; re-upload updates a booking; scan valid → used; scan twice →
already used; **concurrent scans of one pass → exactly one admitted**; admit-all; cancelled
bookings; webhook signature rejection; sending with retries and auto-pause; offline sync and
conflicts; stats, export, activity log and purge.

### Load test

`npm run loadtest` runs 50 scans a second for 2 minutes (6,000 different passes over 25 scanner
sessions, using autocannon) and passes if 95% of scans are answered in under 500 ms and every
scan is correct. It refuses to run unless every booking is demo data, and puts the passes back
afterwards.

```
npm run seed
npm run loadtest                                             # http://localhost:4000
npm run loadtest -- --url https://passes.example.com         # through the deployed site
npm run loadtest -- --rate 20 --duration 30                  # a lighter run
```

A successful scan is one database round trip, so the result depends almost entirely on how
close the API is to its database. **Run it against the deployed system before the event.**

**Result on the development machine** (October 2026; a Supabase database in Tokyo reached from
India, where a single database round trip takes about 800 ms): every one of the 1,589 scans
answered was correct, with no errors or timeouts, at 13 scans a second; p50 1.7 s, p95 3.4 s.
That does **not** meet the target, and cannot from there: one round trip alone takes longer than
500 ms. With the app and database in the same region a round trip takes 1–3 ms, so **run it again
after deploying.** On the same setup, making each successful scan a single database statement
(rather than two rounds of four queries) raised throughput from 3 to 13 scans a second and cut
the p95 from 9.4 s to 3.4 s.

## Deployment

The system is two services plus two databases:

| Piece | What it is | Reachable from the internet? |
|---|---|---|
| `web` | Next.js: admin, pass pages, scanner. Forwards `/api/*` to the API. | Yes, through HTTPS |
| `api` | Express API and the WhatsApp send worker | No. Only `web` calls it. |
| Postgres 15+ | Bookings, passes, logs | No |
| Redis 6.2+ | The send queue. Turn persistence (AOF) on. | No |

Host the API in the same region as its database: a scan makes two database round trips, and
distance between the two is what makes scans slow. Mumbai is ideal for an event in India
(Option C); Render and Railway have no India region, so use Singapore for both app and database.

There are two ways to package it, both built **from the repository root**:

```
# One container with everything (Option A)
docker build -t ticketing .

# Or two services (Options B and C)
docker build -f apps/api/Dockerfile -t ticketing-api .
docker build -f apps/web/Dockerfile --build-arg API_INTERNAL_URL=http://api:4000 -t ticketing-web .
```

Every container applies pending database migrations when it starts. For the two-service
setup, `API_INTERNAL_URL` must be given to the web image at build time (the `/api` forwarding
rule is fixed in the build) and again at run time (the pass pages read it).

> The Dockerfiles and `docker-compose.prod.yml` were written without Docker available on the
> development machine. What they run was checked directly instead: `npm ci`, the API's
> TypeScript build, the self-contained Next.js build, and the one-container start script
> (`deploy/start.mjs`), which was run in production mode in the same folder layout as the image
> (migrations, then the API, then the web app, all served from one port). The images themselves
> have not been built. Build once and open the site before relying on it.

### Option A (free): Render, one service, with Supabase Postgres

Everything runs in **one** container (the root `Dockerfile`: web app, API and send worker
together, started by `deploy/start.mjs`). Render's free plan allows 750 hours a month, which
covers one service running all month. Supabase's free plan holds the database.

**What "free" costs you:**

- The service **goes to sleep after 15 minutes without visitors**, and the next visitor waits
  about a minute while it wakes. While you prepare that is only an annoyance. For the event week,
  keep it awake with a free uptime monitor (for example UptimeRobot) opening
  `https://<your-app>.onrender.com/api/health` every 5 minutes, or switch this one service to a
  paid instance for that month only.
- **Free Redis keeps nothing when it restarts.** That is handled: when the app starts it puts any
  messages that were waiting back in the queue, and nothing is ever sent twice.
- **A free instance has very little processor power.** It is enough for preparing and sending,
  but **run the load test against it before the event** and upgrade for the day if it is slow.
- Render has no India region; use **Singapore** for both Render and Supabase.
- WhatsApp messages themselves are charged by Meta per message; no host can make that free.

Steps:

1. **Database.** In Supabase create a new project in *Southeast Asia (Singapore)*. Under
   **Connect → ORMs → Prisma**, copy `DATABASE_URL` and `DIRECT_URL` and put the database
   password in place of `[YOUR-PASSWORD]`.
2. **Redis.** In Render: **New → Key Value**, region *Singapore*, plan *Free*. Copy its
   **Internal Key Value URL**.
3. **The app.** **New → Web Service**, connect this GitHub repository. Language **Docker** (it
   finds the `Dockerfile` at the top of the repository), region *Singapore*, instance type
   **Free**, health check path `/api/health`. Environment variables:

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL`, `DIRECT_URL` | from Supabase |
   | `REDIS_URL` | the Internal Key Value URL |
   | `QR_SECRET`, `SESSION_SECRET` | two different long random values |
   | `PUBLIC_BASE_URL` | `https://<your-app>.onrender.com` (the address Render shows), or your own domain |
   | `TRUST_PROXY` | `1` |
   | `MESSAGE_SENDER` | `mock` to begin with; `cloud` plus the four `WA_*` values for real sending |

   Do not set `PORT`; Render provides it.
4. **Create your login,** from this repository on your own computer (it only needs the
   database). In PowerShell:

   ```
   $env:DATABASE_URL = "<the Supabase DATABASE_URL>"
   $env:DIRECT_URL = "<the Supabase DIRECT_URL>"
   npm run create-admin -- --email you@example.com --name "Your Name"
   ```

5. Open `https://<your-app>.onrender.com/admin` and sign in. The first visit after a pause takes
   about a minute.

The app applies database migrations each time it starts, and Render redeploys it on every push
to the main branch.

### Option B: Railway (web, API and Redis as separate services) with Supabase Postgres

Railway builds each service from its Dockerfile and provides HTTPS and a private network between
services. It has no India region; **Singapore** is the nearest, so create the database there too.

**Cost.** A new Railway account includes a one-time $5 credit; after that the Hobby plan is
$5 a month. This app (web, API and Redis running continuously) uses roughly that much, so for a
single event create the account shortly before sending the passes and delete the project
afterwards. Supabase's free plan is enough for the database, but it pauses a project after about
a week without use: open the admin dashboard now and then in the run-up.

1. **Database.** In Supabase create a new project in *Southeast Asia (Singapore)*. Under
   **Connect → ORMs → Prisma**, copy `DATABASE_URL` and `DIRECT_URL` and put the database
   password in place of `[YOUR-PASSWORD]`.
2. **Project.** In Railway: **New Project → Deploy from GitHub repo**, choose this repository,
   and pick the Singapore region. Rename the service it creates to `api`.
3. **Redis.** In the project: **Create → Database → Redis**. Leave it private.
4. **`api` service → Variables:**

   | Variable | Value |
   |---|---|
   | `RAILWAY_DOCKERFILE_PATH` | `apps/api/Dockerfile` |
   | `NODE_ENV` | `production` |
   | `PORT` | `4000` |
   | `DATABASE_URL`, `DIRECT_URL` | from Supabase |
   | `REDIS_URL` | `${{Redis.REDIS_URL}}` |
   | `QR_SECRET`, `SESSION_SECRET` | two different long random values |
   | `PUBLIC_BASE_URL` | the site's public https address (step 6) |
   | `TRUST_PROXY` | `1` |
   | `MESSAGE_SENDER` | `mock` to begin with; `cloud` plus the four `WA_*` values for real sending |

   Do **not** give this service a public domain. Leave its root directory as the repository root.
5. **`web` service.** **Create → GitHub Repo**, the same repository, named `web`. Variables:

   | Variable | Value |
   |---|---|
   | `RAILWAY_DOCKERFILE_PATH` | `apps/web/Dockerfile` |
   | `API_INTERNAL_URL` | `http://api.railway.internal:4000` (the `api` service's private address, shown under its Settings → Networking) |
   | `PORT` | `3000` |

6. **Address.** In `web` → Settings → Networking, **Generate Domain** (or add your own domain).
   Put that https address into `PUBLIC_BASE_URL` on the `api` service and redeploy `api`.
7. **Create your login.** With the [Railway CLI](https://docs.railway.com/cli) linked to the
   project, run this on your own computer in this repository. It uses the `api` service's
   variables to reach the database:
   `railway run --service api npm run create-admin -- --email you@example.com --name "Your Name"`

The API applies database migrations each time it starts. Railway redeploys both services on
every push to the main branch.

### Option C: AWS Lightsail, Mumbai (one server, managed Postgres)

1. **Database.** Lightsail → Databases → create **PostgreSQL** in *Mumbai (ap-south-1)*. Note
   the endpoint, user and password. Set both `DATABASE_URL` and `DIRECT_URL` to
   `postgresql://USER:PASSWORD@ENDPOINT:5432/postgres?sslmode=require`.
2. **Server.** Create a Lightsail instance in Mumbai (Ubuntu, 2 GB RAM or more), attach a
   static IP, and open ports 80 and 443 in its firewall. Install Docker
   (`curl -fsSL https://get.docker.com | sh`).
3. **Domain.** Point an A record (for example `passes.example.com`) at the static IP.
4. **Code and settings.** On the server: `git clone` this repository, `cp .env.example .env`,
   and fill in `DOMAIN`, `PUBLIC_BASE_URL=https://<domain>`, the database URLs, the two secrets
   and `MESSAGE_SENDER` with the `WA_*` values.
5. **Start.** `docker compose -f docker-compose.prod.yml up -d --build`. Caddy obtains the HTTPS
   certificate by itself within a minute.
6. **Create your login.**
   `docker compose -f docker-compose.prod.yml exec -e ADMIN_PASSWORD='choose-a-long-password' api node dist/scripts/create-admin.js --email you@example.com --name "Your Name"`
7. Sign in at `https://<domain>/admin`, fill in Settings and add the gates.

**Redis.** The compose file runs Redis next to the app with append-only persistence, which is
enough for one event. To use a managed Redis instead (AWS ElastiCache reached through Lightsail
VPC peering, or Upstash in Mumbai), set `REDIS_URL` in the `api` service and remove the `redis`
service.

To update: `git pull && docker compose -f docker-compose.prod.yml up -d --build`.

### After deploying, in this order

1. `https://<domain>/api/health` answers `{"ok":true,"db":true}`.
2. Sign in, fill in Settings, add gates with 6-digit PINs.
3. Register the WhatsApp webhook (see [Test mode and real sending](#test-mode-and-real-sending)).
4. Upload a small real file, send a **test message** to your own phone, open the pass link.
5. Open `/scan` on a phone, sign in with a gate PIN, scan that pass: green. Scan again: red.
6. Run the load test against a seeded copy, not against real bookings.

## Event-day checklist

**A few days before**

- [ ] The WhatsApp template is approved, and the button URL matches `PUBLIC_BASE_URL`.
- [ ] Event name, venue, times and helpline are correct in Settings (they go into every message).
- [ ] Upload the bookings; fix every invalid row; upload again until none are left.
- [ ] Send a **test message** to your team's numbers. Open the link, check the passes.

**Sending**

- [ ] Send to the **first 10** bookings. Wait until they show Delivered. Ask one or two buyers.
- [ ] Send to the **next 200**. Check the failure count; open Bookings → Failed for the reasons.
- [ ] Send **the rest**. If sending pauses itself, fix the cause before pressing Resume.
- [ ] Correct wrong phone numbers in Bookings and resend those.

**On the day, before the gates open**

- [ ] Set a fresh 6-digit PIN for each gate and give it only to that gate's volunteers.
- [ ] **At each gate, on each phone: open `/scan` with a connection, sign in, and check it shows
      "Saved list: N valid passes".** That is the offline list; without it a phone cannot scan
      if the network drops.
- [ ] Scan one test pass at each gate: green the first time, red the second.
- [ ] Phones charged, power banks available, screen brightness up.
- [ ] One organiser has the admin dashboard open on a laptop.

**While the gates are open**

- [ ] Watch Overview: people entered, per gate.
- [ ] A guest whose QR will not scan: **Find booking**, by order ID or last 4 phone digits.
- [ ] A phone showing "No connection" keeps working from its saved list. When the connection
      returns, check its "waiting to upload" count goes to zero.
- [ ] If a phone is lost, reset that gate's PIN in Settings.

**Afterwards**

- [ ] Check Admin → Conflicts once every phone has uploaded.
- [ ] Download the CSV if you need a record.
- [ ] Put a reminder in the calendar: **30 days after the event, run `npm run purge-data -- --confirm`.**

## Notes

- Tables live in the `ticketing` Postgres schema rather than `public`, because Supabase exposes
  `public` through its auto-generated Data API.
- Integration tests empty their tables before each test. They only ever run in a schema whose
  name ends in `_test`.
- Event times are stored as `timestamptz` and entered/shown in Asia/Kolkata.
- Gate PINs are stored as bcrypt hashes; they can be reset but not viewed.
- The Excel reader (`xlsx`) is installed from `cdn.sheetjs.com`; the copy on npm is an old
  release with known advisories. Docker builds therefore need to reach that host.
