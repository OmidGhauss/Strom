// Technischer document_type: contract_pdf
// Fachlich V1: Auftragsbestätigung / Abschlussbestätigung basierend auf einem
// accepted Offer. Kein rechtsverbindliches Vertragsdokument, kein Rechtstext,
// kein Signaturfluss. Rechtliche Prüfung vor Go-Live erforderlich.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type OfferForContractPdf = {
  offer_number:       string;
  version:            number;
  provider_name:      string;
  tariff_name:        string;
  energy_type:        string;
  monthly_price:      number | null;
  annual_price:       number | null;
  estimated_savings:  number | null;
  valid_until:        string | null;
};

type LeadForContractPdf = {
  first_name: string;
  last_name:  string;
};

function formatPrice(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", {
    day:   "2-digit",
    month: "2-digit",
    year:  "numeric",
  });
}

function energyTypeLabel(type: string): string {
  if (type === "electricity") return "Strom";
  if (type === "gas")         return "Gas";
  return type;
}

export async function generateContractPdf(
  offer: OfferForContractPdf,
  lead:  LeadForContractPdf
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();

  // A4: 595 x 842 pt
  const page       = pdfDoc.addPage([595, 842]);
  const { height } = page.getSize();

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontReg  = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const black  = rgb(0,    0,    0);
  const gray   = rgb(0.45, 0.45, 0.45);
  const accent = rgb(0.1,  0.35, 0.65);

  const marginL = 56;
  const marginR = 539;
  let y = height - 72;

  function drawLine(
    text:  string,
    x:     number,
    yPos:  number,
    font  = fontReg,
    size  = 11,
    color = black
  ) {
    page.drawText(text, { x, y: yPos, size, font, color });
  }

  function dataRow(label: string, value: string, yPos: number) {
    drawLine(label, marginL,       yPos, fontReg, 10, gray);
    drawLine(value, marginL + 180, yPos, fontReg, 10, black);
  }

  function separator(yPos: number) {
    page.drawLine({
      start:     { x: marginL, y: yPos },
      end:       { x: marginR, y: yPos },
      thickness: 1,
      color:     accent,
    });
  }

  // ─── Header ───────────────────────────────────────────────────────────────
  drawLine("AUFTRAGSBESTÄTIGUNG", marginL, y, fontBold, 22, accent);
  y -= 28;
  drawLine(
    `Basierend auf Angebot ${offer.offer_number} · Version ${offer.version}`,
    marginL, y, fontReg, 11, gray
  );

  y -= 18;
  separator(y);

  // ─── Empfänger ────────────────────────────────────────────────────────────
  y -= 30;
  drawLine("Erstellt für", marginL, y, fontBold, 11, black);
  y -= 18;
  drawLine(`${lead.first_name} ${lead.last_name}`, marginL, y, fontReg, 12, black);

  // ─── Angebotsdetails ──────────────────────────────────────────────────────
  y -= 40;
  drawLine("Leistungsdetails", marginL, y, fontBold, 11, black);
  y -= 22;

  const details: [string, string][] = [
    ["Anbieter",   offer.provider_name],
    ["Tarif",      offer.tariff_name],
    ["Energieart", energyTypeLabel(offer.energy_type)],
  ];

  for (const [label, value] of details) {
    dataRow(label, value, y);
    y -= 20;
  }

  // ─── Preise ───────────────────────────────────────────────────────────────
  y -= 14;
  drawLine("Konditionen", marginL, y, fontBold, 11, black);
  y -= 22;

  const prices: [string, string][] = [
    ["Monatlicher Preis",    formatPrice(offer.monthly_price)],
    ["Jahrespreis",          formatPrice(offer.annual_price)],
    ["Geschätzte Ersparnis", formatPrice(offer.estimated_savings)],
  ];

  for (const [label, value] of prices) {
    dataRow(label, value, y);
    y -= 20;
  }

  if (offer.valid_until) {
    y -= 6;
    dataRow("Angebot gültig bis", formatDate(offer.valid_until), y);
    y -= 20;
  }

  // ─── Abschluss ────────────────────────────────────────────────────────────
  y -= 18;
  separator(y);
  y -= 24;

  const today = formatDate(new Date().toISOString().slice(0, 10));
  drawLine("Bestätigt am", marginL, y, fontReg, 10, gray);
  drawLine(today, marginL + 180, y, fontReg, 10, black);

  // ─── Footer ───────────────────────────────────────────────────────────────
  const footerY = 48;
  page.drawLine({
    start:     { x: marginL, y: footerY + 16 },
    end:       { x: marginR, y: footerY + 16 },
    thickness: 0.5,
    color:     gray,
  });
  drawLine(
    `Generiert am ${today}`,
    marginL, footerY, fontReg, 9, gray
  );

  return pdfDoc.save();
}
