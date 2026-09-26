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

/** The same payment opened straight in a particular app (the plain upi:// link lets the phone choose). */
export const upiAppLinks = (link: string) => [
  { label: "Google Pay", href: link.replace("upi://", "tez://upi/") },
  { label: "PhonePe", href: link.replace("upi://", "phonepe://") },
  { label: "Paytm", href: link.replace("upi://", "paytmmp://") },
  { label: "BHIM", href: link.replace("upi://", "bhim://") },
];
