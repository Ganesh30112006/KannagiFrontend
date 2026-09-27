export type Product = {
  id: number;
  name: string;
  emoji: string;
  mrp: number;
  stock: number;
  threshold: number;
  category: string;
  image?: string;
};

export type CouponKind =
  "free60" | "three5" | "freeSnack100" | "halfDelivery" | "four10" | "premium5";
export type Coupon = {
  code: string;
  label: string;
  shortLabel: string;
  icon: string;
  kind: CouponKind;
  expiresAt: number;
};

export type Delivery = "Pickup" | "Room Delivery";
export type Payment = "UPI" | "Pay on Delivery";
export type Block = "A" | "B" | "C";

export type Order = {
  id: number;
  orderNumber: number;
  createdAt: number;
  items: { name: string; qty: number; purchasePrice?: number }[];
  total: number;
  delivery: Delivery;
  details: string;
  payment: Payment;
  fulfilled: boolean;
  discount: number;
  discountLabel?: string;
  coupon?: string;
  utr?: string;
  /** UPI orders: the shopkeeper has seen the money arrive. */
  paymentConfirmed: boolean;
  /** Cancelled by the site admin: stock went back, and it no longer counts. */
  cancelled: boolean;
  onRequest: boolean;
  freebies: string[];
};

/** Who placed an order and where it goes (shopkeeper only). Any field may be missing on old orders. */
export type OrderCustomer = {
  name?: string;
  phone?: string;
  email?: string;
  block?: Block;
  room?: string;
};
export type AdminOrder = Order & { customer: OrderCustomer };

export type PlaceOrderInput = {
  items: { productId: number; quantity: number }[];
  delivery: Delivery;
  payment: Payment;
  utr?: string;
  freePick?: string;
  name?: string;
  phone?: string;
  block?: Block;
  room?: string;
  /** The total the customer saw; the server refuses the order if it no longer matches. */
  expectedTotal?: number;
};

export type DailyOffer = {
  id: "tier50" | "tier100" | "first" | "bulk";
  title: string;
  note: string;
  icon: string;
  active: boolean;
};
export type WheelPrize = {
  code: string;
  label: string;
  shortLabel: string;
  icon: string;
  kind: CouponKind | null;
  active: boolean;
};
/** Which reward applies when a spin coupon and an automatic offer both could: the bigger saving, or always the coupon. */
export type CouponRule = "best" | "coupon";
export type Promotions = {
  launchMessage: string;
  dailyOffers: DailyOffer[];
  wheelPrizes: WheelPrize[];
  couponRule: CouponRule;
};

export type StoreOverride = "auto" | "online" | "offline";
export type StoreStatus = { override: StoreOverride; online: boolean };

export type CustomerProfile = { fullName: string; phone: string; block: Block; roomNumber: string };

// Customers have an email; admins and shopkeepers have only a mobile number (and their own password).
/** email: a customer's username (nothing is ever emailed); phone: an admin's or shopkeeper's sign-in number; mobile: a customer's number.
 * isOwner: the main admin from the server settings (ADMIN_MOBILE), whose password is changed there. */
export type User = {
  id: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  isShopkeeper: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  firstOrderAvailable: boolean;
};

export type Wish = { name: string; count: number };
export type WishResult = Wish & { alreadyRequested: boolean };

export type SpinStatus = { spunToday: boolean; coupon?: Coupon | null };
export type SpinResult = {
  index: number;
  prize: WheelPrize;
  prizes: WheelPrize[];
  coupon?: Coupon | null;
};

/** Change counters per kind of shared data; the page sends back the ones it has to /sync. */
export type Revs = {
  catalog: number;
  orders: number;
  promotions: number;
  wishes: number;
  site: number;
};
/** What the page holds, as sent to /sync: -1 for data it doesn't have yet. */
export type KnownRevs = Revs & { adminOrders: number };

