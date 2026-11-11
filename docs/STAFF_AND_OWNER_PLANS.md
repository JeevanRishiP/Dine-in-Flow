# Staff and Owner Web App Plans — DineFlow Consoles

This document contains the detailed screen-by-screen architectural and UI/UX plans for both the **Staff Web App** (tablet-first KDS and floor operations) and the **Owner Web App** (desktop/mobile business management and analytics).

---

# Part 1: Staff Web App Plan

Screen by screen, role-aware: a Captain, Kitchen staff, and Cashier log into the same app but see different views, driven by the permission matrix in `docs/ARCHITECTURE.md §12`.

---

## 1. How it opens

Tablet-first PWA, bookmarked/pinned on a dedicated tablet or POS screen at the counter or kitchen pass. **Login is mandatory here** — unlike the customer side, this is staff-only and handles money and kitchen operations.

### Login screen

- Restaurant logo & branding
- Outlet selector (only if staff belongs to multiple outlets)
- Email + password fields, or a **PIN pad** for shared tablets (4-6 digit PIN tied to a staff profile, faster for busy floor use — recommend PIN for CAPTAIN/KITCHEN/CASHIER, password + mandatory TOTP for OWNER/MANAGER)
- "Switch user" option if the tablet is shared across shifts — logs out current staff, shows a user picker grid (avatar + name), taps in PIN
- Idle auto-lock after a short period (e.g. 2 minutes of no touch) — shows the PIN pad again, doesn't fully log out

---

## 2. Persistent shell (present on every screen)

### Top bar

- **Left:** restaurant name/outlet name, current staff name + role badge (e.g. "Raj · Captain")
- **Center:** a **connection status dot** — green (live), amber (degraded, polling fallback active), red (offline) — this matters a lot on a kitchen floor where staff need to know if new orders are actually arriving live
- **Right:** notification bell (waiter calls + alerts), lock/logout icon, switch user

### Bottom nav bar (tab-based, role-filtered)

A KITCHEN login simply does not see tabs it has no permission for.
1. **Orders** (the main/home tab, live order board / KDS)
2. **Tables** (floor map and session management)
3. **Stock** (menu availability toggles)
4. **Calls** (waiter calls queue) — with a badge count for unacknowledged calls
5. **More** (payments/billing, staff, settings — grouped here if the role allows)

---

## 3. Screen 1 — Orders (Live Order Board / KDS) — Home Screen

This is what's open on the kitchen pass or the captain's tablet all shift.

### Layout: Kanban-style board with columns

Columns shown depend on role:
- **KITCHEN sees:** `New/Approval` → `Preparing` → `Ready`
- **CAPTAIN/CASHIER sees:** `New/Approval` → `Preparing` → `Ready` → `Served` (plus payment status)

Column headers show a live count badge (e.g. "Preparing (4)").

### Order card (one per order, shown in its current column)

- Table number, large and bold (most important info at a glance)
- Order number and time since placed (e.g. "Order #14 · 6 min ago" — time turns amber then red as it ages past configurable thresholds, so staff spot slow orders instantly)
- Item list with quantities (e.g. "2× Chicken Biryani, 1× Paneer Tikka")
- Any **per-item customisation/notes** shown inline, visually distinct (e.g. a small flag icon next to "1× Chicken Biryani — extra spicy, no onion")
- **Unverified order badge** if it came from an unverified guest without an open table session — shown as an amber banner on the card itself: "⚠️ Needs approval"
- Payment status chip (Unpaid / Pending / Paid) — small, color-coded
- Primary action button at the bottom of the card, changes by column:
  - New/Approval column: **"Approve"** and **"Reject"** buttons side by side (reject requires a reason, short picker: "Kitchen closed item / Suspicious / Customer cancelled / Other")
  - Preparing column: **"Mark Ready"**
  - Ready column: **"Mark Served"**
