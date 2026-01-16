# Scoring + Urgency Mapping (Alpha)

## What’s what

- **Score (0–100):** numeric urgency. Higher = more urgent.
- **Severity (Critical/High/Medium/Low):** UI bucket derived from score.
- **Confidence (high/medium/low):** how likely the alert is real (single shared concept across the app).

---

## Urgency mapping (score → severity)

Defined in `src/lib/urgency.ts`:

- **80–100** → Critical
- **60–79** → High
- **40–59** → Medium
- **0–39** → Low

---

## Alert scoring (how the score is computed)

### Notion: `notion_stale`

Score is based on:
- **How many stale pages** (count)
- **How stale the stalest page is** (max_stale_days)

Algorithm (in `src/lib/alertRegistry.ts`):
- start at **30**
- add points for count:
  - 1–4: +10
  - 5–9: +20
  - 10+: +30
- add points for max stale age:
  - 14–29d: +10
  - 30–44d: +20
  - 45+d: +30
- clamp to 0–100

Plain English: **more stale pages + older stale pages = higher urgency**.

---

### QuickBooks: `qbo_overdue_invoice` (per-invoice)

Score is based on:
- **How much money is outstanding** (balanceCents)
- **How late it is** (days overdue)

Algorithm (in `src/lib/alertRegistry.ts`):
- start at **40**
- add amount impact points:
  - ≥ $250k: +20
  - ≥ $100k: +15
  - ≥ $25k: +10
  - ≥ $5k: +6
  - > $0: +3
- add overdue points:
  - ≥ 30d: +20
  - ≥ 14d: +14
  - ≥ 7d: +10
  - ≥ 3d: +6
  - ≥ 1d: +3
- clamp to 0–100

Plain English: **bigger balance + more days overdue = higher urgency**.
