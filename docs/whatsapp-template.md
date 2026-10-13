# WhatsApp message templates

Create these in **Meta Business Manager → WhatsApp Manager → Message templates**. The app can only
send a template after Meta has approved it, and the name, language and number of variables must
match exactly what is written here.

## 1. `event_ticket_v1` (required)

| Setting | Value |
|---|---|
| Name | `event_ticket_v1` |
| Category | Utility |
| Language | English (`en`) |
| Header | None |
| Footer | None |
| Buttons | One **Visit website** button (see below) |

### Body

Paste exactly:

```
Dear {{1}}, your entry pass has been generated for {{2}} on {{3}}, {{4}} (24-hour format), at {{5}}.

Number of passes: {{6}}. Total amount: Rs {{7}}. Order ID: {{8}}.

Tap the button below to view your passes and show the QR code at the entry gate. Each pass admits one person, once. You can forward a pass to each person in your group from the pass page.

Thank you, {{9}}.
```

### Variables

Meta asks for a sample value for each variable when you submit the template.

| Variable | Meaning | Sample value |
|---|---|---|
| `{{1}}` | Buyer's name | Asha Rao |
| `{{2}}` | Event name | Winter Music Night |
| `{{3}}` | Date with weekday | Saturday, 14 Nov 2026 |
| `{{4}}` | Start time, 24-hour | 18:00 |
| `{{5}}` | Venue, city | Palace Grounds, Bengaluru |
| `{{6}}` | Number of passes | 4 |
| `{{7}}` | Amount in rupees (`-` if the booking has no amount) | 3,196 |
| `{{8}}` | Order ID | ORD-1001 |
| `{{9}}` | Organiser name | Sangam Events |

### Button

| Setting | Value |
|---|---|
| Type | Visit website |
| Button text | `View Passes` |
| URL type | Dynamic |
| Website URL | `https://YOUR-DOMAIN/b/{{1}}` |
| Sample for `{{1}}` | `ABCDEFGH2345` |

Replace `YOUR-DOMAIN` with the site's real address, the same one set as `PUBLIC_BASE_URL`. The app
fills `{{1}}` with the booking's 12-character code, so the button opens `https://YOUR-DOMAIN/b/<code>`.

## 2. `event_reminder_v1` (optional)

Sent from Admin → Send to bookings that still have unused passes. Same settings and the same
button as above; only the body differs.

### Body

```
Hi {{1}}, this is a reminder for {{2}} on {{3}}, {{4}} (24-hour format), at {{5}}.

Gates open at {{6}}. Passes not yet used on your booking: {{7}}.

Tap the button below to view your passes and show the QR code at the entry gate. Each pass admits one person, once.

Thank you, {{8}}.
```

### Variables

| Variable | Meaning | Sample value |
|---|---|---|
| `{{1}}` | Buyer's name | Asha Rao |
| `{{2}}` | Event name | Winter Music Night |
| `{{3}}` | Date with weekday | Saturday, 14 Nov 2026 |
| `{{4}}` | Start time, 24-hour | 18:00 |
| `{{5}}` | Venue, city | Palace Grounds, Bengaluru |
| `{{6}}` | Gates-open time, 24-hour | 16:30 |
| `{{7}}` | Passes not yet used | 3 |
| `{{8}}` | Organiser name | Sangam Events |

## Notes

- These are **Utility** templates about a purchase the buyer made. Do not add offers or
  promotions to the text; Meta would reclassify it as Marketing, and the buyers' data is held
  only for pass delivery, reminders and entry.
- If you change the wording later, create a new template name (for example `event_ticket_v2`);
  the name is set in `apps/api/src/config/constants.ts`.
- The code that fills these variables is `apps/api/src/messaging/templates.ts`.