- Tapping the card body (not the button) expands it to show full details, special instructions for the whole order, and a history log (who approved, when each item changed status)

### New order alert

- Audible chime/vibration when a new order lands in New/Approval
- Chime **repeats every N seconds until acknowledged** by tapping the card once (hard requirement — staff must not miss new orders in a loud kitchen)
- Subtle pulse/glow animation on new cards until acked

### Filters & sort

- Filter by table range or "My tables" (if captains are assigned specific tables)
- Sort by oldest first (default) or table number

### Degraded mode banner

- If realtime connection drops: a thin banner *"Live updates paused — refreshing every 10s"* appears at the top of the board, board keeps working via polling, nothing is lost

---

## 4. Screen 2 — Tables

A visual floor map, or a simple grid list if the restaurant hasn't set up a floor layout.

### Floor map view

- Each table shown as a tile/icon, positioned to match the restaurant's actual layout (owner/manager sets this up in settings — drag-and-drop layout editor)
- Table tile shows: table number, session state color (grey = no session / green = open session / amber = pending approval order waiting / blue = bill requested), and active order count badge

### Grid/list view (fallback, no layout set up)

- Simple list: Table number, status, active orders, session duration

### Table detail sheet (on tap)

- Session status: "No active session" or "Session open since 7:42 PM"
- **"Seat Table" / "Open Session" button** — the staff-initiated session open (per verification flow). Key button for `VERIFIED_PAY_LATER`
- If a code-based session: shows current rotating table code (large, so staff can read it to a guest) with refresh icon
- List of all orders currently tied to this session
- **"Close Session" button** — available once all orders are paid/settled; prompts confirmation if anything is still unpaid
- **"Request Bill" indicator** if guest tapped "Request Bill" from customer app — shown as flashing banner and reflected on floor map tile

---

## 5. Screen 3 — Stock / Menu Availability

Simple, touched constantly through a shift.

### Layout

List of items grouped by category (same categories as customer menu), with search bar at top to jump to an item quickly.

### Item row

- Item name + thumbnail
- **Availability toggle** — Available / Out of Stock
- If "Out of Stock" toggled: prompts "Mark back as available at a specific time?" (quick presets: 1 hour, rest of day, or manual)
- Optional stock count field if owner enabled count tracking (e.g. "12 left") — editable inline, decrements automatically as orders are placed

### Bulk actions

- "Mark all in [category] unavailable" — useful when a section of the kitchen shuts down early
- Changes reflect on customer menu within seconds (tied to `menu_versions` cache-busting)

---

## 6. Screen 4 — Waiter Calls

### Layout

Simple queue, newest or most urgent first.

### Call card

- Table number (large)
- Time since call made (color ages like order cards)
- Reason if guest selected one ("Water", "Assistance", "Bill", or generic "Call waiter")
- **"Acknowledge" button** — marks seen, moves to handled state
- **"Resolve / Done" button** — clears call
- Same chime/vibrate pattern as new orders

---

## 7. Screen 5 — Payments / Billing (under "More" or tab for CASHIER)

### "Collect Payment" view

- Order summary with itemized total, taxes, discounts applied
- Payment method buttons: **UPI (Gateway)**, **Direct UPI (Staff Confirmed)**, **Cash**, **Card (Terminal)**
- If Direct UPI or Cash/Card: **"Mark Paid"** button, requires entering amount received (pre-filled with total, editable for cash with change calculation) and logged with staff member name and timestamp (audit trail)
- If Gateway UPI: QR code or "Send payment link" option, live status indicator waiting for webhook confirmation ("Waiting for payment..." → "Paid ✅" automatically)
- **Split bill option** — split evenly or by item, generates sub-bills
- **Refund button** (OWNER/MANAGER permission only) — reason field, partial or full amount, confirmation step

### Daily cash reconciliation view (CASHIER end of shift)

- Total cash collected per system vs counted hand-in, flags mismatches

---

## 8. Screen 6 — Staff Management (OWNER/MANAGER only, under "More")

