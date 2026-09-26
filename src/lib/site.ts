// Shop details the site admin sets at /admin: how to pay, whom to call, where to pick up, opening
// hours, which options are on and the price rules. Pages get them with the rest of their data and
// keep them fresh through /sync; these defaults (the shop's original details) only fill the first paint.
import { createContext, useContext } from "react";

import type { SiteDetails } from "./mart-types";
import type { PriceRules } from "./pricing";

export const DEFAULT_SITE: SiteDetails = {
  upiId: "7032767115@ibl",
  upiName: "Mavidi Rajendra Prasad",
  shopPhone: "7032767115",
  helpPhone: "9704535908",
  pickupPoint: "Block B, Room 618",
  openHour: 23,
  closeHour: 1,
  upiEnabled: true,
  cashEnabled: true,
  pickupEnabled: true,
  roomDeliveryEnabled: true,
  deliveryFee: 10,
  markup: 5,
};

export const SiteContext = createContext<SiteDetails>(DEFAULT_SITE);
export const useSite = () => useContext(SiteContext);

export const priceRules = (site: SiteDetails): PriceRules => ({
  markup: site.markup,
  deliveryFee: site.deliveryFee,
});

/** 23 -> "11:00 PM". */
export function hourLabel(hour: number): string {
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:00 ${hour < 12 ? "AM" : "PM"}`;
}

export const hoursLabel = (site: Pick<SiteDetails, "openHour" | "closeHour">) =>
  `${hourLabel(site.openHour)} – ${hourLabel(site.closeHour)}`;

/** "7032767115" -> "70327 67115". */
export const spacedPhone = (tenDigits: string) => `${tenDigits.slice(0, 5)} ${tenDigits.slice(5)}`;

/** A WhatsApp chat with the shop, with a ready-typed message. */
export const shopWhatsApp = (site: Pick<SiteDetails, "shopPhone">, message: string) =>
  `https://wa.me/91${site.shopPhone}?text=${encodeURIComponent(message)}`;
