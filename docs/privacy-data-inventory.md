# Personal Data Inventory & Record of Processing Activities (ROPA)

**Compliance Standard:** Digital Personal Data Protection Act 2023 (India)  
**Reference:** `docs/ARCHITECTURE.md` §23  

---

## 1. Tenancy & Roles Matrix

- **Restaurant Tenant (Organization):** **Data Fiduciary** — determines purpose and means of customer data processing (ordering, dining experience, loyalty).
- **Dineflow SaaS:** **Data Processor** — processes personal data strictly on behalf of the restaurant tenant pursuant to SaaS Master Services Agreement.
- **Diner / Guest / Staff:** **Data Principal** — individual to whom the personal data relates.

---

## 2. Personal Data Inventory

| Data Element | Category | Purpose | Legal Basis | Storage Location | Retention Period | Post-Retention Action |
|---|---|---|---|---|---|---|
| **Phone Number (`phone_e164`)** | Identity | OTP authentication, order status receipts, marketing (consent only) | Consent & Contractual necessity | `customers.phone_e164`, `consents.phone` | Active account lifetime | Pseudonymized via `+ANON-...` upon erasure |
| **Display Name** | Profile | Customer greeting, staff identification | Consent (optional) | `customers.display_name` | Active account lifetime | Erased / Nullified upon erasure |
| **Email Address** | Profile | E-receipts, account recovery | Consent (optional) | `customers.email` | Active account lifetime | Erased / Nullified upon erasure |
| **Order History & Invoices** | Financial / Tax | Fulfilling orders, calculating bill totals, GST invoice compliance | Legal obligation (CGST Act §36: 72 months) | `orders`, `order_items`, `invoices` | **72 months (6 years)** | Archival / Cold storage |
| **Loyalty Ledger** | Financial | Point accrual and wallet redemption | Contractual necessity | `loyalty_ledger` | 72 months | Archival / Zero-balance freeze |
| **Private Feedback & Ratings** | Quality | Service improvement, internal alerts for ratings $\le 3$ | Legitimate interest | `feedback` | 24 months | Disassociated from customer identity |
| **AI Menu Assistant Transcripts** | Operational | Menu recommendations, allergen clarification | Legitimate interest | `ai_chat_transcripts` | **90 days** | Automated purge via `runRetentionPurge` |
| **OTP Codes (`customer_otp_codes`)** | Authentication | Single-use phone verification | Contractual necessity | `customer_otp_codes` | **24 hours** | Automated purge via `runRetentionPurge` |
| **Webhook Inbox Events** | Operational | Payment idempotency & reconciliation | Contractual necessity | `webhook_inbox` | **30 days** | Automated purge via `runRetentionPurge` |

---

## 3. Data Subject Rights & Technical Endpoints

| DPDP Right | Description | Endpoint / Technical Mechanism |
|---|---|---|
| **Right to Access & Portability** | Download personal data archive in structured JSON | `POST /v1/me/privacy/export` |
| **Right to Correction** | Update name, email, or dining preferences | `PATCH /v1/me/profile` |
| **Right to Erasure** | Irreversibly redact PII while preserving legal invoice records | `POST /v1/me/privacy/delete` or `POST /v1/console/privacy/anonymize` |
| **Right to Withdraw Consent** | Revoke consent for marketing / WhatsApp notifications | Inbound `STOP` reply or consent toggle |
| **Right of Grievance Redressal** | Contact Data Protection Officer | Configured in tenant settings |

---

## 4. Cross-Border Transfers & Third-Party Processors

- **Hosting & Database:** AWS / GCP Region `ap-south-1` (Mumbai, India) — all primary databases, Redis caches, and backups reside strictly within Indian territory.
- **Payment Gateways:**
  - PhonePe (India — UPI payments)
  - Razorpay (India — Card / NetBanking payments)
- **AI Model Processing:** Google Gemini (Restricted to menu item text; diner PII like phone numbers and emails is **scrubbed client/server-side** via `redactPii` prior to transmission).