- List of staff with roles, PIN reset button, active/inactive toggle
- "Add staff" — name, role, PIN or password setup
- Shift/session activity log — who's logged in, since when

---

## 9. Screen 7 — Settings (Role-gated)

- Outlet details, verification mode selector (Pay-first / Verified pay-later / Hybrid)
- Floor layout editor (drag-and-drop table positions)
- Table code settings (digit length, rotation interval)
- Printer/KOT settings (browser print styles / bridge)
- Notification sound preferences

---

## 10. Key interaction principles

1. **Big touch targets everywhere.** Minimum 44px for busy floors.
2. **Color coding is load-bearing.** Age-based coloring on orders and calls enables instant triage.
3. **Sound is mandatory for new orders and calls**, with repeat-until-acked behavior.
4. **No confirmation dialog for routine actions** (Mark Ready, Mark Served). Reserve confirmations for destructive/financial actions (Reject order, Refund, Close session with unpaid orders).
5. **Degraded/polling mode fallback.** Uninterrupted operations even if WebSocket disconnects.

---
---

# Part 2: Owner Web App Plan

Analytics, configuration, and business-management surface. Used in shorter sessions from phone, laptop, or tablet with focus on clarity of numbers, drill-down transparency, and control.

---

## 1. How it opens

Standard web login: email + password + mandatory TOTP MFA. Responsive across desktop, tablet, and phone.

**Outlet switcher:** Top dropdown switches context between outlets or views "All outlets" combined. Affects every screen.

---

## 2. Persistent shell

### Top bar

- Restaurant/brand name + outlet switcher dropdown
- **Date range picker** (Today / Yesterday / This week / This month / Custom) — persists across navigation
- Notification bell (low-rating alerts, unusual activity alerts, pending approvals)
- Profile/account menu (right)

### Side nav (desktop) / bottom nav or hamburger (mobile)

1. **Dashboard** (Home)
2. **Orders**
3. **Menu**
4. **Tables**
5. **Payments & Invoices**
6. **Loyalty & Coupons**
7. **Feedback & Reviews**
8. **Staff**
9. **Settings**

---

## 3. Screen 1 — Dashboard (Home)

Answers "how is the business doing right now" at a glance, with full drill-down.

### Top row — headline metric cards

- Revenue
- Orders
- Average Order Value (AOV)
- Tips collected
- Discounts given (displayed as a cost)

Each card: large number, sparkline, "+12% vs last week" comparison text, colored green/red by direction.

### Second row — Today's live snapshot

- Orders currently in progress (New / Preparing / Ready counts)
- Tables currently occupied (e.g. "8 of 14 tables active")
- Unresolved waiter calls or low-rating alerts with actionable "View" links

### Revenue chart

- Line/bar chart of revenue over selected period, toggleable to Orders count or AOV
- Hourly breakdown toggle for single-day views (peak hours for staffing)

### Top items / Bottom items

- Top 5 best-selling items (quantity or revenue toggle)
- Bottom 5 slowest-moving items (for menu pruning)

### Payment mix donut/bar

- UPI / Card / Cash / Direct UPI breakdown, with gateway fees shown separately (gross vs net)

### Quick links & alerts panel

- Low rating review links
- Stale out-of-stock items warning
- Expiring coupons alert

---

## 4. Screen 2 — Orders

Searchable, filterable order history and live details.

### Filters bar

- Date range (inherits from top bar, overridable)
- Status filter (All / Completed / Cancelled / Refunded)
- Payment method filter
- Table/outlet filter
- Search by order number or customer phone (last 4 digits shown, privacy-first masking)

### Order table

- Columns: Order #, Table, Time, Items count, Total, Payment method, Status, Customer name/guest
- Clicking row expands full order detail: itemized list, modifiers, notes, state timeline (placed → accepted → preparing → ready → served → paid), approved by, refund history

### Export button

