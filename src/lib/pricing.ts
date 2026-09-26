// Checkout maths for the preview. Mirrors backend/app/services.py exactly, in integer paise, so the
// total the customer sees (and may pay by UPI) is the total the server records. The server re-checks
// every order and refuses one whose total no longer matches. Keep the two files in step.
import type { Coupon, CouponKind, CouponRule, DailyOffer, Delivery, Product } from "./mart-types";

export const PREMIUM_PRICE = 45;
export const FREE_PICK_MAX_PRICE = 12;
/** Rupees off for each coupon kind (freeSnack100 gives a free ₹10 item instead). */
export const COUPON_VALUES: Record<CouponKind, number> = { free60: 10, three5: 5, freeSnack100: 10, halfDelivery: 5, four10: 10, premium5: 5 };
const FREE_PICK_SAVINGS = 1000;
const TIER50_SAVINGS = 500;

/** Set by the site admin (whole rupees): added to each item's MRP (eggs: once per order), and the
 * room delivery fee. */
export type PriceRules = { markup: number; deliveryFee: number };
export const DEFAULT_RULES: PriceRules = { markup: 5, deliveryFee: 10 };

/** Paise off for a coupon. The delivery coupons follow the delivery fee: free60 is the whole fee,
 * halfDelivery half of it (see coupon_value in backend/app/services.py). */
export function couponValue(kind: CouponKind, deliveryFee: number): number {
  if (kind === "free60") return deliveryFee;
  if (kind === "halfDelivery") return Math.floor(deliveryFee / 2);
  return COUPON_VALUES[kind] * 100;
}

export const toPaise = (rupees: number) => Math.round(rupees * 100);
export const toRupees = (paise: number) => paise / 100;