/** Everything the shop page shows on load, in one call. */
export type Bootstrap = {
  revs: Revs;
  site: SiteDetails;
  user: User;
  products: Product[];
  orders: Order[];
  profile: CustomerProfile | null;
  promotions: Promotions;
  store: StoreStatus;
  wishes: Wish[];
  spin: SpinStatus;
};
/** What can change while the page is open. */
export type Live = { products: Product[]; store: StoreStatus; spin: SpinStatus };
/** What changed since the revisions the page sent: store and coupon always, the rest only when changed. */
export type SyncResult = {
  revs: Revs;
  store: StoreStatus;
  spin: SpinStatus;
  site?: SiteDetails;
  products?: Product[];
  promotions?: Promotions;
  wishes?: Wish[];
  orders?: Order[];
  firstOrderAvailable?: boolean;
  admin?: { orders: AdminOrder[]; summary: SalesSummary; manualSales?: ManualSale[] };
};

/** Sales of one kind: how many (orders or manual sales), units sold, money in, and what the items cost
 * (their MRP). Profit is revenue - investment. */
export type SalesFigures = { count: number; items: number; revenue: number; investment: number };

/** All-time sales totals for the dashboard (computed by the database). revenue, investment and sold
 * cover online orders and manual sales together; online and manual split them. */
export type SalesSummary = {
  orderCount: number;
  revenue: number;
  investment: number;
  sold: { name: string; qty: number }[];
  online?: SalesFigures;
  manual?: SalesFigures;
};

export type ManualPayment = "Cash" | "UPI";

/** A sale made in person (at the shop's room), entered on the dashboard. */
export type ManualSale = {
  id: number;
  createdAt: number;
  items: { name: string; qty: number; price: number }[];
  total: number;
  investment: number;
  payment: ManualPayment;
  note?: string;
  /** The sign-in number of whoever entered it. */
  recordedBy?: string;
  /** Undone: entered by mistake, its items went back on the shelf and it no longer counts. */
  cancelled: boolean;
};

export type ManualSaleInput = {
  items: { productId: number; quantity: number }[];
  payment: ManualPayment;
  /** What was received; left out, the shop's prices. */
  amount?: number;
  note?: string;
};

/** What server functions return: errors come back as values so no stack traces reach the browser. */
export type Result<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

/** Shop details the site admin sets at /admin; every page uses them. Phones are 10 digits, hours
 * 0–23 (the automatic store status is online from openHour until closeHour), fee and markup rupees. */
export type SiteDetails = {
  upiId: string;
  upiName: string;
  /** The shop's own UPI QR image that customers scan; null: a QR made from upiId. */
  upiQr?: string | null;
  shopPhone: string;
  helpPhone: string;
  pickupPoint: string;
  openHour: number;
  closeHour: number;
  upiEnabled: boolean;
  cashEnabled: boolean;
  pickupEnabled: boolean;
  roomDeliveryEnabled: boolean;
  deliveryFee: number;
  markup: number;
};

/** Everything the site admin sets on the Shop details tab. */
export type SiteSettings = SiteDetails & { signupsOpen: boolean };
export type SiteAdminSettings = SiteSettings & { photoUploadsEnabled: boolean };

export type AdminUser = {
  id: string;
  email?: string;
  phone?: string;
  mobile?: string;
  isShopkeeper: boolean;
  isAdmin: boolean;
  /** The main admin from the server settings: can't be deleted, blocked or given a new password at /admin. */
  isOwner: boolean;
  blocked: boolean;
  createdAt: number;
  profile?: { fullName: string; phone: string; block: string; roomNumber: string };
  orderCount: number;
  spent: number;
  /** She asked for a new password (epoch ms). */
  resetRequestedAt?: number;
};

export type AdminOverview = {
  customers: number;
  shopkeepers: number;
  admins: number;
  blocked: number;
  ordersToday: number;
  manualSalesToday?: number;
  /** Paid online orders and manual sales. */
  revenueToday: number;
  openOrders: number;
  awaitingPayment: number;
  storeOnline: boolean;
  /** Customers waiting for a new password. */
  resetRequests: number;
};

export type AdminOrderStatus = "all" | "open" | "awaiting" | "fulfilled" | "cancelled";
export type AdminUserRole = "all" | "customers" | "shopkeepers" | "admins" | "blocked" | "resets";
export type StaffRole = "shopkeeper" | "admin";
