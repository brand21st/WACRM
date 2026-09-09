"use client";

import { useEffect, useState } from "react";
import { ExternalLink, List, MapPin, Reply, ShoppingBag } from "lucide-react";
import {
  cartItemCount,
  cartItemsTotal,
  formatCartMoney,
  pickCartDisplayPrice,
} from "@/lib/commerce/inbound-order";
import type { InboundCartItem } from "@/lib/commerce/types";
import { cn } from "@/lib/utils";
import type {
  InteractiveInboundOrderPayload,
  InteractiveMessagePayload,
} from "@/lib/whatsapp/interactive";

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
    return <InboundCartPreview payload={payload} className={className} />;
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
            className="-mx-3 -mt-2 mb-2 h-24 w-[calc(100%+1.5rem)] object-cover lg:h-32"
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

function InboundCartPreview({
  payload,
  className,
}: {
  payload: InteractiveInboundOrderPayload;
  className?: string;
}) {
  const lookupKey = payload.items
    .map(
      (item) =>
        `${item.product_retailer_id}:${item.name ?? ""}:${item.item_price ?? ""}:${item.compare_at_price ?? ""}:${item.image_url ?? ""}:${item.quantity}`,
    )
    .join("|");
  const needsLookup = payload.items.some(
    (item) =>
      !item.name?.trim() ||
      item.item_price == null ||
      item.item_price <= 1 ||
      !item.image_url?.trim(),
  );
  const [items, setItems] = useState(payload.items);

  useEffect(() => {
    if (!needsLookup) {
      setItems(payload.items);
      return;
    }
    const snapshot = payload.items;
    const ids = [
      ...new Set(
        snapshot.map((item) => item.product_retailer_id.trim()).filter(Boolean),
      ),
    ];
    if (ids.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/catalog/by-retailer?ids=${encodeURIComponent(ids.join(","))}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          items?: Array<{
            retailer_id?: string;
            name?: string;
            price?: number;
            compare_at?: number | null;
            currency?: string;
            image_url?: string | null;
          }>;
        };
        if (cancelled || !Array.isArray(data.items)) return;
        const byId = new Map(
          data.items
            .filter((row) => row.retailer_id)
            .map((row) => [String(row.retailer_id), row]),
        );
        setItems(
          snapshot.map((item) => {
            const hit = byId.get(item.product_retailer_id);
            if (!hit) return item;
            const display = pickCartDisplayPrice({
              whatsapp: item.item_price,
              catalog: hit.price ?? undefined,
              compareAt: hit.compare_at ?? undefined,
            });
            return {
              ...item,
              name: item.name?.trim() || hit.name || undefined,
              item_price: display.unit ?? item.item_price ?? hit.price,
              compare_at_price: display.compareAt,
              currency: item.currency || hit.currency,
              image_url: item.image_url || hit.image_url || undefined,
            };
          }),
        );
      } catch {
        // Keep the stored payload; retailer IDs still render.
      }
    })();
    return () => {
      cancelled = true;
    };
    // lookupKey captures item identity; avoid payload.items (new array each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lookupKey
  }, [lookupKey, needsLookup]);

  return <InboundCartCard items={items} className={className} />;
}

export function InboundCartCard({
  items,
  className,
}: {
  items: InboundCartItem[];
  className?: string;
}) {
  const count = cartItemCount(items);
  const total = cartItemsTotal(items);

  return (
    <div
      className={cn(
        "w-full max-w-[280px] overflow-hidden rounded-lg bg-card text-foreground shadow-sm ring-1 ring-border",
        className,
      )}
    >
      <div className="px-3 py-2.5">
        <p className="mb-2 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <ShoppingBag className="h-3 w-3" />
          Cart
          <span className="font-normal normal-case tracking-normal">
            · {count} {count === 1 ? "item" : "items"}
          </span>
        </p>
        <ul className="space-y-3 text-sm">
          {items.map((item, i) => {
            const name = item.name?.trim() || item.product_retailer_id;
            const { title, variant } = splitCartLineName(name);
            const qty = Math.max(1, item.quantity || 1);
            const priced = pickCartDisplayPrice({
              whatsapp: item.item_price,
              catalog: item.item_price,
              compareAt: item.compare_at_price,
            });
            const unit = priced.unit;
            const compareAt = priced.compareAt;
            const line = unit != null ? unit * qty : undefined;
            return (
              <li key={`${item.product_retailer_id}-${i}`} className="flex gap-2.5">
                {item.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.image_url}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-14 w-14 shrink-0 rounded-md object-cover object-top ring-1 ring-border"
                  />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground ring-1 ring-border">
                    <ShoppingBag className="h-4 w-4" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p
                    className="line-clamp-2 leading-snug font-medium break-words"
                    title={name}
                  >
                    {title}
                  </p>
                  {variant ? (
                    <p
                      className="mt-0.5 line-clamp-1 text-xs leading-snug text-muted-foreground"
                      title={variant}
                    >
                      {variant}
                    </p>
                  ) : null}
                  <div className="mt-1 flex items-baseline justify-between gap-2 text-xs">
                    <span className="shrink-0 text-muted-foreground">
                      Qty {qty}
                      {unit != null && qty > 1
                        ? ` · ${formatCartMoney(unit, item.currency)}`
                        : ""}
                    </span>
                    {line != null ? (
                      <span className="min-w-0 text-right tabular-nums">
                        {compareAt != null ? (
                          <s className="mr-1.5 text-muted-foreground">
                            {formatCartMoney(compareAt * qty, item.currency)}
                          </s>
                        ) : null}
                        <span className="font-medium text-foreground">
                          {formatCartMoney(line, item.currency)}
                        </span>
                      </span>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {total ? (
          <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-sm font-medium">
            <span>Total</span>
            <span className="tabular-nums">
              {formatCartMoney(total.amount, total.currency)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Catalog enrich joins title and variant with an em dash. */
export function splitCartLineName(name: string): {
  title: string;
  variant?: string;
} {
  const sep = " — ";
  const idx = name.indexOf(sep);
  if (idx <= 0) return { title: name };
  const title = name.slice(0, idx).trim();
  const variant = name.slice(idx + sep.length).trim();
  if (!title || !variant) return { title: name };
  return { title, variant };
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
