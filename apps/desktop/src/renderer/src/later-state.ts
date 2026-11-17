import type { GatewayEvent, LaterItem } from "@venom/contracts";

function newestFirst(left: LaterItem, right: LaterItem): number {
  return left.created_at === right.created_at ? right.id.localeCompare(left.id) : right.created_at.localeCompare(left.created_at);
}

export function withLater(items: readonly LaterItem[], item: LaterItem): readonly LaterItem[] {
  return [...items.filter((existing) => existing.id !== item.id), item].sort(newestFirst);
}

export function withoutLater(items: readonly LaterItem[], itemId: string): readonly LaterItem[] {
  return items.some((item) => item.id === itemId) ? items.filter((item) => item.id !== itemId) : items;
}

export function applyLaterEvent(items: readonly LaterItem[], event: GatewayEvent): readonly LaterItem[] {
  switch (event.type) {
    case "later":
      return withLater(items, event.item);
    case "later_removed":
      return withoutLater(items, event.item_id);
    default:
      return items;
  }
}

export function unseenCount(items: readonly LaterItem[]): number {
  return items.filter((item) => item.seen_at === null).length;
}
