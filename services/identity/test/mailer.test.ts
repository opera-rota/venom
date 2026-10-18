import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSmtpMailer, mailTemplates } from "../src/index.ts";

const received: string[] = [];
let server: SMTPServer;
let port: number;

beforeAll(async () => {
  server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    onData(stream, _session, callback) {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        received.push(Buffer.concat(chunks).toString("utf8"));
        callback();
      });
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server.server, "listening");
  port = (server.server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("SMTP mailer", () => {
  it("delivers the code email through a real SMTP conversation", async () => {
    const mailer = createSmtpMailer({ url: `smtp://127.0.0.1:${port}`, from: "VENOM <no-reply@venom.local>" });
    await mailer.send({ to: "ninette@venom.test", ...mailTemplates.signupCode("Ninette", "482913") });
    mailer.close();

    expect(received).toHaveLength(1);
    expect(received[0]).toContain("To: ninette@venom.test");
    expect(received[0]).toContain("Subject: 482913 is your VENOM code");
    expect(received[0]).toContain("Your VENOM code is 482913");
  });
});
