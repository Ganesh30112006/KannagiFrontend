// Paying the shop by UPI. The UPI ID and payee name are set by the site admin at /admin (see
// SiteDetails); the payee name should be the bank account holder's, which is what the customer's UPI
// app shows before she pays.
import type { SiteDetails } from "./mart-types";

/** A UPI payment link for an exact amount; the note shows up in both people's UPI apps. */
export function upiPayLink(site: Pick<SiteDetails, "upiId" | "upiName">, amount: number, note: string): string {
  // UPI wants a plain decimal amount with at most 2 places.
  return `upi://pay?pa=${encodeURIComponent(site.upiId)}&pn=${encodeURIComponent(site.upiName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
}

/** The shop's UPI address with no amount, like a printed shop QR (for checking the details). */
export const upiProfileLink = (site: Pick<SiteDetails, "upiId" | "upiName">) =>
  `upi://pay?pa=${encodeURIComponent(site.upiId)}&pn=${encodeURIComponent(site.upiName)}&cu=INR`;

/** The UPI ID a UPI QR's text pays (upi://pay?pa=...&pn=...), or null when it isn't one (the API checks the same). */
export function upiQrPayee(text: string): string | null {
  const [scheme, query = ""] = text.split("?", 2);
  if (scheme?.toLowerCase() !== "upi://pay" || /\s/.test(text)) return null;
  const payee = new URLSearchParams(query).get("pa") ?? "";
  return /^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,63}$/.test(payee) ? payee : null;
}

/** The payee name in a UPI QR's text, if any. */
export const upiQrName = (text: string) => new URLSearchParams(text.split("?", 2)[1] ?? "").get("pn")?.trim() || null;

/** Read the QR code in a picture (a screenshot of the shop's QR from PhonePe, Google Pay or Paytm). Dark-mode
 * QRs (light on dark) are read too. Resolves to the QR's text, or null when no QR is found. */
export async function readQrImage(file: Blob): Promise<string | null> {
  const [{ default: jsQR }, bitmap] = await Promise.all([import("jsqr"), createImageBitmap(file)]);
  try {
    for (const longest of [1000, 600, 1600]) {
      const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;
      context.fillStyle = "#fff"; // transparent pixels read as white, not black
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      const found = jsQR(context.getImageData(0, 0, width, height).data, width, height, { inversionAttempts: "attemptBoth" });
      if (found?.data) return found.data.trim();
    }
    return null;
  } finally {
    bitmap.close();
  }
}

/** The same payment opened straight in a particular app (the plain upi:// link lets the phone choose). */
export const upiAppLinks = (link: string) => [
  { label: "Google Pay", href: link.replace("upi://", "tez://upi/") },
  { label: "PhonePe", href: link.replace("upi://", "phonepe://") },
  { label: "Paytm", href: link.replace("upi://", "paytmmp://") },
  { label: "BHIM", href: link.replace("upi://", "bhim://") },
];
