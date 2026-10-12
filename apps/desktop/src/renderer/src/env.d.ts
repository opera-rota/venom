import type { VenomBridge } from "../../shared/bridge.ts";

declare global {
  interface Window {
    readonly venom: VenomBridge;
  }
}
