"use client";

import { ExternalLink, List, MapPin, Reply, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InteractiveMessagePayload } from "@/lib/whatsapp/interactive";

/**
 * WhatsApp-style read-only render of an interactive message. Used both
 * in the builder's live preview and by the inbox message bubble so a
 * sent buttons/list message shows the same way it does on the phone.
 *
 * Purely presentational — the buttons/rows are not clickable here (the
 * customer taps them on their own device). Kept namespace-free (plain
 * English) so it can be dropped into the composer, the automation
 * builder, and the quick-replies manager without namespace coupling.
 */
export function InteractivePreview({
  payload,
  className,
}: {
  payload: InteractiveMessagePayload;
  className?: string;
}) {
  if (payload.kind === "inbound_order") {
    return (
      <div
        className={cn(
          "w-full max-w-[260px] overflow-hidden rounded-lg bg-card text-foreground shadow-sm ring-1 ring-border",
          className,
        )}
      >
        <div className="px-3 py-2">
          <p className="mb-1 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <ShoppingBag className="h-3 w-3" />
            Cart
          </p>
          <ul className="space-y-1 text-sm">
            {payload.items.map((item, i) => (
              <li key={`${item.product_retailer_id}-${i}`}>
                {(item.name || item.product_retailer_id) + ` × ${item.quantity}`}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  const header =
    "header" in payload && typeof payload.header === "string"
      ? payload.header
      : undefined;
  const footer =
    "footer" in payload && typeof payload.footer === "string"
      ? payload.footer
      : undefined;
  const body = "body" in payload ? payload.body : "";
  const headerImage =
    payload.kind === "cta_url" || payload.kind === "order_details"
      ? payload.header_image
      : undefined;

  return (
    <div
      className={cn(
        "w-full max-w-[260px] overflow-hidden rounded-lg bg-card text-foreground shadow-sm ring-1 ring-border",
        className,
      )}
    >
      <div className="px-3 py-2">
        {headerImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={headerImage}
            alt=""
            className="-mx-3 -mt-2 mb-2 h-32 w-[calc(100%+1.5rem)] object-cover"
          />
        ) : null}
        {header ? (
          <p className="mb-1 break-words text-sm font-semibold">{header}</p>
        ) : null}
        <p className="whitespace-pre-wrap break-words text-sm">
          {body ? (
            <WhatsAppStrikeBody text={body} />
          ) : (
            <span className="text-muted-foreground">Message body…</span>
          )}
        </p>
        {footer ? (
          <p className="mt-1 break-words text-[11px] text-muted-foreground">
            {footer}
          </p>
        ) : null}
      </div>

      {payload.kind === "buttons" ? (
        <div className="flex flex-col border-t border-border">
          {payload.buttons.map((b, i) => (
            <button
              key={b.id || i}
              type="button"
              disabled
              className="flex items-center justify-center gap-1.5 border-t border-border py-2 text-sm font-medium text-primary first:border-t-0"
            >
              <Reply className="h-3.5 w-3.5" />
              <span className="truncate">{b.title || "Button"}</span>
            </button>
          ))}
        </div>
      ) : payload.kind === "cta_url" ? (
        <button
          type="button"
          disabled
          className="flex w-full items-center justify-center gap-1.5 border-t border-border py-2 text-sm font-medium text-primary"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          <span className="truncate">{payload.display_text || "Checkout NOW"}</span>
        </button>
      ) : payload.kind === "list" ? (
        <button
          type="button"
          disabled
          className="flex w-full items-center justify-center gap-1.5 border-t border-border py-2 text-sm font-medium text-primary"
        >
          <List className="h-3.5 w-3.5" />
          <span className="truncate">{payload.button_label || "Menu"}</span>
        </button>
      ) : payload.kind === "order_details" ? (
        <button
          type="button"
          disabled
          className="flex w-full items-center justify-center gap-1.5 border-t border-border py-2 text-sm font-medium text-primary"
        >
          <span className="truncate">Review and Pay</span>
        </button>
      ) : payload.kind === "address_message" ? (
        <button
          type="button"
          disabled
          className="flex w-full items-center justify-center gap-1.5 border-t border-border py-2 text-sm font-medium text-primary"
        >
          <MapPin className="h-3.5 w-3.5" />
          <span className="truncate">Provide address</span>
        </button>
      ) : payload.kind === "order_status" ? (
        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          {payload.status}
        </div>
      ) : payload.kind === "product" ||
        payload.kind === "product_list" ||
        payload.kind === "catalog_message" ? (
        <button
          type="button"
          disabled
          className="flex w-full items-center justify-center gap-1.5 border-t border-border py-2 text-sm font-medium text-primary"
        >
          <ShoppingBag className="h-3.5 w-3.5" />
          <span className="truncate">
            {payload.kind === "catalog_message" ? "View catalog" : "View product"}
          </span>
        </button>
      ) : null}
    </div>
  );
}

/** WhatsApp `~strike~` in interactive body text (sale compare-at on product cards). */
function WhatsAppStrikeBody({ text }: { text: string }) {
  const parts = text.split(/(~[^~\n]+~)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.length >= 3 && part.startsWith("~") && part.endsWith("~") ? (
          <s key={i}>{part.slice(1, -1)}</s>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
