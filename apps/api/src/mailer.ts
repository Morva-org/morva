// Sending email through Resend, from mail.<our domain> (SPF and DKIM set up on that subdomain).
// Without RESEND_API_KEY, messages print to the console instead: the development fallback.

export interface Mailer {
  sendVerificationCode(to: string, code: string): Promise<void>;
}

export const consoleMailer: Mailer = {
  async sendVerificationCode(to, code) {
    console.log(`[mail] verification code for ${to}: ${code}`);
  },
};

export function resendMailer({ apiKey, from, fetcher = fetch }: { apiKey: string; from: string; fetcher?: typeof fetch }): Mailer {
  return {
    async sendVerificationCode(to, code) {
      const res = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [to],
          subject: `${code} is your Morva code`,
          text: `Your Morva verification code is ${code}.\n\nIt expires in 10 minutes. If you didn't ask for it, you can ignore this email.`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Resend returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  };
}

export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
  if (!env.RESEND_API_KEY) return consoleMailer;
  if (!env.MAIL_FROM) throw new Error("Set MAIL_FROM (e.g. Morva <no-reply@mail.your-domain>) with RESEND_API_KEY");
  return resendMailer({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM });
}
