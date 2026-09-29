// Server functions: the only way the browser talks to the backend. The build replaces each one
// in the browser bundle with a same-origin RPC call; the handlers below run only on the server.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type {
  AdminOrder,
  AlertKey,
  AlertTest,
  Bootstrap,
  CustomerProfile,
  KnownRevs,
  Live,
  ManualSale,
  Order,
  Product,
  Promotions,
  Result,
  SalesSummary,
  SpinResult,
  SpinStatus,
  StoreStatus,
  SyncResult,
  User,
  Wish,
  WishResult,
} from "./mart-types";

const server = () => import("./backend.server");

// Mirrors the backend limits so bad input is rejected before it leaves the website server.
const text = (max: number) => z.string().trim().min(1).max(max);
// A 10-digit Indian mobile number, written any common way; the backend checks it properly.
const mobile = z.string().trim().min(10).max(20);
const block = z.enum(["A", "B", "C"]);
const image = z.string().max(3_000_000);
const couponKind = z.enum(["free60", "three5", "freeSnack100", "halfDelivery", "four10", "premium5"]);
const couponRule = z.enum(["best", "coupon"]);
const promotions = z.object({
  launchMessage: z.string().max(200),
  dailyOffers: z
    .array(
      z.object({
        id: z.enum(["tier50", "tier100", "first", "bulk"]),
        title: z.string().max(80),
        note: z.string().max(200),
        icon: z.string().max(16),
        active: z.boolean(),
        // What checkout gives (see DailyOffer in mart-types.ts).
        percent: z.number().int().min(0).max(100).nullish(),
        freeDelivery: z.boolean().nullish(),
        gift: z.number().int().min(0).max(1000).nullish(),
        pickUpTo: z.number().int().min(1).max(1000).nullish(),
      }),
    )
    .max(4),
  wheelPrizes: z
    .array(z.object({ code: text(20), label: text(80), shortLabel: z.string().max(80), icon: z.string().max(16), kind: couponKind.nullable(), active: z.boolean() }))
    .min(2)
    .max(16),
  couponRule,
});
const id = z.object({ id: z.number().int().positive() });

// --- session ---

/** Her mobile number is her username, and how the shop reaches her (it never sends messages or codes). */
export const signup = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ mobile, password: z.string().min(8).max(128) }).parse(data))
  .handler(async ({ data }): Promise<Result<User>> => {
    const { callBackend, startSession } = await server();
    const result = await callBackend<{ token: string; user: User }>("/auth/signup", "POST", data);
    if (!result.ok) return result;
    startSession(result.data.token);
    return { ok: true, data: result.data.user };
  });

/** A customer: her mobile number and password. */
export const login = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ mobile, password: z.string().min(1).max(128) }).parse(data))
  .handler(async ({ data }): Promise<Result<User>> => {
    const { callBackend, startSession } = await server();
    const result = await callBackend<{ token: string; user: User }>("/auth/login", "POST", data);
    if (!result.ok) return result;
    startSession(result.data.token);
    return { ok: true, data: result.data.user };
  });

export const logout = createServerFn({ method: "POST" }).handler(async (): Promise<Result<null>> => {
  const { endSession } = await server();
  endSession();
  return { ok: true, data: null };
});

/** The signed-in customer or shopkeeper, or null when signed out or the session expired. An admin
 * session counts as signed out on the shop's pages (the admin uses /admin). */
export const me = createServerFn({ method: "POST" }).handler(async (): Promise<Result<User | null>> => {
  const { callBackend, hasSession } = await server();
  if (!hasSession()) return { ok: true, data: null };
  const result = await callBackend<User>("/auth/me");
  if (!result.ok && result.status === 401) return { ok: true, data: null };
  if (result.ok && result.data.isAdmin) return { ok: true, data: null };
  return result;
});

/** Forgot password: asks the shop for a new one. Nothing is sent; the site admin sets it at /admin. */
export const forgotPassword = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ mobile }).parse(data))
  .handler(async ({ data }) => (await server()).callBackend<{ message: string }>("/auth/forgot-password", "POST", data));

