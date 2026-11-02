// Sending email. No provider is chosen yet; the console mailer prints instead of sending.

export interface Mailer {
  sendVerificationCode(to: string, code: string): Promise<void>;
}

export const consoleMailer: Mailer = {
  async sendVerificationCode(to, code) {
    console.log(`[mail] verification code for ${to}: ${code}`);
  },
};
