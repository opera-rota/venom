import type { DeviceRef, Store } from "@venom/db";
import type { RequestTrace } from "./live-hub.ts";

export async function echoMessage(store: Store, trace: RequestTrace, device: DeviceRef, text: string): Promise<void> {
  try {
    const received = await store.recordMessage({ device, requestId: trace.requestId, speaker: "user", text });
    trace.message(received);

    const reply = await store.recordMessage({ device, requestId: trace.requestId, speaker: "venom", text });
    trace.message(reply);

    trace.state("completed");
  } catch (error) {
    trace.state("failed", "VENOM could not finish saving this message. Try sending it again.");
    throw error;
  }
}
