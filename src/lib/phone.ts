// Indian mobile numbers, the same rule the backend applies (backend/app/schemas.py: indian_mobile).
// Accepts 10 digits starting 6-9, optionally written with +91 / 91 / 0 and spaces or dashes.

const MOBILE = /^(?:\+?91|0)?([6-9]\d{9})$/;

const digitsOf = (value: string) => value.replace(/[\s-]/g, "");

export const isMobile = (value: string) => MOBILE.test(digitsOf(value));

/** "+919876543210" (or any accepted form) -> "+91 98765 43210"; anything else is returned as typed. */
export function formatMobile(value: string): string {
  const match = MOBILE.exec(digitsOf(value));
  return match ? `+91 ${match[1]!.slice(0, 5)} ${match[1]!.slice(5)}` : value;
}

const tenDigits = (value: string) => MOBILE.exec(digitsOf(value))?.[1];

/** Link that starts a phone call, or undefined if it isn't a mobile number. */
export function callLink(value: string): string | undefined {
  const number = tenDigits(value);
  return number ? `tel:+91${number}` : undefined;
}

/** Link that opens a WhatsApp chat with a ready-typed message, or undefined if it isn't a mobile number. */
export function whatsappChat(value: string, message: string): string | undefined {
  const number = tenDigits(value);
  return number ? `https://wa.me/91${number}?text=${encodeURIComponent(message)}` : undefined;
}
