"use client";

import { useIncomingMessageAlerts } from "@/hooks/use-incoming-message-alerts";

/**
 * Headless. Mount once in the signed-in dashboard shell so inbound
 * WhatsApp messages chime / toast on every page, not just Inbox.
 */
export function IncomingMessageAlerts() {
  useIncomingMessageAlerts();
  return null;
}
