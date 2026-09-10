# 5. Data ownership matrix

| Layer | Read | Write | Worker | Cross-tenant |
|-------|------|-------|--------|--------------|
| Business KB | members (RLS); service-role + `accountId` | admin+ ingest | `knowledge-scrape` | Forbidden |
| Customer memory | members; AI loaders with `accountId` + `contactId` | memory cron / shopping merge | `/api/ai/memory/cron` | Forbidden |
| Conversation / messages | members via parent RLS | webhook / send paths | n/a | Forbidden |
| Catalog | members; tools with `accountId` | catalog sync / Shopify | `catalog-embed`, `catalog-meta-sync` | Forbidden |
| Outcomes (orders, paid labels, product events) | members | commerce + analytics writers | Shopify / WA webhooks | Forbidden |
| Future sales events / patterns | members (admin+ mutate) | analyzer worker only | future BullMQ queue | Forbidden — `account_id` NOT NULL, no global table |
| Platform AI keys / model | super-admin | super-admin | n/a | Shared **runtime**, not tenant data |

## Data ≠ knowledge ≠ learning

- **Raw data** stays in messages / orders / events.
- **Business knowledge** stays in the existing KB.
- **Customer memory** stays per contact.
- **Learned intelligence** (future) is structured, tenant-scoped, and
  minimal — not a dump of the transcript.
- **AI context** is selected for the current turn and discarded.

## Who can never write intelligence

Dashboard agents must not invent sales patterns by hand in Phase 1–4.
Pattern writes belong to the future analyzer after evaluation. Humans
may later deactivate a pattern (Phase 4 `active` flag).