/** ₹70 or ₹67.50 — the same format the server uses in its messages. */
export function money(rupees: number): string {
  const paise = toPaise(rupees);
  const fraction = paise % 100 !== 0;
  return `₹${(paise / 100).toLocaleString("en-US", { minimumFractionDigits: fraction ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** A percentage of the subtotal, rounded half-up to whole rupees (2.5 → 3), in paise. */
export const percentOff = (subtotal: number, percent: number) => Math.floor((subtotal * percent + 5000) / 10000) * 100;

export const isEggProduct = (product: Pick<Product, "name">) => product.name.trim().toLowerCase() === "eggs";

/** Price per item in rupees: MRP + markup, except eggs, which are MRP each (+ markup once per order). */
export const salePrice = (product: Pick<Product, "name" | "mrp">, rules: PriceRules = DEFAULT_RULES) =>
  isEggProduct(product) ? product.mrp : product.mrp + rules.markup;

/** In paise. */
export function lineTotal(product: Pick<Product, "name" | "mrp">, quantity: number, rules: PriceRules = DEFAULT_RULES): number {
  if (isEggProduct(product)) return toPaise(product.mrp) * quantity + (quantity > 0 ? rules.markup * 100 : 0);
  return (toPaise(product.mrp) + rules.markup * 100) * quantity;
}

export type CartLine = { product: Pick<Product, "name" | "mrp">; qty: number };
export type CartSummary = { subtotal: number; itemCount: number; premiumCount: number }; // subtotal in paise

export function cartSummary(lines: CartLine[], rules: PriceRules = DEFAULT_RULES): CartSummary {
  return {
    subtotal: lines.reduce((sum, line) => sum + lineTotal(line.product, line.qty, rules), 0),
    itemCount: lines.reduce((sum, line) => sum + line.qty, 0),
    premiumCount: lines.reduce((sum, line) => sum + (toPaise(salePrice(line.product, rules)) >= PREMIUM_PRICE * 100 ? line.qty : 0), 0),
  };
}

export type CouponCheck = { eligible: boolean; reason: string };

const more = (count: number, word: string) => `${count} more ${word}${count === 1 ? "" : "s"}`;

export function couponStatus(coupon: Coupon | null, cart: CartSummary, delivery: Delivery, now = Date.now()): CouponCheck {
  if (!coupon || coupon.expiresAt <= now) return { eligible: false, reason: "This coupon has expired." };
  const room = delivery === "Room Delivery";
  const short = (paise: number) => `Add ${money(toRupees(paise))} more to use this coupon!`;
  switch (coupon.kind) {
    case "free60":
      if (cart.subtotal < 6000) return { eligible: false, reason: short(6000 - cart.subtotal) };
      if (!room) return { eligible: false, reason: "Choose Room Delivery to use this coupon!" };
      break;
    case "three5":
      if (cart.itemCount < 3) return { eligible: false, reason: `Add ${more(3 - cart.itemCount, "item")} to use this coupon!` };
      break;
    case "freeSnack100":
      if (cart.subtotal < 10000) return { eligible: false, reason: short(10000 - cart.subtotal) };
      break;
    case "halfDelivery":
      if (!room) return { eligible: false, reason: "Choose Room Delivery to unlock 50% off delivery!" };
      break;
    case "four10":
      if (cart.itemCount < 4) return { eligible: false, reason: `Add ${more(4 - cart.itemCount, "item")} to use this coupon!` };
      break;
    case "premium5":
      if (cart.premiumCount < 2) return { eligible: false, reason: `Add ${more(2 - cart.premiumCount, "premium item")} (₹45+) to use this coupon!` };
      break;
  }
  return { eligible: true, reason: "Coupon unlocked and ready!" };
}

export type DealKind = "coupon" | "bulk" | "first" | "tier100" | "tier50";
export type Deal = { kind: DealKind; label: string; discount: number; freePick: boolean; freebies: string[] }; // discount in paise
export type Quote = { subtotal: number; fee: number; discount: number; total: number; deal: Deal | null }; // all paise

export type QuoteInput = {
  lines: CartLine[];
  delivery: Delivery;
  firstOrder: boolean;
  coupon: Coupon | null;
  dailyOffers: DailyOffer[];
  couponRule: CouponRule;
  rules?: PriceRules;
  now?: number;
};

/** Only one reward applies per order; see best_deal in backend/app/services.py. */
export function quote({ lines, delivery, firstOrder, coupon, dailyOffers, couponRule, rules = DEFAULT_RULES, now = Date.now() }: QuoteInput): Quote {
  const cart = cartSummary(lines, rules);
  const fee = delivery === "Room Delivery" ? rules.deliveryFee * 100 : 0;
  const offer = (id: DailyOffer["id"]) => dailyOffers.find((item) => item.id === id);
  const active = (id: DailyOffer["id"]) => Boolean(offer(id)?.active);
  const title = (id: DailyOffer["id"], fallback: string) => offer(id)?.title || fallback;
  const deal = (kind: DealKind, label: string, extra: Partial<Deal> = {}): Deal => ({ kind, label, discount: 0, freePick: false, freebies: [], ...extra });

  // [savings, deal] in priority order; ties keep the earlier one.
  const candidates: [number, Deal][] = [];
  if (active("bulk") && cart.subtotal > 20000) {
    const amount = percentOff(cart.subtotal, 20);
    candidates.push([amount, deal("bulk", title("bulk", "Bulk order 20% OFF"), { discount: amount })]);
  }
  if (active("first") && firstOrder) {
    const amount = percentOff(cart.subtotal, 10);
    candidates.push([amount, deal("first", title("first", "First order 10% OFF"), { discount: amount })]);
  }
  if (active("tier100") && cart.subtotal >= 10000) candidates.push([FREE_PICK_SAVINGS, deal("tier100", title("tier100", "₹100+ Offer"), { freePick: true })]);
  else if (active("tier50") && cart.subtotal >= 5000) candidates.push([TIER50_SAVINGS, deal("tier50", title("tier50", "₹50+ Offer"), { freebies: ["₹5 chocolate (free)"] })]);

  if (coupon && couponStatus(coupon, cart, delivery, now).eligible) {
    const [savings, couponDeal] =
      coupon.kind === "freeSnack100"
        ? [FREE_PICK_SAVINGS, deal("coupon", coupon.label, { freePick: true })]
        : (() => {
            const amount = Math.min(couponValue(coupon.kind, rules.deliveryFee * 100), cart.subtotal + fee);
            return [amount, deal("coupon", coupon.label, { discount: amount })] as const;
          })();
    if (couponRule === "coupon") return finish(cart.subtotal, fee, couponDeal);
    candidates.push([savings, couponDeal]);
  }

  let best: Deal | null = null;
  let bestSavings = 0;
  for (const [savings, candidate] of candidates) {
    if (savings > bestSavings) [best, bestSavings] = [candidate, savings];
  }
  return finish(cart.subtotal, fee, best);
}

function finish(subtotal: number, fee: number, deal: Deal | null): Quote {
  const discount = Math.max(0, Math.min(deal?.discount ?? 0, subtotal + fee));
  return { subtotal, fee, discount, total: subtotal + fee - discount, deal };
}
