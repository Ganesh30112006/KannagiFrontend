// Browser-side client. Every call goes to a same-origin server function (see mart.functions.ts);
// the browser never learns the backend's address and never holds the login token.
import { write } from "./live-sync";
import * as fn from "./mart.functions";
import type { CustomerProfile, KnownRevs, ManualSaleInput, OrderRequestInput, PlaceOrderInput, Product, Promotions, Result, StoreOverride } from "./mart-types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Fired when the server says the session is over (expired, password changed, blocked or deleted), so a
 * page that stays open, like /admin, can go back to its sign-in. */
export const SIGNED_OUT = "knm-signed-out";

export async function unwrap<T>(call: Promise<Result<T>>): Promise<T> {
  let result: Result<T>;
  try {
    result = await call;
  } catch (error) {
    // fetch() itself failing (offline, server down) is a TypeError. Anything else came back from the
    // website server: input its checks (zod) refused, whose message is the list of problems ("[{...}]"),
    // or a fault on the server, which is not the visitor's doing.
    if (error instanceof TypeError) throw new ApiError("Couldn't reach the Night Mart. Check your connection and try again.", 0);
    const refused = error instanceof Error && (error.name === "ZodError" || /^\s*\[\s*\{/.test(error.message));
    if (refused) throw new ApiError("That didn't go through. Please check what you entered and try again.", 400);
    throw new ApiError("Something went wrong on our side. Please try again in a moment.", 500);
  }
  if (!result.ok) {
    if (result.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event(SIGNED_OUT));
    throw new ApiError(result.message, result.status);
  }
  return result.data;
}

/** A call that changes shared data: open pages (this tab and the others) sync once it's done. */
export const change = <T>(call: () => Promise<Result<T>>) => write(() => unwrap(call()));

export const api = {
  signup: (mobile: string, password: string) => unwrap(fn.signup({ data: { mobile, password } })),
  login: (mobile: string, password: string) => unwrap(fn.login({ data: { mobile, password } })),
  /** Signing out also turns this device's order alerts off (for up to 3 seconds; then it signs out anyway). */
  logout: async () => {
    const alertsOff = import("./order-alerts").then((alerts) => alerts.forgetThisDevice());
    await Promise.race([alertsOff.catch(() => undefined), new Promise((done) => setTimeout(done, 3000))]);
    return unwrap(fn.logout());
  },
  /** The signed-in user, or null. */
  me: () => unwrap(fn.me()),
  shopkeeperLogin: (phone: string, password: string) => unwrap(fn.shopkeeperLogin({ data: { phone, password } })),
  forgotPassword: (mobile: string) => unwrap(fn.forgotPassword({ data: { mobile } })),

  profile: () => unwrap(fn.getProfile()),
  saveProfile: (profile: CustomerProfile) => unwrap(fn.saveProfile({ data: profile })),

  bootstrap: () => unwrap(fn.getBootstrap()),
  live: () => unwrap(fn.getLive()),
  /** Only what changed since the revisions the page already has. */
  sync: (revs: KnownRevs) => unwrap(fn.getSync({ data: revs })),
  products: () => unwrap(fn.getProducts()),
  store: () => unwrap(fn.getStore()),
  promotions: () => unwrap(fn.getPromotions()),
  wishes: () => unwrap(fn.getWishes()),
  addWish: (name: string) => change(() => fn.addWish({ data: { name } })),

  spinStatus: () => unwrap(fn.getSpinStatus()),
  spin: () => change(() => fn.spin()),

  myOrders: () => unwrap(fn.getMyOrders()),
  reportPayment: (id: number, utr: string) => change(() => fn.reportPayment({ data: { id, utr } })),
  placeOrder: (input: PlaceOrderInput) => change(() => fn.placeOrder({ data: input })),
  /** While the shop isn't taking orders: ask for what's in the cart instead. */
  sendOrderRequest: (input: OrderRequestInput) => change(() => fn.sendOrderRequest({ data: input })),
  withdrawOrderRequest: () => change(() => fn.withdrawOrderRequest()),

  admin: {
    orders: () => unwrap(fn.adminOrders()),
    summary: () => unwrap(fn.adminSummary()),
    /** paymentReceived: also confirms an unticked UPI payment (the shopkeeper says the money arrived). */
    fulfillOrder: (id: number, paymentReceived = false) => change(() => fn.fulfillOrder({ data: { id, paymentReceived } })),
    unfulfillOrder: (id: number) => change(() => fn.unfulfillOrder({ data: { id } })),
    /** Admins only (the API checks). */
    removeWish: (name: string) => change(() => fn.removeWish({ data: { name } })),
    setPaymentReceived: (id: number, received: boolean) => change(() => fn.setPaymentReceived({ data: { id, received } })),
    createProduct: (product: { name: string; mrp: number; markup?: number; stock: number; category?: string; image?: string }) => change(() => fn.createProduct({ data: product })),
    updateProduct: (id: number, changes: { stock?: number; stockDelta?: number; shelf?: number; threshold?: number; mrp?: number; markup?: number; category?: string; image?: string | null }) =>
      change<Product>(() => fn.updateProduct({ data: { id, changes } })),
    deleteProduct: (id: number) => change(() => fn.deleteProduct({ data: { id } })),
    giveGift: (id: number, index: number, productId: number | null) => change(() => fn.giveGift({ data: { id, index, productId } })),
    cancelOrder: (id: number) => change(() => fn.cancelOrder({ data: { id } })),
    savePromotions: (promotions: Promotions) => change(() => fn.savePromotions({ data: promotions })),
    switchWheel: (enabled: boolean) => change(() => fn.switchWheel({ data: { enabled } })),
    setStore: (override: StoreOverride) => change(() => fn.setStore({ data: { override } })),
    switchOfflineOrders: (enabled: boolean) => change(() => fn.switchOfflineOrders({ data: { enabled } })),
    finishOrderRequest: (id: number) => change(() => fn.finishOrderRequest({ data: { id } })),
    recordManualSale: (sale: ManualSaleInput) => change(() => fn.recordManualSale({ data: sale })),
    undoManualSale: (id: number) => change(() => fn.undoManualSale({ data: { id } })),
  },
};
