-- 116_postbus_shipment_delayed.sql — Super Admin delayed-shipment WhatsApp

ALTER TABLE postbus_integrations
  ADD COLUMN IF NOT EXISTS shipment_delayed_template_name text;

COMMENT ON COLUMN postbus_integrations.shipment_delayed_template_name IS
  'Approved WhatsApp template for PostBus shipment_delayed (India Post delay scans).';