/** A shopkeeper signs in with her mobile number and the password an admin gave her. */
export const shopkeeperLogin = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ phone: mobile, password: z.string().min(1).max(128) }).parse(data))
  .handler(async ({ data }): Promise<Result<User>> => {
    const { callBackend, startSession } = await server();
    const result = await callBackend<{ token: string; user: User }>("/auth/shopkeeper-login", "POST", data);
    if (!result.ok) return result;
    startSession(result.data.token);
    return { ok: true, data: result.data.user };
  });

// --- customer ---

export const getProfile = createServerFn({ method: "POST" }).handler(async () => (await server()).callBackend<CustomerProfile | null>("/profile"));

export const saveProfile = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ fullName: text(100), phone: text(20), block, roomNumber: text(20) }).parse(data))
  .handler(async ({ data }) => (await server()).callBackend<CustomerProfile>("/profile", "PUT", data));

export const getBootstrap = createServerFn({ method: "POST" }).handler(async () => (await server()).callBackend<Bootstrap>("/bootstrap"));
export const getLive = createServerFn({ method: "POST" }).handler(async () => (await server()).callBackend<Live>("/live"));

const rev = z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER);
/** Only what changed since the revisions the page already has. */
export const getSync = createServerFn({ method: "POST" })
  .validator((data: unknown): KnownRevs => z.object({ catalog: rev, orders: rev, adminOrders: rev, promotions: rev, wishes: rev, site: rev }).parse(data))
  .handler(async ({ data }) => {
    const query = new URLSearchParams(Object.entries(data).map(([name, value]) => [name, String(value)] as [string, string]));
    return (await server()).callBackend<SyncResult>(`/sync?${query}`);
  });

export const getProducts = createServerFn({ method: "POST" }).handler(async () => (await server()).callBackend<Product[]>("/products"));
export const getStore = createServerFn({ method: "POST" }).handler(async () => (await server()).callBackend<StoreStatus>("/store"));
export const getPromotions = createServerFn({ method: "POST" }).handler(async () => (await server()).callBackend<Promotions>("/promotions"));
export const getWishes = createServerFn({ method: "POST" }).handler(async () => (await server()).callBackend<Wish[]>("/wishes"));

export const addWish = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ name: text(60) }).parse(data))
  .handler(async ({ data }) => (await server()).callBackend<WishResult>("/wishes", "POST", data));

export const getSpinStatus = createServerFn({ method: "POST" }).handler(async () => (await server()).callBackend<SpinStatus>("/spin"));
export const spin = createServerFn({ method: "POST" }).handler(async () => (await server()).callBackend<SpinResult>("/spin", "POST"));

export const getMyOrders = createServerFn({ method: "POST" }).handler(async () => (await server()).callBackend<Order[]>("/orders"));

export const placeOrder = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(100) })).min(1).max(50),
        delivery: z.enum(["Pickup", "Room Delivery"]),
        payment: z.enum(["UPI", "Pay on Delivery"]),
        utr: z.string().trim().max(100).optional(),
        freePick: z.string().trim().max(80).optional(),
        name: z.string().trim().max(100).optional(),
        phone: z.string().trim().max(20).optional(),
        block: block.optional(),
        room: z.string().trim().max(20).optional(),
        expectedTotal: z.number().min(0).max(10_000_000).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => (await server()).callBackend<Order>("/orders", "POST", data));

/** After paying by UPI: the reference from her UPI app, so the shopkeeper can find the payment. */
export const reportPayment = createServerFn({ method: "POST" })
  .validator((data: unknown) => id.extend({ utr: z.string().trim().min(1).max(100) }).parse(data))
  .handler(async ({ data }) => (await server()).callBackend<Order>(`/orders/${data.id}/utr`, "POST", { utr: data.utr }));

// --- shopkeeper (the backend checks the role on every call) ---

export const adminOrders = createServerFn({ method: "POST" }).handler(async () => (await server()).callBackend<AdminOrder[]>("/admin/orders?limit=100"));
export const adminSummary = createServerFn({ method: "POST" }).handler(async () => (await server()).callBackend<SalesSummary>("/admin/summary"));

