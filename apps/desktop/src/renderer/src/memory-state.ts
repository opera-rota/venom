import type { GatewayEvent, MemoryItem, MemoryType } from "@venom/contracts";

export const memoryTypes: readonly MemoryType[] = ["preference", "fact", "event"];

function newestFirst(left: MemoryItem, right: MemoryItem): number {
  return left.created_at === right.created_at ? right.id.localeCompare(left.id) : right.created_at.localeCompare(left.created_at);
}

export function withItem(items: readonly MemoryItem[], item: MemoryItem): readonly MemoryItem[] {
  return [...items.filter((existing) => existing.id !== item.id), item].sort(newestFirst);
}

export function withoutItem(items: readonly MemoryItem[], itemId: string): readonly MemoryItem[] {
  return items.some((item) => item.id === itemId) ? items.filter((item) => item.id !== itemId) : items;
}

export function applyMemoryEvent(items: readonly MemoryItem[], event: GatewayEvent): readonly MemoryItem[] {
  switch (event.type) {
    case "memory":
      return withItem(items, event.item);
    case "forgotten":
      return withoutItem(items, event.item_id);
    default:
      return items;
  }
}

export function matching(items: readonly MemoryItem[], query: string): readonly MemoryItem[] {
  const words = query.toLocaleLowerCase().split(/\s+/u).filter((word) => word.length > 0);
  if (words.length === 0) {
    return items;
  }
  return items.filter((item) => {
    const content = item.content.toLocaleLowerCase();
    return words.every((word) => content.includes(word));
  });
}
