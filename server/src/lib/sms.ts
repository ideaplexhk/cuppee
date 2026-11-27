export interface SmsSender {
  send(phone: string, text: string): void;
}

/** Development sender: prints the message. Replace with a real provider (e.g. Twilio, Vonage, AWS SNS) before launch. */
export class ConsoleSms implements SmsSender {
  sent: { phone: string; text: string }[] = [];
  quiet: boolean;
  constructor(quiet = false) {
    this.quiet = quiet;
  }
  send(phone: string, text: string) {
    this.sent.push({ phone, text });
    if (!this.quiet) console.log(`[sms] → ${phone}: ${text}`);
  }
}