export const fulfillOrder = createServerFn({ method: "POST" })
  // paymentReceived: a UPI order whose payment isn't ticked yet, and the shopkeeper says the money arrived.
  .validator((data: unknown) => id.extend({ paymentReceived: z.boolean().optional() }).parse(data))
  .handler(async ({ data }) => (await server()).callBackend<AdminOrder>(`/admin/orders/${data.id}/fulfill`, "POST", { paymentReceived: data.paymentReceived === true }));

export const setPaymentReceived = createServerFn({ method: "POST" })
  .validator((data: unknown) => id.extend({ received: z.boolean() }).parse(data))
  .handler(async ({ data }) => (await server()).callBackend<AdminOrder>(`/admin/orders/${data.id}/payment`, "POST", { received: data.received }));

export const unfulfillOrder = createServerFn({ method: "POST" })
  .validator((data: unknown) => id.parse(data))
  .handler(async ({ data }) => (await server()).callBackend<AdminOrder>(`/admin/orders/${data.id}/unfulfill`, "POST"));

export const createProduct = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ name: text(80), mrp: z.number().positive().max(100_000), stock: z.number().int().min(0).max(100_000), image: image.optional() }).parse(data))
  .handler(async ({ data }) => (await server()).callBackend<Product>("/admin/products", "POST", data));

export const updateProduct = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    id
      .extend({
        changes: z.object({
          stock: z.number().int().min(0).max(100_000).optional(),
          stockDelta: z.number().int().min(-100_000).max(100_000).optional(),
          threshold: z.number().int().min(0).max(100_000).optional(),
          mrp: z.number().positive().max(100_000).optional(),
          image: image.nullable().optional(),
        }),
      })
      .parse(data),
  )
  .handler(async ({ data }) => (await server()).callBackend<Product>(`/admin/products/${data.id}`, "PATCH", data.changes));

export const deleteProduct = createServerFn({ method: "POST" })
  .validator((data: unknown) => id.parse(data))
  .handler(async ({ data }) => (await server()).callBackend<null>(`/admin/products/${data.id}`, "DELETE"));

export const savePromotions = createServerFn({ method: "POST" })
  .validator((data: unknown) => promotions.parse(data))
  .handler(async ({ data }) => (await server()).callBackend<Promotions>("/admin/promotions", "PUT", data));

/** A sale made in person: its items come off the stock and it counts in sales and profit. */
export const recordManualSale = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(1000) })).min(1).max(50),
        payment: z.enum(["Cash", "UPI"]),
        amount: z.number().min(0).max(100_000).optional(),
        note: z.string().trim().max(100).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => (await server()).callBackend<ManualSale>("/admin/manual-sales", "POST", data));

/** A manual sale entered by mistake: its items go back on the shelf and it stops counting. */
export const undoManualSale = createServerFn({ method: "POST" })
  .validator((data: unknown) => id.parse(data))
  .handler(async ({ data }) => (await server()).callBackend<ManualSale>(`/admin/manual-sales/${data.id}/undo`, "POST"));

export const setStore = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ override: z.enum(["auto", "online", "offline"]) }).parse(data))
  .handler(async ({ data }) => (await server()).callBackend<StoreStatus>("/admin/store", "PUT", data));

// --- order alerts on this device (shopkeepers and admins; see order-alerts.ts) ---

// A browser's push address (the backend accepts only the browsers' push services).
const endpoint = z.object({ endpoint: z.string().trim().url().max(1000) });

export const getAlertKey = createServerFn({ method: "POST" }).handler(async () => (await server()).callBackend<AlertKey>("/alerts/key"));

export const turnOnAlerts = createServerFn({ method: "POST" })
  .validator((data: unknown) => endpoint.extend({ keys: z.object({ p256dh: z.string().trim().min(1).max(200), auth: z.string().trim().min(1).max(100) }) }).parse(data))
  .handler(async ({ data }) => (await server()).callBackend<null>("/alerts/device", "PUT", data));

export const turnOffAlerts = createServerFn({ method: "POST" })
  .validator((data: unknown) => endpoint.parse(data))
  .handler(async ({ data }) => (await server()).callBackend<null>("/alerts/device/off", "POST", data));

export const testAlert = createServerFn({ method: "POST" })
  .validator((data: unknown) => endpoint.parse(data))
  .handler(async ({ data }) => (await server()).callBackend<AlertTest>("/alerts/test", "POST", data));
