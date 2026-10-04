// Checkout maths for the preview. Mirrors backend/app/services.py exactly, in integer paise, so the
// total the customer sees (and may pay by UPI) is the total the server records. The server re-checks
// every order and refuses one whose total no longer matches. Keep the two files in step.
import type { Coupon, CouponKind, CouponRule, DailyOffer, Delivery, Product, WheelPrize } from "./mart-types";

export const PREMIUM_PRICE = 45;
/** The free ₹10 item of the ₹100+ offer unless the shop sets its own limit (and of a spin coupon from
 * before slices had amounts): any item with an MRP up to ₹12. */
export const FREE_PICK_VALUE = 10;
export const FREE_PICK_MAX_PRICE = 12;

// --- spin coupons: a slice gives one kind of reward on the cart conditions the shop set (see
// CouponTerms in backend/app/services.py; keep the two in step) ---
const DELIVERY_COUPONS: CouponKind[] = ["free60", "halfDelivery"];
/** premium5: on 2 items of ₹45+. */
export const PREMIUM_ITEMS = 2;
/** What a slice starts with when the shopkeeper picks its reward (the original rules). */
export const COUPON_DEFAULTS: Record<CouponKind, { minOrder: number; minItems: number; amount: number | null }> = {
  free60: { minOrder: 60, minItems: 0, amount: null },
  halfDelivery: { minOrder: 0, minItems: 0, amount: null },
  three5: { minOrder: 0, minItems: 3, amount: 5 },
  four10: { minOrder: 0, minItems: 4, amount: 10 },
  premium5: { minOrder: 0, minItems: 0, amount: 5 },
  freeSnack100: { minOrder: 100, minItems: 0, amount: FREE_PICK_VALUE },
};
export const isDeliveryCoupon = (kind: CouponKind) => DELIVERY_COUPONS.includes(kind);
export type CouponTerms = Pick<Coupon, "kind" | "minOrder" | "minItems" | "amount" | "pickUpTo">;

/** A wheel slice's reward (null: Better Luck), its amounts filled in. */
export function prizeTerms(prize: Pick<WheelPrize, "kind" | "minOrder" | "minItems" | "amount">): CouponTerms | null {
  if (!prize.kind) return null;
  const defaults = COUPON_DEFAULTS[prize.kind];
  const amount = isDeliveryCoupon(prize.kind) ? 0 : (prize.amount ?? defaults.amount ?? 0);
  return {
    kind: prize.kind,
    minOrder: prize.minOrder ?? defaults.minOrder,
    minItems: prize.minItems ?? defaults.minItems,
    amount,
    pickUpTo: prize.kind === "freeSnack100" ? (prize.amount ?? FREE_PICK_MAX_PRICE) : 0,
  };
}

/** What a slice says (its label, and the short text on the wheel), made from what it gives; the server
 * writes the same (prize_text in backend/app/services.py). */
export function prizeText(terms: CouponTerms | null): { label: string; shortLabel: string } {
  if (!terms) return { label: "Better Luck Next Time", shortLabel: "BETTER LUCK!" };
  const a = terms.amount;
  const [gives, short] =
    terms.kind === "free60" ? ["FREE Delivery", "FREE DELIVERY"]
    : terms.kind === "halfDelivery" ? ["50% OFF Room Delivery", "½ DELIVERY"]
    : terms.kind === "premium5" ? [`₹${a} OFF on ${PREMIUM_ITEMS} Premium Items`, `${PREMIUM_ITEMS} PREMIUM ₹${a} OFF`]
    : terms.kind === "freeSnack100" ? [`Free ₹${a} Snack`, `FREE ₹${a} SNACK`]
    : [`₹${a} OFF`, `₹${a} OFF`];
  let label = gives;
  let shortLabel = short;
  if (terms.minOrder) { label += ` on ₹${terms.minOrder}+ Orders`; shortLabel += ` ₹${terms.minOrder}+`; }
  if (terms.minItems) { label += ` with ${terms.minItems}+ Items`; shortLabel += ` · ${terms.minItems}+ ITEMS`; }
  return { label, shortLabel };
}
/** What each offer gives unless the shop set its own amounts (see DailyOffer). */
// loyalty: every 10th completed order, a free item up to ₹10 (it stacks, so quote() doesn't price it).
export const OFFER_DEFAULTS = { firstPercent: 10, bulkPercent: 20, tier50Gift: 5, loyaltyEvery: 10, loyaltyPickUpTo: 10 };

/** A free chocolate as an order lists it (see gift_text in backend/app/services.py). */
export const giftText = (rupees: number) => `₹${rupees} chocolate (free)`;

/** Set by the site admin (whole rupees): added to each item's MRP (eggs: once per order), and the
 * room delivery fee. */
export type PriceRules = { markup: number; deliveryFee: number };
export const DEFAULT_RULES: PriceRules = { markup: 5, deliveryFee: 10 };

/** Paise off for a coupon. The delivery coupons follow the delivery fee (paise): free60 is the whole fee,
 * halfDelivery half of it (see coupon_value in backend/app/services.py). */
