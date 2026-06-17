import { escapeHtml } from "@/lib/email/offer-email";
import type { Offer, Lead } from "@/types/database";

function fmtEur(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

export function buildContractEmailHtml(
  offer: Pick<
    Offer,
    | "offer_number"
    | "version"
    | "provider_name"
    | "tariff_name"
    | "energy_type"
    | "monthly_price"
    | "annual_price"
    | "estimated_savings"
    | "valid_until"
  >,
  lead: Pick<Lead, "first_name" | "last_name">,
  message: string | null,
  companyName: string
): string {
  const energyLabel = offer.energy_type === "electricity" ? "Strom" : "Gas";
  const messageHtml = message
    ? `<p style="margin:0 0 24px">${escapeHtml(message).replace(/\n/g, "<br />")}</p>`
    : "";

  const rows: string[] = [
    row(
      "Bestätigung zu Angebot",
      `${escapeHtml(offer.offer_number)} (Version ${escapeHtml(String(offer.version))})`,
      false
    ),
    row("Anbieter",    escapeHtml(offer.provider_name), true),
    row("Tarif",       escapeHtml(offer.tariff_name), false),
    row("Energieart",  escapeHtml(energyLabel), true),
    row("Monatspreis", fmtEur(offer.monthly_price), false),
    row("Jahrespreis", fmtEur(offer.annual_price), true),
  ];
  if (offer.estimated_savings !== null) {
    rows.push(row("Geschätzte Ersparnis", fmtEur(offer.estimated_savings), false));
  }
  if (offer.valid_until) {
    rows.push(row("Gültig bis", escapeHtml(offer.valid_until), offer.estimated_savings === null));
  }

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Ihre Auftragsbestätigung</title>
</head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f5f5f5">
  <div style="max-width:600px;margin:0 auto;background:#ffffff">
    <div style="background:#1a5aa3;padding:24px 32px">
      <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold">${escapeHtml(companyName)}</h1>
    </div>
    <div style="padding:32px">
      <p style="margin:0 0 16px">Sehr geehrte/r ${escapeHtml(lead.first_name)} ${escapeHtml(lead.last_name)},</p>
      ${messageHtml}
      <p style="margin:0 0 24px">vielen Dank für Ihren Auftrag. Anbei finden Sie Ihre Auftragsbestätigung.</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
        ${rows.join("\n        ")}
      </table>
      <p style="margin:0 0 8px">Ihre Auftragsbestätigung finden Sie im Anhang als PDF-Datei.</p>
      <p style="margin:0 0 24px">Bei Fragen stehen wir Ihnen gerne zur Verfügung.</p>
      <p style="margin:0">Mit freundlichen Grüßen,<br /><strong>${escapeHtml(companyName)}</strong></p>
    </div>
    <div style="background:#f8f9fa;padding:16px 32px;border-top:1px solid #dee2e6">
      <p style="margin:0;font-size:12px;color:#6c757d">Diese E-Mail wurde automatisch generiert. Bitte antworten Sie nicht direkt auf diese Nachricht.</p>
    </div>
  </div>
</body>
</html>`;
}

function row(label: string, value: string, shaded: boolean): string {
  const bg = shaded ? "background:#f8f9fa;" : "";
  return `<tr style="${bg}">
          <td style="padding:10px 12px;border:1px solid #dee2e6;font-weight:bold;width:45%">${label}</td>
          <td style="padding:10px 12px;border:1px solid #dee2e6">${value}</td>
        </tr>`;
}
