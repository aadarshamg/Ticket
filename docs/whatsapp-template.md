# WhatsApp message templates

Create these in **Meta Business Manager → WhatsApp Manager → Message templates**, or in your
WhatsApp panel if you send through one (see [Sending through WaSarathi](#sending-through-wasarathi)).
The app can only send a template after Meta has approved it, and the name, language and number of
variables must match exactly what is written here.

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

## Sending through WaSarathi

WaSarathi submits templates to Meta and sends them for you, so no Meta app, access token or
webhook is needed here.

1. In WaSarathi, open **Chatbot Manager → WhatsApp Bot → Automation → Message Templates**.
   - Under **Variables**, create ten custom variables: `BUYER`, `EVENT`, `DATE`, `STARTTIME`,
     `VENUECITY`, `PASSES`, `AMOUNT`, `ORDERID`, `ORGANISER`, `PASSCODE` (letters only).
   - Under **Templates**, choose **Create → Mixed Template** (the other forms only allow
     Marketing). Name `event_ticket`, category **Utility**, no header, and this body, which is
     the one above with WaSarathi's `#!NAME!#` variables in the same order:

     ```
     Dear #!BUYER!#, your entry pass has been generated for #!EVENT!# on #!DATE!#, #!STARTTIME!# (24-hour format), at #!VENUECITY!#.

     Number of passes: #!PASSES!#. Total amount: Rs #!AMOUNT!#. Order ID: #!ORDERID!#.

     Tap the button below to view your passes and show the QR code at the entry gate. Each pass admits one person, once. You can forward a pass to each person in your group from the pass page.

     Thank you, #!ORGANISER!#. See you at the event!
     ```

     WaSarathi only allows lower-case letters and underscores in the name (use `event_ticket`),
     and refuses a body that starts or ends with a variable, hence the closing words.
   - **Add button → Visit website** (not the quick-reply "Custom"), text `View Passes`, URL type
     **Dynamic**, URL `https://tickets.tspevents.in/b/#!PASSCODE!#` (your `PUBLIC_BASE_URL`
     followed by `/b/` and the PASSCODE variable).
   - Submit, and wait until it shows as approved.
2. Go to **API Developer → Generate API End-point**, choose **Send Template Message (GET)** and the
   approved template, and copy the link it generates. It contains your API token: treat it like a
   password.
3. On the server set `MESSAGE_SENDER=wasarathi`, `WASARATHI_TICKET_URL=<that link>` and
   `SEND_RATE_PER_SECOND=5`. Do the same for `event_reminder_v1` with `WASARATHI_REMINDER_URL` if you
   want reminders.
4. In **Admin → Send**, use **Send a test** to your own number before sending to buyers.

The link must have **ten** template variables: the nine in the text, then the button's (the app
puts the booking code there). If the numbers do not match, the test send says so and nothing goes out.

Delivered and read ticks are shown in WaSarathi, not in this dashboard: messages sent through
WaSarathi stay at **Sent** here.

## Notes

- These are **Utility** templates about a purchase the buyer made. Do not add offers or
  promotions to the text; Meta would reclassify it as Marketing, and the buyers' data is held
  only for pass delivery, reminders and entry.
- If you change the wording later, create a new template name (for example `event_ticket_v2`);
  the name is set in `apps/api/src/config/constants.ts`.
- The code that fills these variables is `apps/api/src/messaging/templates.ts`.
