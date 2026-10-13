# Event E-Ticketing & WhatsApp Pass Delivery

One general-admission event, about 3,000 bookings. The organiser uploads a spreadsheet of
bookings; each booking gets a WhatsApp message linking to its passes; each pass has its own QR
code that admits one person, once.

> Build status: **Phase 2 of 8** (admin login, event settings, spreadsheet upload with preview,
> bookings table). Deployment, Meta Cloud API setup and the event-day checklist are documented
> in Phase 8.

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

## Notes

- Tables live in the `ticketing` Postgres schema rather than `public`, because Supabase exposes
  `public` through its auto-generated Data API.
- Integration tests empty their tables before each test. They only ever run in a schema whose
  name ends in `_test`.
- Event times are stored as `timestamptz` and entered/shown in Asia/Kolkata.
- Gate PINs are stored as bcrypt hashes; they can be reset but not viewed.
