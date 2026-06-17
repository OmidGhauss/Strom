import { Resend } from "resend";

export function createResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY nicht konfiguriert");
  return new Resend(apiKey);
}

export function getFromEmail(): string {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) throw new Error("RESEND_FROM_EMAIL nicht konfiguriert");
  return from;
}

export function getCompanyName(): string {
  return process.env.COMPANY_NAME ?? "Ihr Energieberater";
}