export function couponValue(terms: CouponTerms, deliveryFee: number): number {
  if (terms.kind === "free60") return deliveryFee;
  if (terms.kind === "halfDelivery") return Math.floor(deliveryFee / 2);
  return terms.amount * 100;
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

/** Whether her coupon applies to this cart, and if not, what's missing (coupon_eligible on the server). */
export function couponStatus(coupon: Coupon | null, cart: CartSummary, delivery: Delivery, now = Date.now()): CouponCheck {
  if (!coupon || coupon.expiresAt <= now) return { eligible: false, reason: "This coupon has expired." };
  const minOrder = coupon.minOrder * 100;
  if (cart.subtotal < minOrder) return { eligible: false, reason: `Add ${money(toRupees(minOrder - cart.subtotal))} more to use this coupon!` };
  if (cart.itemCount < coupon.minItems) return { eligible: false, reason: `Add ${more(coupon.minItems - cart.itemCount, "item")} to use this coupon!` };
  if (coupon.kind === "premium5" && cart.premiumCount < PREMIUM_ITEMS) return { eligible: false, reason: `Add ${more(PREMIUM_ITEMS - cart.premiumCount, "premium item")} (₹${PREMIUM_PRICE}+) to use this coupon!` };
  if (isDeliveryCoupon(coupon.kind) && delivery !== "Room Delivery") return { eligible: false, reason: "Choose Room Delivery to use this coupon!" };
  return { eligible: true, reason: "Coupon unlocked and ready!" };
}

export type DealKind = "coupon" | "bulk" | "first" | "tier100" | "tier50";
export type Deal = {
  kind: DealKind;
  label: string;
  /** Paise off, a room delivery fee it waives included. */
  discount: number;
  /** She picks a free item worth ₹pickValue, with an MRP up to ₹pickUpTo. */
  freePick: boolean;
  pickValue: number;
  pickUpTo: number;
  /** A free chocolate worth ₹ (0: none); it's in freebies too. */
  gift: number;
  /** The room delivery fee is waived (part of discount). */
  freeDelivery: boolean;
  freebies: string[];
};
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

/** Only one reward applies per order; the offers give the amounts the shop set on their cards. Mirrors
 * best_deal in backend/app/services.py. */
export function quote({ lines, delivery, firstOrder, coupon, dailyOffers, couponRule, rules = DEFAULT_RULES, now = Date.now() }: QuoteInput): Quote {
  const cart = cartSummary(lines, rules);
  const fee = delivery === "Room Delivery" ? rules.deliveryFee * 100 : 0;
  const offer = (id: DailyOffer["id"]) => dailyOffers.find((item) => item.id === id);
  const active = (id: DailyOffer["id"]) => Boolean(offer(id)?.active);
  const title = (id: DailyOffer["id"], fallback: string) => offer(id)?.title || fallback;
  const deal = (kind: DealKind, label: string, extra: Partial<Deal> = {}): Deal => ({
    kind,
    label,
    discount: 0,
    freePick: false,
    pickValue: FREE_PICK_VALUE,
    pickUpTo: FREE_PICK_MAX_PRICE,
    gift: 0,
    freeDelivery: false,
    freebies: [],
    ...extra,
  });
  const gifts = (rupees: number) => (rupees ? [giftText(rupees)] : []);

  // [savings, deal] in priority order; ties keep the earlier one.
  const candidates: [number, Deal][] = [];
  if (active("bulk") && cart.subtotal > 20000) {
    const percent = offer("bulk")?.percent ?? OFFER_DEFAULTS.bulkPercent;
    const off = percentOff(cart.subtotal, percent);
    const waived = offer("bulk")?.freeDelivery ? fee : 0;
    const gift = offer("bulk")?.gift ?? 0;
    const bulk = deal("bulk", title("bulk", `Bulk order ${percent}% OFF`), { discount: off + waived, freeDelivery: waived > 0, gift, freebies: gifts(gift) });
    candidates.push([off + waived + gift * 100, bulk]);
  }
  if (active("first") && firstOrder) {
    const percent = offer("first")?.percent ?? OFFER_DEFAULTS.firstPercent;
    const off = percentOff(cart.subtotal, percent);
    candidates.push([off, deal("first", title("first", `First order ${percent}% OFF`), { discount: off })]);
  }
  if (active("tier100") && cart.subtotal >= 10000) {
    const upTo = offer("tier100")?.pickUpTo ?? null;
    const [pickValue, pickUpTo] = upTo === null ? [FREE_PICK_VALUE, FREE_PICK_MAX_PRICE] : [upTo, upTo];
    candidates.push([pickValue * 100, deal("tier100", title("tier100", "₹100+ Offer"), { freePick: true, pickValue, pickUpTo })]);
  } else if (active("tier50") && cart.subtotal >= 5000) {
    const gift = offer("tier50")?.gift ?? OFFER_DEFAULTS.tier50Gift;
    candidates.push([gift * 100, deal("tier50", title("tier50", "₹50+ Offer"), { gift, freebies: gifts(gift) })]);
  }

  if (coupon && couponStatus(coupon, cart, delivery, now).eligible) {
    const [savings, couponDeal] =
      coupon.kind === "freeSnack100"
        ? [coupon.amount * 100, deal("coupon", coupon.label, { freePick: true, pickValue: coupon.amount, pickUpTo: coupon.pickUpTo })]
        : (() => {
            const amount = Math.min(couponValue(coupon, rules.deliveryFee * 100), cart.subtotal + fee);
            return [amount, deal("coupon", coupon.label, { discount: amount })] as const;
          })();
    // A coupon that would save nothing here (free room delivery when delivery is already free) is kept.
    if (savings > 0 && couponRule === "coupon") return finish(cart.subtotal, fee, couponDeal);
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
