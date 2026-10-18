import type { DeviceInfo } from "@venom/contracts";
import type { Mailer, MailMessage } from "./mailer.ts";

export interface RecordingMailer extends Mailer {
  readonly sent: MailMessage[];
  lastCodeFor(email: string): string;
  failNext(): void;
}

export function recordingMailer(): RecordingMailer {
  const sent: MailMessage[] = [];
  let failing = false;

  return {
    sent,
    async send(message) {
      if (failing) {
        failing = false;
        throw new Error("smtp down");
      }
      sent.push(message);
    },
    close() {},
    lastCodeFor(email) {
      const message = sent.findLast((entry) => entry.to.toLowerCase() === email.toLowerCase());
      const code = message?.text.match(/code is (\d{6})/)?.[1];
      if (code === undefined) {
        throw new Error(`No code was emailed to ${email}`);
      }
      return code;
    },
    failNext() {
      failing = true;
    },
  };
}

export function deviceInfo(name: string): DeviceInfo {
  return {
    type: "computer",
    name,
    platform: "windows",
    capabilities: { screen_control: false, microphone: false, speaker: false, shortcuts: false, notifications: false, network: true },
  };
}
