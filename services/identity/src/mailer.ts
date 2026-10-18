import { createTransport } from "nodemailer";

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
  close(): void;
}

export interface SmtpMailerOptions {
  readonly url: string;
  readonly from: string;
}

export function createSmtpMailer({ url, from }: SmtpMailerOptions): Mailer {
  const transport = createTransport(url, { from });

  return {
    async send({ to, subject, text }) {
      await transport.sendMail({ to, subject, text });
    },
    close() {
      transport.close();
    },
  };
}

export const mailTemplates = {
  signupCode(name: string, code: string): Omit<MailMessage, "to"> {
    return {
      subject: `${code} is your VENOM code`,
      text: [
        `Hello ${name},`,
        "",
        `Your VENOM code is ${code}`,
        "",
        "Type it into VENOM to confirm this email. It works once and expires in 10 minutes.",
        "If you did not ask for this, you can ignore this email.",
      ].join("\n"),
    };
  },

  attachCode(name: string, code: string): Omit<MailMessage, "to"> {
    return {
      subject: `${code} is your code to add a device to VENOM`,
      text: [
        `Hello ${name},`,
        "",
        "Someone typed your secret word to add a new device to your VENOM.",
        `If that was you, your code is ${code}`,
        "",
        "It works once and expires in 10 minutes.",
        "If it was not you, do not share this code with anyone.",
      ].join("\n"),
    };
  },
} as const;
