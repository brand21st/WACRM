# PostBus Phase 2 — notification pipeline

Vachat accepts PostBus shipment-stage WhatsApp sends on the existing Cloud API path. PostBus enqueues the same five **live** events (`order_confirmation`, `processing`, `booked`, `in_transit`, `delivered`) to `POST /api/postbus/notifications`. Tenant is always the key’s `account_id`. Future keys (`out_for_delivery`, `delivery_failed`, `return_rto`, `tracking_updated`) are not sourced by PostBus and are not sent.

There is **no second Meta webhook**. Delivery stays on `/api/whatsapp/webhook`, then a signed `message.status_updated` event is forwarded to PostBus.

## API keys

Create a `wacrm_live_` key on the dedicated sender account:

- `postbus:send` — required for **global** PostBus sending (one Vachat account, every PostBus organization UUID in `merchant_id`).
- `messages:send` — legacy **merchant** mode (one Vachat account ↔ one `postbus_merchant_id`).
- `webhooks:manage` — register the PostBus status webhook (`message.status_updated`).

The notifications endpoint accepts either send scope. Global routing still requires `postbus:send`.

## Super Admin vs merchant

**Super Admin** (PostBus console + VaChat `GET/PUT /api/super-admin/postbus`):

- Owns the single global sender account, official WhatsApp display number (`GET /api/postbus/identity`, no tokens), templates, and live-event kill switches.
- PostBus Super Admin stores the encrypted key in `platform_settings` (`vachat_enabled` default **false**). Machine updates use `PUT /api/postbus/templates` (`postbus:send`).

**Merchant** Settings → Integrations → PostBus:

- 1:1 `postbus_merchant_id` only. `PUT /api/postbus/config` **ignores** `routing_mode`.
- If the account is already `global`, the merchant dialog is read-only.

## Routing modes

- **merchant** (default): `merchant_id` must equal `postbus_integrations.postbus_merchant_id` or the call is `403 invalid_merchant_mapping`.
- **global**: `merchant_id` is PostBus `organizations.id` (routing/audit only). Templates and notification switches live on the dedicated account. When PostBus `vachat_enabled` is on, merchant `auto_wati_*` flags are WATI-only — VaChat uses Super Admin event flags.

`derivePostBusStatus` is connected when WhatsApp config exists **and** either a merchant ID is saved (merchant mode) or routing is global. Test Connection probes Meta `verifyPhoneNumber` and checks for an active `messages:send` or `postbus:send` API key. It never sends a customer message and never calls a PostBus URL.

## Idempotency and receipts

Idempotency lives in `postbus_notifications` (`UNIQUE (account_id, external_ref)`). PostBus also stores `vachat_notification_logs` (`UNIQUE (organization_id, external_ref)`) and uses `postbus:{event}:{shipmentOrOrderId}`. Replays return the original message ids and do not call Meta again.

Invalid phone / `template_missing` / `notification_disabled`: log failed, do not retry. Network/5xx: existing `background_jobs` retry. WhatsApp failures never fail the order or shipment.

Delivery receipts stay on `/api/whatsapp/webhook`. Matching `postbus_notifications` rows get a forward-only status update, and `message.status_updated` includes `external_ref`, `notification_type`, `merchant_id`, and Vachat `message_id`. PostBus verifies `X-Wacrm-Signature` (`t=` / `v1=`) on `POST /api/v1/integrations/vachat/webhooks`, updates `vachat_notification_logs`, and records `vachat.message_sent|_delivered|_failed|_read`. Unknown `merchant_id` is rejected.

Manual and Shopify orders share the same PostBus enqueue helpers after they become orders/shipments.

WATI is unchanged. Durable outbound-webhook retry on Vachat remains Phase 3.