- Asynchronous CSV/XLSX export with signed link generation

---

## 5. Screen 3 — Menu

Full menu management tool.

### Category manager

- Drag-to-reorder list of categories
- Add / edit / delete category with multi-language name support

### Item editor

- Name (+ translations), description, price, tax class
- Veg / Non-veg / Egg / Vegan selector
- Allergen tags (multi-select)
- Spice level, prep time estimate
- Photo/video upload with preview
- Modifier groups builder (e.g. "Size", required/optional, min/max, price deltas)
- Cuisine tags ("North Indian", "South Indian", "Healthy") matching customer filter categories
- Bulk actions: bulk price update (+X%), bulk activate/deactivate

### Menu preview button

- Live preview modal showing customer app view

---

## 6. Screen 4 — Tables

- List/grid of tables with QR status (active, needs reprint if token version bumped)
- **"Generate QR Sheet" button** — printable PDF layout with all table QR codes sized for table-tents
- Floor layout editor (drag-and-drop table positions)
- Table verification mode setting per table or outlet (Pay-first / Verified pay-later / Hybrid)
- Table code settings: digit length, rotation interval

---

## 7. Screen 5 — Payments & Invoices

### Payments tab

- Transaction list: date, order #, method, amount, fee, net, settlement status
- Reconciliation summary: gross collected, gateway fees paid, net settled, flagged mismatches
- Refund list with reasons and authorizer

### Invoices tab

- GST invoices list, searchable by invoice number or date
- Download / print individual GST invoices
- GSTIN and tax configuration (rate per category, inclusive/exclusive toggle)

---

## 8. Screen 6 — Loyalty & Coupons

### Coupons sub-section

- List of coupons: code, type (% or flat), value, validity, audience (All / Signed-in / New / Returning), usage count vs limit
- "Create Coupon" form
- Performance metrics: redemptions, discount cost, revenue influenced

### Referral program sub-section

- Configurable referrer and referee reward caps (e.g. ₹500 wallet / ₹100 discount)
- Referral activity: pending, qualified, rewarded counts
- Fraud-review queue

### Wallet / Store Credit sub-section

- Ledger-level view: total credit liability, expiring-soon amounts, top customer balances

---

## 9. Screen 7 — Feedback & Reviews

### Private feedback tab

- Customer feedback: rating (1-5), tags, comment, date, order link
- Low-rating filter (1-3 stars)
- "Mark resolved" + internal note field for service recovery

### Google Reviews tab

- Connection status to Google Business Profile (OAuth token)
- Review feed via API: rating, text, date, reply status
- Reply box under each review posting back via API
- Rating trend chart over time
- **CRITICAL COMPLIANCE RULE:** Absolutely NO reward or discount controls conditional on public Google reviews.

---

## 10. Screen 8 — Staff

- Staff list with role, status, last login
- Add/edit staff, assign role (OWNER / MANAGER / CAPTAIN / KITCHEN / CASHIER), reset PIN/password, deactivate
- Audit log viewer (OWNER only) — filterable by staff member and action type (refunds, voids, stock changes, menu edits)

---

## 11. Screen 9 — Settings

- Outlet profile: name, address, GSTIN, timezone, branding
- Payment gateway configuration (API keys, linked accounts)
- WhatsApp / messaging templates & monthly budget caps
- Data & privacy: data retention settings, pending DSR (export / erasure) queue
- DineFlow subscription / billing details
- Notification preferences (email / WhatsApp / in-app)

---

## 12. Key design principles for Owner App

1. **Numbers first, navigation second.** Answers "how am I doing" before clicking anything.
2. **Every financial number is explainable.** Drill-down to source transactions.
3. **Comparisons everywhere.** "vs last week/month" on every metric card.
4. **Compliance control panel.** Tax configuration, data retention, and Google review guardrails.
5. **Desktop-first layouts, mobile-usable.** Dense tables and charts reflow cleanly on phones.
