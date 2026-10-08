// The shop, order history and shopkeeper dashboard (routes /shop and /dashboard; the site admin's
// /admin shows it too).
// Kept out of the route files so the router can code-split them.
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Bell,
  Camera,
  Check,
  ChevronDown,
  ClipboardCopy,
  Gift,
  Heart,
  Hourglass,
  History,
  ImagePlus,
  Inbox,
  LayoutDashboard,
  LockKeyhole,
  MessageCircle,
  Minus,
  PackagePlus,
  LogOut,
  Phone,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  Send,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Store,
  TrendingUp,
  Trash2,
  X,
} from "lucide-react";
import { toast, Toaster } from "sonner";

import cozySnackGirl from "@/assets/cozy-snack-girl.webp";
import periodComfortGirl from "@/assets/period-comfort-girl.webp";
import weekendMovieGirls from "@/assets/weekend-movie-girls.webp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ManualSalePanel, SalesSummaryPanel } from "@/components/sales-panels";
import { NotificationsCard, OrderAlertsCard } from "@/components/order-alerts-card";
import { api, ApiError } from "@/lib/api";
import { useNewRelease } from "@/lib/app-release";
import { staleSince, useLiveSync, writeMark } from "@/lib/live-sync";
import { ROLE_KEY } from "@/lib/login-role";
import { callLink, formatMobile, isMobile, whatsappChat } from "@/lib/phone";
import { DEFAULT_SITE, hoursLabel, priceRules, shopWhatsApp, SiteContext, spacedPhone, useSite } from "@/lib/site";
import { upiPayLink } from "@/lib/upi";
import { cartSummary, COUPON_DEFAULTS, couponStatus, FREE_PICK_MAX_PRICE, FREE_PICK_VALUE, isDeliveryCoupon, isEggProduct, lineTotal, money, OFFER_DEFAULTS, PREMIUM_ITEMS, PREMIUM_PRICE, prizeTerms, prizeText, quote, toRupees } from "@/lib/pricing";
import type {
  AdminOrder,
  Block,
  Coupon,
  CouponRule,
  CouponKind,
  CustomerProfile,
  DailyOffer,
  Delivery,
  KnownRevs,
  Loyalty,
  ManualSale,
  Order,
  OrderRequest,
  OrderRequestInput,
  Payment,
  PlaceOrderInput,
  Product,
  Promotions,
  SalesSummary,
  SiteDetails,
  SpinResult,
  StoreOverride,
  StoreStatus,
  SyncResult,
  User,
  WheelPrize,
  Wish,
} from "@/lib/mart-types";


// Refresh stock, store status and incoming orders this often.
// How often an open page checks for changes. A check with nothing new is a few bytes, and a change
// made on this device (or another tab) syncs at once, so these are only for other people's changes.
const SYNC_MS = 10_000;
const DASHBOARD_SYNC_MS = 5_000; // new orders reach the shopkeeper within seconds
const PAYMENT_SYNC_MS = 4_000; // a customer waiting for the shopkeeper to confirm her UPI payment
const BACKGROUND_DASHBOARD_SYNC_MS = 30_000; // the shopkeeper's page in a background tab
const NO_REVS: KnownRevs = { catalog: -1, orders: -1, adminOrders: -1, promotions: -1, wishes: -1, site: -1 };

const orderLabel = (order: Order) => `#${String(order.orderNumber).padStart(4, "0")}`;
/** Shelf sections the shopkeeper picks from (any other a product already has is kept). */
const CATEGORIES = ["Snacks", "Chips", "Chocolates", "Biscuits", "Noodles", "Drinks", "Sweets", "Essentials"];
const categoryOptions = (current?: string) => (current && !CATEGORIES.includes(current) ? [...CATEGORIES, current] : CATEGORIES);
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;



const emptyProfile: CustomerProfile = { fullName: "", phone: "", block: "A", roomNumber: "" };

/** embedded: inside /admin's console, which shows Order alerts and watches for new releases itself. */
export function ShopPage({ user, initialMode = "customer", signedOutTo = "/", embedded = false }: { user: User; initialMode?: "customer" | "history" | "admin"; signedOutTo?: "/" | "/admin"; embedded?: boolean }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"customer" | "spin" | "history" | "admin">(initialMode);
  const [adminUnlocked, setAdminUnlocked] = useState(user.isShopkeeper);
  // The shopkeeper's page stays open for days (a Home Screen app never reloads): pick up new releases.
  useNewRelease(adminUnlocked && !embedded);
  const [loaded, setLoaded] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [wishes, setWishes] = useState<Wish[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [adminOrders, setAdminOrders] = useState<AdminOrder[]>([]);
  // While the shop isn't taking orders: her request (customers), everyone's requests (the shop).
  const [myRequest, setMyRequest] = useState<OrderRequest | null>(null);
  const [orderRequests, setOrderRequests] = useState<OrderRequest[]>([]);
  const newestRequestAt = useRef<number | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [wishInput, setWishInput] = useState("");
  const [wishMessage, setWishMessage] = useState("");
  const [store, setStore] = useState<StoreStatus | null>(null);
  const [coupon, setCoupon] = useState<Coupon | null>(null);
  const [spun, setSpun] = useState(false);
  const [firstOrder, setFirstOrder] = useState(user.firstOrderAvailable);
  const [receipt, setReceipt] = useState<Order | null>(null);
  // A UPI order that has been placed and is waiting for her to pay.
  const [paying, setPaying] = useState<Order | null>(null);
  // Until she saves her hostel details, the form starts with the mobile number she signed up with.
  const [profile, setProfile] = useState<CustomerProfile>({ ...emptyProfile, phone: user.mobile ?? "" });
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  // The shop's own offers and banner arrive with the first load; nothing made-up shows before.
  const [launchMessage, setLaunchMessage] = useState("");
  const [dailyOffers, setDailyOffers] = useState<DailyOffer[]>([]);
  const [wheelRewards, setWheelRewards] = useState<WheelPrize[]>([]);
  const [couponRule, setCouponRule] = useState<CouponRule>("best");
  // Spin & Win switched on for customers (the shopkeeper switches it at once, apart from Save).
  const [wheelEnabled, setWheelEnabled] = useState(true);
  const [salesSummary, setSalesSummary] = useState<SalesSummary | null>(null);
  const [manualSales, setManualSales] = useState<ManualSale[]>([]);
  // Shop details the site admin sets (UPI, contacts, hours, options, prices).
  const [site, setSite] = useState<SiteDetails>(DEFAULT_SITE);
  const newestOrderId = useRef<number | null>(null);
  // What the page has, as revisions: /sync sends back only what changed since.
  const revs = useRef<KnownRevs>(NO_REVS);
  // Offer edits the shopkeeper hasn't saved yet; syncing never overwrites them. (The ref for syncing, the
  // state to show "not saved yet".)
  const promotionsDirty = useRef(false);
  const [promotionsUnsaved, setPromotionsUnsaved] = useState(false);
  const ordersRef = useRef<Order[]>([]);
  ordersRef.current = orders;
  const payingRef = useRef<Order | null>(null);
  payingRef.current = paying;
  const [justPlacedId, setJustPlacedId] = useState<number | null>(null);
  // Her loyalty card (stamps and rewards), from the server.
  const [loyalty, setLoyalty] = useState<Loyalty | null>(null);

  const applyPromotions = useCallback((promotions: Promotions) => {
    promotionsDirty.current = false;
    setPromotionsUnsaved(false);
    setLaunchMessage(promotions.launchMessage);
    setDailyOffers(promotions.dailyOffers);
    setWheelRewards(promotions.wheelPrizes);
    setCouponRule(promotions.couponRule);
    setWheelEnabled(promotions.wheelEnabled ?? true);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const data = await api.bootstrap();
      // The shopkeeper's order list isn't part of the bootstrap: the first sync brings it.
      revs.current = { ...data.revs, adminOrders: revs.current.adminOrders };
      setSite(data.site);
      setAdminUnlocked(data.user.isShopkeeper);
      setFirstOrder(data.user.firstOrderAvailable);
      setProducts(data.products);
      setOrders(data.orders);
      setMyRequest(data.myRequest ?? null);
      if (data.profile) { setProfile(data.profile); setProfileSaved(true); }
      // Customers are asked once for their hostel details; the shopkeeper isn't (she runs the shop).
      else if (!data.user.isShopkeeper) setProfileOpen(true);
      applyPromotions(data.promotions);
      setStore(data.store);
      setWishes(data.wishes);
      setSpun(data.spin.spunToday);
      setCoupon(data.spin.coupon ?? null);
      setLoyalty(data.loyalty ?? null);
      setLoaded(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) void navigate({ to: signedOutTo, replace: true });
      else toast.error(errorText(error, "Could not load the shop."));
    }
  }, [navigate, applyPromotions, signedOutTo]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // One call brings whatever changed since the page last looked: stock, offers, wishes, her orders and,
  // for the shopkeeper, incoming orders and sales figures. Store status and her coupon always come along.
  async function syncNow() {
    const mark = writeMark();
    let data: SyncResult;
    try {
      data = await api.sync(revs.current);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) void navigate({ to: signedOutTo, replace: true });
      throw error;
    }
    // A change from this tab overlapped this reply, which may predate it: drop the reply rather than
    // briefly undo the change on screen. The sync that change triggers brings everything.
    if (staleSince(mark)) return;
    if (data.site) setSite(data.site);
    setStore(data.store);
    setSpun(data.spin.spunToday);
    setCoupon(data.spin.coupon ?? null);
    if (data.products) setProducts(data.products);
    if (data.wishes) setWishes(data.wishes);
    if (data.loyalty) setLoyalty(data.loyalty);
    if (data.promotions) {
      if (!promotionsDirty.current) applyPromotions(data.promotions);
      else {
        // The on/off switch isn't part of Save, so it always follows.
        setWheelEnabled(data.promotions.wheelEnabled ?? true);
        toast.info("Offers were changed on another device. Saving here will replace them.", { id: "offers-changed", duration: 8000 });
      }
    }
    if (data.orders) {
      const latest = data.orders;
      const waiting = ordersRef.current.filter(awaitingConfirmation);
      for (const order of latest) {
        if (order.paymentConfirmed && waiting.some((w) => w.id === order.id)) toast.success(`Payment confirmed! Order ${orderLabel(order)} is confirmed.`, { duration: 8000 });
      }
      setOrders(latest);
      // An open receipt shows the order as it is now.
      setReceipt((current) => (current && latest.find((order) => order.id === current.id)) ?? current);
      const payingNow = payingRef.current && latest.find((order) => order.id === payingRef.current?.id);
      if (payingNow?.paymentConfirmed) { setPaying(null); setReceipt(payingNow); }
      if (data.firstOrderAvailable !== undefined) setFirstOrder(data.firstOrderAvailable);
    }
    if (data.myRequest !== undefined) setMyRequest(data.myRequest);
    if (data.admin) {
      const rows = data.admin.orders;
      const newest = rows[0]?.id ?? 0;
      if (newestOrderId.current !== null && newest > newestOrderId.current) {
        toast.info("A new order arrived!", { duration: 15_000 });
        navigator.vibrate?.(200);
      }
      newestOrderId.current = newest;
      setAdminOrders(rows);
      setSalesSummary(data.admin.summary);
      if (data.admin.manualSales) setManualSales(data.admin.manualSales);
      if (data.admin.requests) {
        const latest = Math.max(0, ...data.admin.requests.map((request) => request.createdAt));
        if (newestRequestAt.current !== null && latest > newestRequestAt.current) {
          toast.info("A customer sent an order request!", { duration: 15_000 });
          navigator.vibrate?.(200);
        }
        newestRequestAt.current = latest;
        setOrderRequests(data.admin.requests);
      }
    }
    revs.current = { ...data.revs, adminOrders: data.admin ? data.revs.orders : revs.current.adminOrders };
  }

  const onDashboard = adminUnlocked && mode === "admin";
  const paymentPending = orders.some((order) => awaitingConfirmation(order) && Boolean(order.utr));
  useLiveSync(syncNow, {
    enabled: loaded,
    everyMs: onDashboard ? DASHBOARD_SYNC_MS : paymentPending ? PAYMENT_SYNC_MS : SYNC_MS,
    hiddenEveryMs: adminUnlocked ? BACKGROUND_DASHBOARD_SYNC_MS : null,
  });

  useEffect(() => {
    if (!coupon) return;
    const delay = coupon.expiresAt - Date.now();
    if (delay <= 0) { setCoupon(null); return; }
    const timer = window.setTimeout(() => setCoupon(null), delay);
    return () => window.clearTimeout(timer);
  }, [coupon]);

  const storeOnline = store?.online ?? false;
  // Offline, the shop may still take orders (on request), or only requests.
  const takingOrders = storeOnline || store?.offlineOrders !== false;

  // Clamp to current stock so a restock/sale elsewhere never leaves the cart over the limit.
  const cartItems = useMemo(
    () => products.map((product) => ({ ...product, qty: Math.min(cart[product.id] ?? 0, product.stock) })).filter((item) => item.qty > 0),
    [cart, products],
  );
  const itemCount = cartItems.reduce((sum, item) => sum + item.qty, 0);
  const unpaid = orders.find((order) => needsPayment(order) && !order.fulfilled);
  const subtotal = toRupees(cartSummary(cartItems.map((item) => ({ product: item, qty: item.qty }))).subtotal);

  function openDashboard() {
    setMode("admin");
    void navigate({ to: "/dashboard" });
  }

  // Shopkeepers sign in with their mobile number on the sign-in page's Shopkeeper tab.
  async function signInAsShopkeeper() {
    try { localStorage.setItem(ROLE_KEY, "shopkeeper"); } catch { /* private window */ }
    await signOut();
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isMobile(profile.phone)) { toast.error("Enter a 10-digit mobile number."); return; }
    try {
      setProfile(await api.saveProfile(profile));
      setProfileSaved(true);
      setProfileOpen(false);
      toast.success("Your details are saved.");
    } catch (error) {
      toast.error(errorText(error, "Could not save your details."));
    }
  }

  async function signOut() {
    await api.logout().catch(() => undefined);
    void navigate({ to: signedOutTo, replace: true });
  }

  function updateCart(id: number, delta: number) {
    const product = products.find((item) => item.id === id);
    if (!product) return;
    setCart((current) => ({ ...current, [id]: Math.max(0, Math.min(product.stock, (current[id] ?? 0) + delta)) }));
  }

  async function submitWish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const item = wishInput.trim();
    if (!item) return;
    try {
      const result = await api.addWish(item);
      const others = result.count - 1;
      setWishMessage(
        result.onShelf
          ? `Good news: ${result.name} is on the shelf right now! 🎉`
          : result.alreadyRequested
          ? `You already asked for ${result.name} — ${plural(result.count, "request")} so far 💖`
          : others > 0
            ? `${others} other ${others === 1 ? "girl also wants" : "girls also want"} this 💖`
            : "Request received! 💖",
      );
      setWishInput("");
    } catch (error) {
      toast.error(errorText(error, "Could not send your request."));
    }
  }

  /** Admins only (the API checks): takes an item's line off the wishlist, every customer's request for it. */
  async function removeWish(name: string) {
    if (!window.confirm(`Remove "${name}" from the wishlist requests? Every customer's request for it goes.`)) return;
    try {
      await api.admin.removeWish(name);
      setWishes((current) => current.filter((wish) => wish.name !== name));
      toast.success(`"${name}" removed from the requests.`);
    } catch (error) {
      toast.error(errorText(error, "Could not remove the request."));
    }
  }

  /** A past order's items back in the cart (as many as are on the shelf), then the cart opens. */
  function orderAgain(order: Order) {
    const onShelf = new Map(products.filter((product) => product.stock > 0).map((product) => [product.name, product]));
    const next = { ...cart };
    const added: string[] = [];
    const gone: string[] = [];
    for (const item of order.items) {
      const product = onShelf.get(item.name);
      const have = product ? next[product.id] ?? 0 : 0;
      if (!product || have >= product.stock) { gone.push(item.name); continue; }
      next[product.id] = Math.min(product.stock, have + item.qty);
      added.push(item.name);
    }
    if (!added.length) { toast.error(`None of order ${orderLabel(order)}'s items are on the shelf right now.`); return; }
    setCart(next);
    setMode("customer");
    setCartOpen(true);
    if (gone.length) toast.info(`Not on the shelf right now: ${gone.join(", ")}.`, { duration: 6000 });
  }

  function finishSpin(result: SpinResult) {
    setSpun(true);
    setCoupon(result.coupon ?? null);
  }

  /** A setter for an offers field that also marks the offers as edited but not saved. */
  function edited<T>(set: (value: T) => void) {
    return (value: T) => { promotionsDirty.current = true; setPromotionsUnsaved(true); set(value); };
  }

  /** Spin & Win on or off for customers, saved at once. */
  async function switchWheel(enabled: boolean) {
    try {
      const saved = await api.admin.switchWheel(enabled);
      setWheelEnabled(saved.wheelEnabled ?? enabled);
      toast.success(enabled ? "Spin & Win is on: customers can spin again." : "Spin & Win is off: customers don't see the wheel. Coupons already won still work.");
    } catch (error) {
      toast.error(errorText(error, "Could not switch the wheel."));
    }
  }

  async function changeOverride(override: StoreOverride) {
    try {
      setStore(await api.admin.setStore(override));
    } catch (error) {
      toast.error(errorText(error, "Could not update the store status."));
    }
  }

  async function switchOfflineOrders(enabled: boolean) {
    try {
      setStore(await api.admin.switchOfflineOrders(enabled));
      toast.success(enabled ? "While offline, customers can order (on request)." : "While offline, customers send a request instead of ordering.");
    } catch (error) {
      toast.error(errorText(error, "Could not change that."));
    }
  }

  async function finishOrderRequest(request: OrderRequest) {
    try {
      await api.admin.finishOrderRequest(request.id);
      setOrderRequests((current) => current.filter((item) => item.id !== request.id));
    } catch (error) {
      toast.error(errorText(error, "Could not mark the request done."));
    }
  }

  async function withdrawRequest() {
    try {
      await api.withdrawOrderRequest();
      setMyRequest(null);
      toast.success("Request withdrawn.");
    } catch (error) {
      toast.error(errorText(error, "Could not withdraw the request."));
    }
  }

  return (
    <SiteContext.Provider value={site}>
    <main className="min-h-screen bg-background pb-24 text-foreground">
      {/* First thing on the page, so a shopkeeper sees it without scrolling. */}
      {adminUnlocked && !embedded && <OrderAlertsCard />}
      <header className="night-sky relative overflow-hidden border-b-4 border-primary">
        {[[7, 13], [18, 42], [46, 9], [88, 13], [73, 56], [94, 67]].map(([left, top], index) => (
          <span key={`${left}-${top}`} className="twinkle absolute text-xl text-accent" style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${index * 0.5}s` }}>{index % 2 ? "✦" : "★"}</span>
        ))}
        <span aria-hidden="true" className="absolute left-[7%] top-24 text-6xl text-accent sm:text-8xl">☾</span>
        <span aria-hidden="true" className="absolute right-[46%] top-20 rotate-12 font-hand text-4xl text-secondary">♡</span>
        <div className="relative mx-auto max-w-6xl px-4 pb-7 pt-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-3">
            <p className="whitespace-nowrap font-hand text-base font-bold text-secondary sm:text-xl">By Girls ♡ For Girls</p>
            <div className="flex gap-2">{adminUnlocked && <Button variant="outline" size="sm" onClick={openDashboard} className="border-secondary/50 bg-card/90 text-foreground shadow-sm backdrop-blur"><LayoutDashboard /><span className="hidden sm:inline">Dashboard</span></Button>}<Button variant="outline" size="icon" onClick={signOut} aria-label="Sign out"><LogOut /></Button></div>
          </div>

          <div className="mt-4 min-h-11">
            {store && (
              <p className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold shadow-[3px_4px_0_var(--shadow-color)] ${storeOnline ? "bg-stock text-stock-foreground" : "bg-accent text-accent-foreground"}`}>
                {storeOnline ? "🟢 Store is ONLINE — Midnight Craving Service Active!" : takingOrders ? "🌙 Store Offline — Orders available on request when shopkeeper is around!" : "🌙 Store Offline — not taking orders right now. Send the shop a request from your cart!"}
              </p>
            )}
            {myRequest && !adminUnlocked && <MyRequestNote request={myRequest} takingOrders={takingOrders} onWithdraw={() => void withdrawRequest()} />}
            {unpaid && !paying && <div role="status" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-card/95 px-4 py-3 text-sm font-semibold text-foreground shadow-[3px_4px_0_var(--shadow-color)]"><p className="min-w-0 flex-1 basis-60">💳 Order {orderLabel(unpaid)} is waiting for your UPI payment of {money(unpaid.total)}.</p><Button size="sm" onClick={() => setPaying(unpaid)}>Pay now</Button></div>}
          </div>

          <div className="mt-6 grid items-end gap-6 md:grid-cols-[1fr_.72fr]">
            <div className="paint-card relative z-10 -rotate-1 bg-banner px-5 py-7 shadow-[7px_8px_0_var(--shadow-color)] sm:px-8 sm:py-9">
              <p className="font-hand text-xl font-bold text-foreground">Same Cravings, Different Time. We&apos;ve Got You!</p>
              <h1 className="mt-1 font-display text-5xl font-extrabold leading-[.88] text-foreground sm:text-7xl"><span>Kannagi</span><span className="block text-primary">Night Mart</span></h1>
              <div className="mt-5 -rotate-1 bg-accent px-4 py-3 text-center font-hand text-lg font-bold text-accent-foreground sm:text-xl">For Every Girl&apos;s Midnight Cravings<br className="hidden sm:block" /> at Affordable Prices ♡</div>
            </div>
            <div className="relative mx-auto hidden w-full max-w-sm md:block">
              <div className="absolute -left-5 -top-7 rotate-[-8deg] font-hand text-2xl text-secondary">Good food,<br />happier nights ♡</div>
              <img src={cozySnackGirl} alt="Girl enjoying chips during a cozy hostel night" width={800} height={800} loading="lazy" decoding="async" className="aspect-square w-full rounded-full border-4 border-secondary object-cover shadow-[7px_8px_0_var(--shadow-color)]" />
            </div>
          </div>
          <p className="mt-6 inline-block max-w-full whitespace-nowrap -rotate-1 bg-accent px-2 py-2 font-hand text-[clamp(.75rem,3.2vw,1.125rem)] font-bold text-accent-foreground shadow-sm sm:px-4">Available to Kannagi Hostel · Blocks A, B &amp; C</p>
          <p className="mt-3 text-sm font-semibold text-secondary">{site.pickupPoint} · Call or WhatsApp <a className="underline" href={shopWhatsApp(site, "Hi! I have a question about Kannagi Night Mart.")} target="_blank" rel="noopener noreferrer">+91 {spacedPhone(site.shopPhone)}</a></p>
        </div>
      </header>

      <nav aria-label="View selector" className="sticky top-0 z-30 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto grid max-w-2xl grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-1 rounded-md border border-border bg-card p-1 shadow-sm">
          <Button variant={mode === "customer" ? "default" : "ghost"} className="h-auto min-h-9 gap-1 whitespace-normal px-1 text-xs leading-tight sm:gap-2 sm:px-4 sm:text-sm [&_svg]:hidden sm:[&_svg]:block" onClick={() => { setMode("customer"); void navigate({ to: "/shop" }); }}><ShoppingBag /> Customer Shop</Button>
          {(wheelEnabled || mode === "spin") && <Button variant={mode === "spin" ? "default" : "ghost"} className="h-auto min-h-9 gap-1 whitespace-normal px-1 text-xs leading-tight sm:gap-2 sm:px-4 sm:text-sm [&_svg]:hidden sm:[&_svg]:block" onClick={() => setMode("spin")}><Sparkles /> Spin &amp; Win</Button>}
          <Button variant={mode === "history" ? "default" : "ghost"} className="h-auto min-h-9 gap-1 whitespace-normal px-1 text-xs leading-tight sm:gap-2 sm:px-4 sm:text-sm [&_svg]:hidden sm:[&_svg]:block" onClick={() => setMode("history")}><History /> My Orders</Button>
          {adminUnlocked && <Button variant={mode === "admin" ? "default" : "ghost"} className="h-auto min-h-9 gap-1 whitespace-normal px-1 text-xs leading-tight sm:gap-2 sm:px-4 sm:text-sm [&_svg]:hidden sm:[&_svg]:block" onClick={openDashboard}><LockKeyhole /> Shopkeeper</Button>}
        </div>
      </nav>

      {mode === "customer" ? (
        <CustomerView loaded={loaded} products={products} cart={cart} updateCart={updateCart} wishes={wishes} wishInput={wishInput} setWishInput={setWishInput} submitWish={submitWish} wishMessage={wishMessage} coupon={coupon} firstOrder={loaded && firstOrder} launchMessage={launchMessage} dailyOffers={dailyOffers} loyalty={loyalty} />
      ) : mode === "spin" ? (
        <SpinPage enabled={wheelEnabled} prizes={wheelRewards.filter((prize) => prize.active)} spun={spun} coupon={coupon} onResult={finishSpin} onShop={() => { setMode("customer"); void navigate({ to: "/shop" }); }} />
      ) : mode === "history" ? <OrderHistory orders={orders} onOpen={setReceipt} onPay={setPaying} onEditProfile={() => setProfileOpen(true)} onOrderAgain={orderAgain} loyalty={loyalty} /> : adminUnlocked ? (
        <AdminView products={products} setProducts={setProducts} wishes={wishes} {...(user.isAdmin ? { removeWish } : {})} orders={adminOrders} setOrders={setAdminOrders} override={store?.override ?? "auto"} setOverride={changeOverride} storeOnline={storeOnline} offlineOrders={store?.offlineOrders !== false} switchOfflineOrders={(enabled) => void switchOfflineOrders(enabled)} requests={orderRequests} finishRequest={(request) => void finishOrderRequest(request)} launchMessage={launchMessage} setLaunchMessage={edited(setLaunchMessage)} dailyOffers={dailyOffers} setDailyOffers={edited(setDailyOffers)} wheelRewards={wheelRewards} setWheelRewards={edited(setWheelRewards)} couponRule={couponRule} setCouponRule={edited(setCouponRule)} wheelEnabled={wheelEnabled} switchWheel={switchWheel} promotionsUnsaved={promotionsUnsaved} summary={salesSummary} manualSales={manualSales} setManualSales={setManualSales} promotionsSaved={applyPromotions} />
      ) : (
        <section className="mx-auto grid max-w-md gap-3 px-4 py-16 text-center">
          <h2 className="font-hand text-3xl font-bold">Shopkeeper dashboard</h2>
          <p className="text-muted-foreground">This account is a customer account. Shopkeepers sign in on the Shopkeeper tab with their mobile number and the password the admin gave them.</p>
          <Button onClick={() => void signInAsShopkeeper()}><Store /> Sign in as shopkeeper</Button>
          <Button variant="ghost" onClick={() => { setMode("customer"); void navigate({ to: "/shop" }); }}><ShoppingBag /> Back to the shop</Button>
        </section>
      )}

      {(mode === "customer" || mode === "spin") && (
        <Button onClick={() => setCartOpen(true)} className="fixed bottom-4 left-1/2 z-40 h-14 -translate-x-1/2 rounded-full px-5 shadow-[0_10px_28px_var(--shadow-color)]">
          <ShoppingBag className="size-5" /> <span>{itemCount} {itemCount === 1 ? "item" : "items"} · {money(subtotal)}</span><span className="rounded-full bg-accent px-3 py-1 text-accent-foreground">Checkout</span>
        </Button>
      )}

      {cartOpen && (
        <Checkout
          cartItems={cartItems}
          products={products}
          coupon={coupon}
          firstOrder={firstOrder}
          dailyOffers={dailyOffers}
          couponRule={couponRule}
          storeOnline={storeOnline}
          takingOrders={takingOrders}
          myRequest={myRequest}
          onRequest={async (input) => {
            try {
              setMyRequest(await api.sendOrderRequest(input));
              setCartOpen(false);
              toast.success("Request sent! The shopkeeper will see it and get in touch with you.", { duration: 8000 });
            } catch (error) {
              toast.error(errorText(error, "Could not send the request."), { duration: 8000 });
              void loadAll();
            }
          }}
          loyalty={loyalty}
          onClose={() => setCartOpen(false)}
          profile={profile}
          onComplete={async (input) => {
            try {
              const order = await api.placeOrder(input);
              setCart({}); setCartOpen(false); setFirstOrder(false); setJustPlacedId(order.id);
              // UPI: the order is saved first (stock kept, amount fixed), then she pays for it.
              if (order.payment === "UPI") setPaying(order); else setReceipt(order);
              setOrders((current) => [order, ...current]);
            } catch (error) {
              toast.error(errorText(error, "Could not place the order."), { duration: 8000 });
              // Stock, prices or offers changed: reload so the checkout shows the new total.
              void loadAll();
            }
          }}
        />
      )}
      {receipt && <OrderReceipt order={receipt} fresh={receipt.id === justPlacedId} onPay={() => { setPaying(receipt); setReceipt(null); }} close={() => { setReceipt(null); setJustPlacedId(null); }} />}
      {paying && <UpiPayment order={paying} fresh={paying.id === justPlacedId} onDone={(updated) => { setOrders((current) => current.map((o) => (o.id === updated.id ? updated : o))); setPaying(null); setReceipt(updated); }} onLater={() => { const later = paying; setPaying(null); setReceipt(later); }} />}
      {profileOpen && <ProfileForm profile={profile} setProfile={setProfile} submit={saveProfile} {...(profileSaved ? { close: () => setProfileOpen(false) } : {})} />}
      <Toaster position="top-center" richColors />
    </main>
    </SiteContext.Provider>
  );
}

function CustomerView({ loaded, products, cart, updateCart, wishes, wishInput, setWishInput, submitWish, wishMessage, coupon, firstOrder, launchMessage, dailyOffers, loyalty }: { loaded: boolean; products: Product[]; cart: Record<number, number>; updateCart: (id: number, delta: number) => void; wishes: Wish[]; wishInput: string; setWishInput: (value: string) => void; submitWish: (event: FormEvent<HTMLFormElement>) => void; wishMessage: string; coupon: Coupon | null; firstOrder: boolean; launchMessage: string; dailyOffers: DailyOffer[]; loyalty: Loyalty | null }) {
  const site = useSite();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!coupon) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [coupon]);
  const remaining = coupon ? Math.max(0, coupon.expiresAt - Date.now()) : 0;
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  // Only what she can buy (the API sends customers nothing else; staff previewing this see the same).
  const shelf = products.filter((product) => product.stock > 0);
  // Sections (only when the shelf has more than one) and a search box.
  const categories = [...new Set(shelf.map((product) => product.category))].sort((a, b) => a.localeCompare(b));
  const section = categories.includes(category) ? category : "All";
  const query = search.trim().toLowerCase();
  const shown = shelf.filter((product) => (section === "All" || product.category === section) && (!query || product.name.toLowerCase().includes(query)));
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="mb-8" aria-labelledby="offers-title">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div><p className="font-hand text-lg font-bold text-primary">Sweeter after midnight</p><h2 id="offers-title" className="font-hand text-4xl font-bold">Offers of the Day 🎁</h2></div>
          {coupon && remaining > 0 && <span className="rounded-full bg-stock px-3 py-1 text-sm font-bold text-stock-foreground">{coupon.icon} {coupon.code} · {hours}h {minutes}m {seconds}s</span>}
        </div>
        {launchMessage.trim() && <div className="mb-4 inline-flex rounded-full border-2 border-dashed border-primary bg-primary px-4 py-2 text-xs font-extrabold text-primary-foreground shadow-[3px_4px_0_var(--shadow-color)] sm:text-sm">{launchMessage}</div>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {dailyOffers.filter((offer) => offer.active).map((offer, index) => (
            <article key={offer.id} className={`relative overflow-hidden rounded-lg border-2 border-dashed border-primary/45 ${["bg-banner", "bg-accent", "bg-product", "bg-secondary"][index % 4]} p-4 shadow-[4px_5px_0_var(--shadow-color)] ${index % 2 ? "rotate-[.5deg]" : "-rotate-[.5deg]"}`}>
              <span aria-hidden="true" className="absolute right-2 top-1 text-xl opacity-50">{offer.icon}</span>
              <h3 className="font-hand text-2xl font-bold">{offer.id === "first" && !firstOrder ? "First order discount" : offer.title}</h3>
              <p className="mt-1 text-sm font-semibold text-foreground/75">{offer.id === "first" && !firstOrder ? "Already used on your first order." : offer.note}</p>
              {offer.id === "loyalty" && loyalty?.active && <p className="mt-2 text-xs font-bold">{loyalty.rewards > 0 ? `🎁 Your reward is ready: pick it at checkout!` : `Your card: ${loyalty.stamps} of ${loyalty.every} stamps`}</p>}
            </article>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Only the single best discount applies to a cart — we always pick the one that saves you most.</p>
      </section>

      <div className="mb-5 flex items-end justify-between gap-4">
        <div><p className="font-hand text-lg font-bold text-primary">Pick your midnight fix</p><h2 className="font-hand text-4xl font-bold">Snack shelf</h2></div>
        <span className="hidden rounded-full bg-secondary px-3 py-1 text-sm font-bold text-secondary-foreground sm:block">MRP + a small add-on, shown on each item · eggs: once per bundle</span>
      </div>
      {shelf.length > 0 && (
        <div className="mb-4 grid gap-2">
          <label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input type="search" className="h-11 bg-card pl-9" placeholder="Search snacks" aria-label="Search snacks" maxLength={60} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          {categories.length > 1 && (
            <div role="group" aria-label="Shelf sections" className="flex gap-2 overflow-x-auto pb-1">
              {["All", ...categories].map((name) => <Button key={name} size="sm" variant={section === name ? "default" : "outline"} aria-pressed={section === name} className="shrink-0 rounded-full" onClick={() => setCategory(name)}>{name}</Button>)}
            </div>
          )}
        </div>
      )}
      {shelf.length === 0 && <p className="border-2 border-dashed border-border bg-card p-8 text-center text-muted-foreground">{!loaded ? "Loading snacks…" : products.length ? "Everything's sold out right now — check back soon!" : "The shelf is empty right now — check back soon!"}</p>}
      {shelf.length > 0 && shown.length === 0 && <p className="border-2 border-dashed border-border bg-card p-6 text-center text-muted-foreground">{query ? <>Nothing called &ldquo;{search.trim()}&rdquo; on the shelf right now. Ask for it below 👇</> : "Nothing in this section right now."}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {shown.map((product, index) => {
          const qty = cart[product.id] ?? 0;
          const low = product.stock <= product.threshold;
          return (
            <article key={product.id} className={`product-card relative min-w-0 border-2 border-foreground/10 bg-card p-3 shadow-[3px_4px_0_var(--shadow-color)] ${index % 3 === 1 ? "rotate-[.6deg]" : index % 3 === 2 ? "-rotate-[.5deg]" : ""}`}>
              <div className="grid aspect-square place-items-center overflow-hidden rounded-sm bg-product text-6xl sm:text-7xl">
                {product.image ? <img src={product.image} alt={product.name} className="h-full w-full object-cover" loading="lazy" decoding="async" /> : <span aria-hidden="true">{product.emoji}</span>}
              </div>
              <span className={`absolute right-1 top-1 rounded-full px-2 py-1 text-[10px] font-bold ${low ? "bg-accent text-accent-foreground" : "bg-stock text-stock-foreground"}`}>
                {low ? `Only ${product.stock} left!` : "In Stock"}
              </span>
              {(product.popular || product.isNew) && <span className="absolute left-1 top-1 rounded-full bg-primary px-2 py-1 text-[10px] font-bold text-primary-foreground shadow-sm">{product.popular ? "🔥 Popular" : "✨ New"}</span>}
              <h3 className="mt-3 min-h-12 font-hand text-xl font-bold leading-tight">{product.name}</h3>
              <div className="flex items-end justify-between gap-2"><div className="min-w-0 [overflow-wrap:anywhere]">{isEggProduct(product) ? <><p className="text-lg font-bold text-primary">{money(product.mrp)} / egg</p><p className="text-[11px] text-muted-foreground">Quantity total + ₹{product.markup} once</p></> : <><p className="text-lg font-bold text-primary">{money(product.mrp + product.markup)}</p><p className="text-[11px] text-muted-foreground">MRP {money(product.mrp)} + ₹{product.markup}</p></>}</div></div>
              <div className="mt-3 grid grid-cols-[2rem_1fr_2rem] items-center rounded-md border border-border bg-background p-1">
                <Button size="icon" variant="ghost" aria-label={`Remove ${product.name}`} onClick={() => updateCart(product.id, -1)} disabled={!qty}><Minus /></Button>
                <span className="text-center font-bold">{qty}</span>
                <Button size="icon" aria-label={`Add ${product.name}`} onClick={() => updateCart(product.id, 1)} disabled={qty >= product.stock}><Plus /></Button>
              </div>
            </article>
          );
        })}
      </div>

      <section className="mt-12" aria-labelledby="hostel-nights-title">
        <div className="mb-5 text-center">
          <p className="font-hand text-lg font-bold text-primary">Good food, happier nights ♡</p>
          <h2 id="hostel-nights-title" className="font-display text-4xl font-extrabold">Made for every hostel mood</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { image: cozySnackGirl, alt: "Girl relaxing on her hostel bed with chips", title: "Midnight me-time", note: "A soft blanket and your favorite crunchy fix." },
            { image: weekendMovieGirls, alt: "Four hostel friends watching a movie on one laptop with snacks", title: "Weekend watch party", note: "One laptop, four girls, snacks passed around." },
            { image: periodComfortGirl, alt: "Girl resting comfortably with a hot-water bag and snacks", title: "Period comfort mode", note: "Warm, cozy and stocked with comfort treats." },
          ].map((scene, index) => (
            <article key={scene.title} className={`mood-card overflow-hidden border-2 border-dashed border-primary/35 bg-card p-2 shadow-[5px_6px_0_var(--shadow-color)] ${index === 1 ? "md:-translate-y-3" : ""}`}>
              <img src={scene.image} alt={scene.alt} width={800} height={800} loading="lazy" decoding="async" className="aspect-square w-full object-cover" />
              <div className="px-2 pb-3 pt-4 text-center"><h3 className="font-display text-2xl font-extrabold text-primary">{scene.title}</h3><p className="mt-1 text-sm text-muted-foreground">{scene.note}</p></div>
            </article>
          ))}
        </div>
      </section>

      <section className="relative mt-10 border-2 border-dashed border-primary/40 bg-accent p-5 shadow-[5px_6px_0_var(--shadow-color)] sm:p-7">
        <Heart className="absolute right-5 top-5 size-9 text-primary" fill="currentColor" />
        <h2 className="max-w-[80%] font-hand text-3xl font-bold">Want something else? Add to Wishlist! 💖</h2>
        <p className="mt-1 text-sm text-accent-foreground/75">Tell the shopkeeper what to stock next.</p>
        <form onSubmit={submitWish} className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input maxLength={60} value={wishInput} onChange={(event) => setWishInput(event.target.value)} placeholder="Brand or Item Name (e.g. Doritos, Ice Cream)" aria-label="Brand or Item Name" className="h-11 bg-card" />
          <Button type="submit" className="h-11">Submit Request</Button>
        </form>
        {wishMessage && <p className="mt-3 font-hand text-lg font-bold text-primary">{wishMessage}</p>}
        <NotificationsCard compact />
        <div className="mt-4 flex flex-wrap gap-2">{wishes.slice(0, 3).map(({ name, count }) => <span key={name} className="rounded-full bg-card px-3 py-1 text-xs font-bold text-foreground">{name} · {plural(count, "request")}</span>)}</div>
      </section>
    </div>
  );
}

const wheelColors = ["var(--secondary)", "var(--accent)", "var(--banner)", "var(--stock)", "var(--product)"];

/** The wheel itself: one slice per prize (its icon and short text), turned by angle. */
function WheelDisc({ prizes, angle = 0, spinning = false, className = "size-[min(88vw,24rem)]" }: { prizes: WheelPrize[]; angle?: number; spinning?: boolean; className?: string }) {
  const slice = 360 / Math.max(1, prizes.length);
  const gradient = `conic-gradient(${prizes.map((_, index) => `${wheelColors[index % wheelColors.length]} ${index * slice}deg ${(index + 1) * slice}deg`).join(", ")})`;
  return (
    <div className={`relative mx-auto ${className}`}>
      <span aria-hidden="true" className="absolute left-1/2 top-[-12px] z-20 -translate-x-1/2 text-4xl text-primary drop-shadow-md">▼</span>
      <div
        className="relative size-full overflow-hidden rounded-full border-[6px] border-primary shadow-[0_0_22px_var(--secondary),5px_7px_0_var(--shadow-color)]"
        style={{ transform: `rotate(${angle}deg)`, transition: spinning ? "transform 3.2s cubic-bezier(.17,.67,.2,1)" : undefined, background: prizes.length ? gradient : "var(--muted)" }}
      >
        {prizes.map((prize, index) => {
          const radians = ((index * slice + slice / 2) * Math.PI) / 180;
          return (
            <div key={`${prize.code}-${index}`} className="absolute z-10 -translate-x-1/2 -translate-y-1/2" style={{ left: `${50 + Math.sin(radians) * 31}%`, top: `${50 - Math.cos(radians) * 31}%` }}>
              <span className="flex h-[4.4rem] w-[4.4rem] flex-col items-center justify-center overflow-hidden px-0.5 text-center font-display text-[8px] font-extrabold leading-tight text-foreground drop-shadow-sm sm:h-[4.8rem] sm:w-[4.8rem] sm:text-[9px]"><span className="text-base leading-none">{prize.icon}</span>{prize.shortLabel || prize.label}</span>
            </div>
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-0 grid place-items-center"><span className="grid size-11 place-items-center rounded-full border-4 border-card bg-primary font-hand text-[10px] font-bold text-primary-foreground shadow-md">SPIN</span></div>
    </div>
  );
}

/** What her coupon's cart needs, in words ("items worth ₹80+ · Room Delivery"). */
function couponNeeds(coupon: Coupon): string {
  const needs = [
    coupon.minOrder > 0 && `items worth ₹${coupon.minOrder}+`,
    coupon.minItems > 0 && `${coupon.minItems}+ items`,
    coupon.kind === "premium5" && `${PREMIUM_ITEMS} premium items (₹${PREMIUM_PRICE}+ each)`,
    isDeliveryCoupon(coupon.kind) && "Room Delivery",
  ].filter(Boolean);
  return needs.length ? needs.join(" · ") : "any order";
}

/** Her coupon: what it gives, what the cart needs, and when it ends. */
function CouponCard({ coupon }: { coupon: Coupon }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const left = Math.max(0, coupon.expiresAt - Date.now());
  return (
    <section aria-label="Your coupon" className="mt-5 rounded-lg border-2 border-dashed border-stock bg-stock/25 p-4 text-left">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Your coupon · {coupon.code}</p>
      <p className="mt-1 font-hand text-2xl font-bold">{coupon.icon} {coupon.label}</p>
      <p className="mt-1 text-sm">Needs: {couponNeeds(coupon)}. It applies by itself at checkout when your cart qualifies.</p>
      <p className="mt-1 text-xs font-bold text-muted-foreground">Ends in {Math.floor(left / 3_600_000)}h {Math.floor((left % 3_600_000) / 60_000)}m</p>
    </section>
  );
}

/** Spin & Win, a page of its own: today's spin and her coupon. */
function SpinPage({ enabled, prizes, spun, coupon, onResult, onShop }: { enabled: boolean; prizes: WheelPrize[]; spun: boolean; coupon: Coupon | null; onResult: (result: SpinResult) => void; onShop: () => void }) {
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<WheelPrize | undefined>(undefined);
  // The server's list wins once it has picked a prize, so the pointer lands on the right slice.
  const [serverWheel, setServerWheel] = useState<WheelPrize[] | null>(null);
  const wheel = serverWheel ?? prizes;

  async function spin() {
    if (spinning || spun) return;
    setSpinning(true);
    try {
      const outcome = await api.spin();
      const size = 360 / outcome.prizes.length;
      setServerWheel(outcome.prizes);
      setAngle(360 * 5 + (360 - outcome.index * size - size / 2));
      window.setTimeout(() => {
        setSpinning(false);
        setResult(outcome.prize);
        onResult(outcome);
      }, 3400);
    } catch (error) {
      setSpinning(false);
      toast.error(errorText(error, "Could not spin the wheel."));
    }
  }

  const showWheel = enabled || spinning || result !== undefined;
  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <section aria-labelledby="spin-title" className="overflow-hidden rounded-lg border-2 border-dashed border-primary/50 bg-card p-5 text-center shadow-[0_0_32px_color-mix(in_oklab,var(--accent)_55%,transparent),7px_8px_0_var(--shadow-color)]">
        <p className="font-hand text-lg font-bold text-primary">One spin a day ♡</p>
        <h2 id="spin-title" className="font-hand text-3xl font-bold">Spin &amp; Win Midnight Discounts! 🎡</h2>
        {showWheel ? (
          <>
            <div className="mt-5"><WheelDisc prizes={wheel} angle={angle} spinning={spinning} /></div>
            {result !== undefined && <p role="status" className="mt-4 font-hand text-xl font-bold text-primary">{result.kind ? `You won ${result.label}! 🎉 It's saved and applies at checkout when your cart qualifies.` : `${result.icon} ${result.label}`}</p>}
            {result === undefined && !spinning && spun && <p className="mt-4 font-hand text-xl font-bold text-primary">{coupon ? "You spun today: your coupon is below." : "You spun today."}</p>}
            <Button className="mt-4 h-12 w-full text-base" onClick={() => void spin()} disabled={spinning || spun || wheel.length < 2}>
              {spinning ? "Spinning…" : spun ? "Come back tomorrow for another spin 💫" : "Spin today’s wheel!"}
            </Button>
          </>
        ) : (
          <p role="status" className="mt-4 text-sm font-semibold text-muted-foreground">The spin wheel is switched off right now. Check back later!{coupon ? " Your coupon below still works." : ""}</p>
        )}
      </section>
      {coupon && <CouponCard coupon={coupon} />}
      <p className="mt-4 text-xs text-muted-foreground">One coupon at a time: a new win replaces the old one. Coupons last 48 hours. Only the single best discount applies to a cart.</p>
      <Button variant="outline" className="mt-4 w-full" onClick={onShop}><ShoppingBag /> Back to the shop</Button>
    </div>
  );
}

function AdminView({ products, setProducts, wishes, removeWish, orders, setOrders, override, setOverride, storeOnline, offlineOrders, switchOfflineOrders, requests, finishRequest, launchMessage, setLaunchMessage, dailyOffers, setDailyOffers, wheelRewards, setWheelRewards, couponRule, setCouponRule, wheelEnabled, switchWheel, promotionsUnsaved, summary, manualSales, setManualSales, promotionsSaved }: { products: Product[]; setProducts: React.Dispatch<React.SetStateAction<Product[]>>; wishes: Wish[]; removeWish?: (name: string) => void; orders: AdminOrder[]; setOrders: React.Dispatch<React.SetStateAction<AdminOrder[]>>; override: StoreOverride; setOverride: (value: StoreOverride) => void; storeOnline: boolean; offlineOrders: boolean; switchOfflineOrders: (enabled: boolean) => void; requests: OrderRequest[]; finishRequest: (request: OrderRequest) => void; launchMessage: string; setLaunchMessage: (value: string) => void; dailyOffers: DailyOffer[]; setDailyOffers: React.Dispatch<React.SetStateAction<DailyOffer[]>>; wheelRewards: WheelPrize[]; setWheelRewards: React.Dispatch<React.SetStateAction<WheelPrize[]>>; couponRule: CouponRule; setCouponRule: (value: CouponRule) => void; wheelEnabled: boolean; switchWheel: (enabled: boolean) => Promise<void>; promotionsUnsaved: boolean; summary: SalesSummary | null; manualSales: ManualSale[]; setManualSales: React.Dispatch<React.SetStateAction<ManualSale[]>>; promotionsSaved: (saved: Promotions) => void }) {
  const site = useSite();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newStock, setNewStock] = useState("5");
  const [newPrice, setNewPrice] = useState("20");
  const [newMarkup, setNewMarkup] = useState("5");
  const [newImage, setNewImage] = useState<string | undefined>();
  const [newCategory, setNewCategory] = useState("Snacks");
  const addFormRef = useRef<HTMLFormElement>(null);
  const [savingPromotions, setSavingPromotions] = useState(false);
  // The dashboard's pages: shop management, entering an in-person sale, and the sales figures.
  const [page, setPage] = useState<DashboardPage>("dashboard");
  const lowStock = products.filter((item) => item.stock <= item.threshold);
  const outOfStock = lowStock.filter((item) => item.stock === 0).length;
  const analytics = useMemo(() => {
    const sold = new Map((summary?.sold ?? []).map((item) => [item.name, item.qty] as const));
    const performance = products.map((product) => ({ name: product.name, sold: sold.get(product.name) ?? 0, stock: product.stock, mrp: product.mrp }));
    const totalRevenue = summary?.revenue ?? 0;
    const investment = summary?.investment ?? 0;
    return {
      performance,
      totalRevenue,
      investment,
      best: [...performance].sort((a, b) => b.sold - a.sold).slice(0, 3),
      slow: [...performance].sort((a, b) => a.sold - b.sold).slice(0, 3),
      wishlist: wishes.map(({ name, count }) => ({ name, requests: count })),
    };
  }, [products, summary, wishes]);

  // Updates to one product are sent one at a time, in order, so a slower earlier reply can't undo a later change.
  const productQueues = useRef(new Map<number, Promise<void>>());
  // Stock/threshold taps still waiting for the server, per product.
  const pendingTaps = useRef(new Map<number, number>());
  function updateProduct(id: number, changes: { stock?: number; stockDelta?: number; shelf?: number; threshold?: number; mrp?: number; markup?: number; category?: string; image?: string | null }) {
    const run = async () => {
      try {
        const updated = await api.admin.updateProduct(id, changes);
        setProducts((current) => current.map((item) => (item.id === id ? { ...updated, ...pendingOptimistic(item, updated) } : item)));
      } catch (error) {
        toast.error(errorText(error, "Could not update the product."));
        void api.products().then(setProducts).catch(() => undefined);
      }
    };
    const next = (productQueues.current.get(id) ?? Promise.resolve()).then(run);
    productQueues.current.set(id, next);
    return next;
  }

  // While more taps for this product are still queued, keep showing the optimistic numbers.
  function pendingOptimistic(local: Product, server: Product): Partial<Product> {
    return pendingTaps.current.get(local.id) ? { stock: local.stock, threshold: local.threshold } : { stock: server.stock, threshold: server.threshold };
  }

  function changeProduct(id: number, field: "stock" | "threshold", delta: number) {
    const item = products.find((product) => product.id === id); if (!item) return;
    const value = Math.max(0, item[field] + delta);
    if (value === item[field]) return;
    // Optimistic so quick repeated taps each show at once.
    setProducts((current) => current.map((product) => (product.id === id ? { ...product, [field]: value } : product)));
    pendingTaps.current.set(id, (pendingTaps.current.get(id) ?? 0) + 1);
    void updateProduct(id, field === "stock" ? { stockDelta: value - item.stock } : { threshold: value }).finally(() => {
      pendingTaps.current.set(id, (pendingTaps.current.get(id) ?? 1) - 1);
      if (!pendingTaps.current.get(id)) void api.products().then(setProducts).catch(() => undefined);
    });
  }


  // An emptied or mistyped price box must not save ₹0 (the item would then sell for just the markup).
  function changePrice(item: Product, input: HTMLInputElement) {
    const mrp = parsePrice(input.value);
    if (mrp === null) { input.value = String(item.mrp); toast.error(`Enter a price above ₹0 for ${item.name}.`); return; }
    if (mrp !== item.mrp) void updateProduct(item.id, { mrp });
  }

  /** The item's price hike: whole rupees, 0 to 1000 (anything else goes back). */
  function changeMarkup(item: Product, input: HTMLInputElement) {
    const markup = parseMarkup(input.value);
    if (markup === null) { input.value = String(item.markup); toast.error(`Price hike for ${item.name}: enter whole rupees from 0 to 1000.`); return; }
    if (markup !== item.markup) void updateProduct(item.id, { markup });
  }

  function openAddForm(name?: string) {
    setPage("dashboard");
    setAdding(true);
    if (name !== undefined) setNewName(name);
    // The form sits at the top of the dashboard; bring it into view from the inventory button too.
    window.setTimeout(() => addFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  /** From the Restock page to that item's card in Inventory Management. */
  function openInventoryCard(id: number) {
    setPage("dashboard");
    window.setTimeout(() => {
      const card = document.getElementById(`inventory-${id}`);
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
      card?.querySelector<HTMLInputElement>('input[aria-label="On the shelf"]')?.focus({ preventScroll: true });
    }, 50);
  }

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newName.trim()) return;
    const image = newImage;
    const mrp = parsePrice(newPrice);
    const stock = Number(newStock);
    const markup = parseMarkup(newMarkup);
    if (mrp === null) { toast.error("Enter a purchase price above ₹0."); return; }
    if (markup === null) { toast.error("Price hike: enter whole rupees from 0 to 1000."); return; }
    if (!Number.isInteger(stock) || stock < 0) { toast.error("Starting stock must be a whole number (0 or more)."); return; }
    try {
      const created = await api.admin.createProduct({ name: newName.trim(), mrp, markup, stock, category: newCategory, ...(image ? { image } : {}) });
      setProducts((current) => [...current, created]);
      setNewName(""); setNewStock("5"); setNewPrice("20"); setNewMarkup("5"); setNewImage(undefined); setNewCategory("Snacks"); setAdding(false);
      toast.success(`${created.name} added to the shop.`);
    } catch (error) {
      toast.error(errorText(error, "Could not add the product."));
    }
  }

  async function deleteProduct(item: Product) {
    if (!window.confirm(`Delete ${item.name} from inventory?`)) return;
    try {
      await api.admin.deleteProduct(item.id);
      setProducts((current) => current.filter((product) => product.id !== item.id));
    } catch (error) {
      toast.error(errorText(error, "Could not delete the product."));
    }
  }

  function manualSaleRecorded(sale: ManualSale, taken: Record<number, number>) {
    setProducts((current) => current.map((product) => (taken[product.id] ? { ...product, stock: Math.max(0, product.stock - (taken[product.id] ?? 0)) } : product)));
    setManualSales((current) => [sale, ...current.filter((item) => item.id !== sale.id)]);
  }

  const [orderFilter, setOrderFilter] = useState<"pending" | "done" | "all">("pending");
  const [orderSearch, setOrderSearch] = useState("");
  const [updatingOrder, setUpdatingOrder] = useState<number | null>(null);
  const orderCounts = { pending: orders.filter((o) => !o.fulfilled && !o.cancelled).length, done: orders.filter((o) => o.fulfilled).length, all: orders.length };
  const shownOrders = useMemo(() => {
    const query = orderSearch.trim().toLowerCase();
    const digits = query.replace(/\D/g, "");
    return orders.filter((order) => {
      if (orderFilter === "pending" && (order.fulfilled || order.cancelled)) return false;
      if (orderFilter === "done" && !order.fulfilled) return false;
      if (!query) return true;
      const { name, phone, email, block, room } = order.customer;
      const text = [orderLabel(order), name, email, block && room ? `block ${block} room ${room}` : room, order.details, order.utr, ...order.items.map((item) => item.name)].filter(Boolean).join(" ").toLowerCase();
      // "900001", "90000 00001" or "#0012" all find the order.
      return text.includes(query) || (digits.length >= 3 && ((phone ?? "").replace(/\D/g, "").includes(digits) || String(order.orderNumber) === digits.replace(/^0+/, "")));
    });
  }, [orders, orderFilter, orderSearch]);

  async function setPaymentReceived(order: AdminOrder, received: boolean) {
    setUpdatingOrder(order.id);
    try {
      const updated = await api.admin.setPaymentReceived(order.id, received);
      setOrders((current) => current.map((item) => (item.id === order.id ? updated : item)));
    } catch (error) {
      toast.error(errorText(error, "Could not update the payment."));
    } finally {
      setUpdatingOrder(null);
    }
  }

  async function setFulfilled(order: AdminOrder, fulfilled: boolean, paymentReceived = false) {
    setUpdatingOrder(order.id);
    try {
      const updated = await (fulfilled ? api.admin.fulfillOrder(order.id, paymentReceived) : api.admin.unfulfillOrder(order.id));
      setOrders((current) => current.map((item) => (item.id === order.id ? updated : item)));
      if (fulfilled) toast.success(`Order ${orderLabel(order)} marked as fulfilled.`, { action: { label: "Undo", onClick: () => void setFulfilled(updated, false) } });
    } catch (error) {
      toast.error(errorText(error, "Could not update the order."));
    } finally {
      setUpdatingOrder(null);
    }
  }

  /** The item the shop gave for an order's free chocolate or snack: off the stock (null: none from stock). */
  async function giveGift(order: AdminOrder, index: number, productId: number | null) {
    setUpdatingOrder(order.id);
    try {
      const updated = await api.admin.giveGift(order.id, index, productId);
      setOrders((current) => current.map((item) => (item.id === order.id ? updated : item)));
      setProducts(await api.products());
    } catch (error) {
      toast.error(errorText(error, "Could not record the free item."));
    } finally {
      setUpdatingOrder(null);
    }
  }

  // The offers and the wheel are saved together (one Save on each page), so neither undoes the other.
  async function savePromotions() {
    if (wheelRewards.filter((reward) => reward.active).length < 2) { toast.error("Keep at least two wheel slices active."); return; }
    if (!wheelRewards.some((reward) => reward.active && reward.kind === null)) { toast.error("Keep one Better Luck slice active."); return; }
    setSavingPromotions(true);
    try {
      // The reply is what customers now see (the server writes each slice's text from its amounts).
      promotionsSaved(await api.admin.savePromotions({ launchMessage: launchMessage.trim(), dailyOffers, wheelPrizes: wheelRewards, couponRule }));
      toast.success(page === "wheel" ? "Spin wheel saved: customers see it now." : "Offers saved: customers see them now.");
    } catch (error) {
      toast.error(errorText(error, "Could not save the offers."));
    } finally {
      setSavingPromotions(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
        <div className="min-w-0"><p className="font-hand text-lg font-bold text-primary [overflow-wrap:anywhere]">{site.pickupPoint} · <a className="underline" href={`tel:+91${site.shopPhone}`}>{spacedPhone(site.shopPhone)}</a></p><h2 className="font-hand text-3xl font-bold leading-tight sm:text-4xl">Shopkeeper Dashboard</h2><p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">WhatsApp: <a className="underline" href={shopWhatsApp(site, "Hi! This is Kannagi Night Mart.")}>+91 {spacedPhone(site.shopPhone)}</a> · UPI {site.upiId}</p></div>
        <Button className="justify-self-start sm:justify-self-auto" onClick={() => (adding && page === "dashboard" ? setAdding(false) : openAddForm())}><PackagePlus /> {adding && page === "dashboard" ? "Close" : "Add item"}</Button>
      </div>

      <div role="tablist" aria-label="Dashboard pages" className="mt-4 grid grid-cols-5 gap-1 rounded-md border border-border bg-card p-1">
        {DASHBOARD_PAGES.map(({ id, label, icon: Icon }) => (
          <Button key={id} role="tab" aria-selected={page === id} variant={page === id ? "default" : "ghost"} className="h-auto min-h-10 gap-1 whitespace-normal px-0.5 text-[0.7rem] leading-tight sm:gap-2 sm:px-1 sm:text-sm [&_svg]:hidden sm:[&_svg]:block" onClick={() => setPage(id)}>
            <Icon /> {label}{id === "restock" && lowStock.length > 0 && <span className="rounded-full bg-alert px-1.5 text-[0.7rem] font-bold leading-5 text-alert-foreground">{lowStock.length}</span>}
          </Button>
        ))}
      </div>

      {page === "restock" && <RestockPanel products={products} sold={summary?.sold ?? []} wishes={wishes} onEdit={openInventoryCard} />}

      {page === "wheel" && <WheelEditor prizes={wheelRewards} setPrizes={setWheelRewards} couponRule={couponRule} setCouponRule={setCouponRule} enabled={wheelEnabled} switchWheel={switchWheel} unsaved={promotionsUnsaved} saving={savingPromotions} save={() => void savePromotions()} />}

      {page === "manual" && <ManualSalePanel products={products} sales={manualSales} onRecorded={manualSaleRecorded} onUndone={(sale) => setManualSales((current) => current.map((item) => (item.id === sale.id ? sale : item)))} />}

      {page === "dashboard" && (<>
      {adding && (
        <form ref={addFormRef} onSubmit={addProduct} aria-label="Add item" className="mt-5 grid scroll-mt-36 gap-4 border-2 border-dashed border-primary/35 bg-card p-4 sm:grid-cols-[14rem_1fr]">
          <PhotoPicker label="New item" emoji="🛍️" image={newImage} onPick={setNewImage} onRemove={() => setNewImage(undefined)} />
          <div className="grid content-start gap-3">
            <h3 className="font-hand text-2xl font-bold">Add a new item</h3>
            <label className="grid gap-1 text-xs font-bold">Item name<Input required maxLength={80} placeholder="e.g. Oreo biscuits" value={newName} onChange={(e) => setNewName(e.target.value)} /></label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-xs font-bold">MRP (₹)<Input required type="number" inputMode="decimal" min="0.01" max="100000" step="0.01" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} aria-label="Purchase price" /></label>
              <label className="grid gap-1 text-xs font-bold">Price hike (₹)<Input required type="number" inputMode="numeric" min="0" max="1000" step="1" value={newMarkup} onChange={(e) => setNewMarkup(e.target.value)} aria-label="New item's price hike" /></label>
              <label className="grid gap-1 text-xs font-bold">Starting stock<Input required type="number" inputMode="numeric" min="0" max="100000" step="1" value={newStock} onChange={(e) => setNewStock(e.target.value)} aria-label="Starting stock" /></label>
            </div>
            <label className="grid gap-1 text-xs font-bold">Shelf section<select aria-label="New item's shelf section" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm font-normal">{categoryOptions(newCategory).map((name) => <option key={name}>{name}</option>)}</select></label>
            <p className="text-xs text-muted-foreground">Customers pay MRP + the price hike{parsePrice(newPrice) !== null && parseMarkup(newMarkup) !== null ? ` (${money((parsePrice(newPrice) ?? 0) + (parseMarkup(newMarkup) ?? 0))})` : ""}. Add a real photo so customers recognise the item; you can also add or change it later.</p>
            <Button type="submit" className="h-11"><PackagePlus /> Add item</Button>
          </div>
        </form>
      )}

      <section className="mt-5 border-2 border-dashed border-primary/35 bg-card p-4 shadow-[4px_5px_0_var(--shadow-color)]">
        <h3 className="font-hand text-2xl font-bold">Store status</h3>
        <p className="mt-1 text-sm text-muted-foreground">Auto follows shop hours ({hoursLabel(site)}). Right now customers see: <b>{storeOnline ? "Online" : offlineOrders ? "Offline / on request" : "Offline / requests only"}</b>.</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(["auto", "online", "offline"] as const).map((option) => (
            <Button key={option} variant={override === option ? "default" : "outline"} onClick={() => setOverride(option)} className="h-auto min-h-10 whitespace-normal capitalize">
              {option === "auto" ? "Auto (by time)" : option === "online" ? "Force Online" : "Force Offline"}
            </Button>
          ))}
        </div>
        <h4 className="mt-4 text-sm font-bold">While the store is offline</h4>
        <div role="group" aria-label="While the store is offline" className="mt-2 grid grid-cols-2 gap-2">
          <Button variant={offlineOrders ? "default" : "outline"} aria-pressed={offlineOrders} onClick={() => !offlineOrders && switchOfflineOrders(true)} className="h-auto min-h-10 whitespace-normal">Take orders (on request)</Button>
          <Button variant={offlineOrders ? "outline" : "default"} aria-pressed={!offlineOrders} onClick={() => offlineOrders && switchOfflineOrders(false)} className="h-auto min-h-10 whitespace-normal">Don&apos;t take orders</Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{offlineOrders ? "Customers can order while the store is offline; you confirm those orders when you're around." : "Customers can't order while the store is offline. They send you a request for what's in their cart instead (no stock is kept for it); requests show under Order requests."}</p>
      </section>

      <section className="mt-5 border-2 border-dashed border-primary/35 bg-card p-4 shadow-[4px_5px_0_var(--shadow-color)]">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-hand text-2xl font-bold">Offers of the Day</h3><p className="text-sm text-muted-foreground">Only shopkeepers can edit what customers see. The spin wheel has its own page.</p></div><Button onClick={savePromotions} disabled={savingPromotions}><Check /> {savingPromotions ? "Saving…" : "Save offers"}</Button></div>
        {promotionsUnsaved && <p role="status" className="mt-3 rounded-md bg-accent px-3 py-2 text-sm font-bold text-accent-foreground">Not saved yet: customers still see the old offers. Tap Save offers.</p>}
        <label className="mt-4 grid gap-1 text-sm font-bold">Launching offer message<Input maxLength={200} value={launchMessage} onChange={(event) => setLaunchMessage(event.target.value)} /></label>
        <h4 className="mt-5 font-hand text-xl font-bold">Daily offer cards</h4>
        <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
          {dailyOffers.map((offer, index) => <article key={offer.id} className="grid min-w-0 gap-2 rounded-md border border-border bg-background p-3"><div className="grid grid-cols-[4rem_1fr] gap-2"><Input aria-label={`${offer.id} icon`} maxLength={16} value={offer.icon} onChange={(event) => setDailyOffers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, icon: event.target.value } : item))} /><Input aria-label={`${offer.id} title`} maxLength={80} value={offer.title} onChange={(event) => setDailyOffers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} /></div><Input aria-label={`${offer.id} description`} maxLength={200} value={offer.note} onChange={(event) => setDailyOffers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, note: event.target.value } : item))} /><label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={offer.active} onChange={(event) => setDailyOffers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, active: event.target.checked } : item))} /> Show this offer</label><OfferAmounts offer={offer} change={(patch) => setDailyOffers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))} /></article>)}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Customers read each card&apos;s text; checkout gives the amounts under it. Keep the two saying the same.</p>
        <Button className="mt-4 w-full" onClick={savePromotions} disabled={savingPromotions}><Check /> {savingPromotions ? "Saving…" : "Save offers"}</Button>
      </section>



      {lowStock.length > 0 && (
        <button type="button" onClick={() => setPage("restock")} className="mt-6 flex w-full items-center gap-2 rounded-md bg-alert px-4 py-3 text-left text-alert-foreground shadow-[4px_5px_0_var(--shadow-color)]">
          <AlertTriangle className="size-5 shrink-0" />
          <span className="min-w-0 flex-1 text-sm font-bold">{plural(lowStock.length, "item")} to restock{outOfStock ? ` (${outOfStock} out of stock)` : ""} 🚨</span>
          <span className="shrink-0 text-sm font-bold underline">See by section</span>
        </button>
      )}

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,.65fr)]">
        <section>
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-hand text-3xl font-bold">Inventory Management</h3><Button variant="secondary" onClick={() => openAddForm()}><PackagePlus /> Add item</Button></div>
          <p className="mt-1 text-xs text-muted-foreground">Stock you add (a new item&apos;s starting stock, + or a typed number) is recorded as new stock bought, and stock you take off as taken off. A mistake put right within 10 minutes isn&apos;t counted.</p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {products.map((item) => (
              <article key={item.id} id={`inventory-${item.id}`} className="min-w-0 scroll-mt-24 border-2 border-foreground/10 bg-card p-4 shadow-[3px_4px_0_var(--shadow-color)]">
                <PhotoPicker label={item.name} emoji={item.emoji} image={item.image} onPick={(image) => updateProduct(item.id, { image })} onRemove={() => updateProduct(item.id, { image: null })} compact />
                <div className="mt-3 min-w-0">
                  <div className="min-w-0"><h4 className="truncate font-hand text-xl font-bold">{item.name}</h4><p className="text-xs text-muted-foreground">{isEggProduct(item) ? `${money(item.mrp)} per egg + ₹${item.markup} per bundle` : `Customers pay ${money(item.mrp + item.markup)} (MRP ${money(item.mrp)} + ₹${item.markup})`}</p></div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2"><label className="grid gap-1 text-xs font-bold">Purchase / MRP price<Input key={item.mrp} type="number" min="0" step="0.01" defaultValue={item.mrp} onBlur={(event) => changePrice(item, event.target)} /></label><label className="grid gap-1 text-xs font-bold">Price hike (₹)<Input key={item.markup} type="number" inputMode="numeric" min="0" max="1000" step="1" aria-label={`${item.name} price hike`} defaultValue={item.markup} onBlur={(event) => changeMarkup(item, event.target)} /></label></div>
                {/* The shelf: what's left to order plus what open orders hold (still there until handed over). A typed number is a shelf count; the server keeps open orders taken off. */}
                <Counter label="On the shelf" value={item.stock + (item.held ?? 0)} minus={() => changeProduct(item.id,"stock",-1)} plus={() => changeProduct(item.id,"stock",1)} set={(value) => void updateProduct(item.id, { shelf: value })} />
                {(item.held ?? 0) > 0 && <p className="mt-1 text-xs text-muted-foreground">{item.held} of them for orders not handed over yet · {item.stock} left for customers to order</p>}
                <Counter label="Restock threshold" value={item.threshold} minus={() => changeProduct(item.id,"threshold",-1)} plus={() => changeProduct(item.id,"threshold",1)} set={(value) => changeProduct(item.id, "threshold", value - item.threshold)} />
                <label className="mt-3 grid gap-1 text-xs font-bold">Shelf section<select aria-label={`${item.name} shelf section`} value={item.category} onChange={(e) => { const category = e.target.value; setProducts((current) => current.map((product) => (product.id === item.id ? { ...product, category } : product))); void updateProduct(item.id, { category }); }} className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm font-normal">{categoryOptions(item.category).map((name) => <option key={name}>{name}</option>)}</select></label>
                 <Button variant="destructive" className="mt-3 w-full" onClick={() => void deleteProduct(item)}><Trash2 /> Delete item</Button>
              </article>
            ))}
          </div>
        </section>
        <aside className="space-y-7">
          <section className="border-2 border-dashed border-primary/35 bg-accent p-5"><h3 className="font-hand text-2xl font-bold">Customer Wishlist Requests</h3><p className="mt-1 text-xs">A request goes away by itself when you add that item (same name) with stock.{removeWish ? " Tap × to remove one." : ""}</p><div className="mt-4 space-y-3">{wishes.length === 0 && <p className="text-sm">No requests yet.</p>}{wishes.map(({ name, count }, index) => <div key={name} className={`grid ${removeWish ? "grid-cols-[auto_minmax(0,1fr)_auto_auto_auto]" : "grid-cols-[auto_minmax(0,1fr)_auto_auto]"} items-center gap-3 border-b border-foreground/10 pb-2`}><span className="grid size-7 place-items-center rounded-full bg-primary font-bold text-primary-foreground">{index+1}</span><span className="font-bold [overflow-wrap:anywhere]">{name}</span><span className="text-sm">{plural(count, "Request")}</span><Button size="icon" variant="ghost" className="size-8" aria-label={`Add ${name} to the shop`} title="Add this item" onClick={() => openAddForm(name)}><PackagePlus /></Button>{removeWish && <Button size="icon" variant="ghost" className="size-8" aria-label={`Remove request: ${name}`} onClick={() => removeWish(name)}><X /></Button>}</div>)}</div></section>
          {(requests.length > 0 || !offlineOrders) && (
            <section aria-labelledby="requests-title">
              <h3 id="requests-title" className="flex items-center gap-2 font-hand text-3xl font-bold"><Inbox className="size-7 text-primary" /> Order requests{requests.length > 0 && <span className="rounded-full bg-alert px-2 font-sans text-sm leading-6 text-alert-foreground">{requests.length}</span>}</h3>
              <p className="text-xs text-muted-foreground">Sent while the store was offline and not taking orders. Get in touch with her, then tap Done. No stock is kept for a request.</p>
              <div className="mt-3 space-y-3">
                {requests.length === 0 && <p className="border-2 border-dashed border-border bg-card p-4 text-center text-sm text-muted-foreground">No requests right now.</p>}
                {requests.map((request) => <RequestCard key={request.id} request={request} done={() => finishRequest(request)} />)}
              </div>
            </section>
          )}
          <section>
            <h3 className="font-hand text-3xl font-bold">Incoming Orders</h3>{summary && summary.orderCount > orders.length && <p className="text-xs text-muted-foreground">Showing the latest {orders.length} of {summary.orderCount} orders.</p>}
            <div role="group" aria-label="Show orders" className="mt-3 grid grid-cols-3 gap-1 rounded-md border border-border bg-card p-1">
              {([["pending", "Pending"], ["done", "Fulfilled"], ["all", "All"]] as const).map(([value, label]) => (
                <Button key={value} size="sm" variant={orderFilter === value ? "default" : "ghost"} aria-pressed={orderFilter === value} className="h-auto min-h-8 whitespace-normal px-1 text-xs leading-tight" onClick={() => setOrderFilter(value)}>{label} ({orderCounts[value]})</Button>
              ))}
            </div>
            <label className="relative mt-2 block"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input type="search" className="pl-9" placeholder="Name, mobile, room or order #" aria-label="Search orders" value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} /></label>
            <div className="mt-4 space-y-3">
              {shownOrders.length === 0 && <p className="border-2 border-dashed border-border bg-card p-6 text-center text-muted-foreground">{orders.length === 0 ? "No orders yet." : orderSearch.trim() ? "No orders match your search." : orderFilter === "pending" ? "All caught up: no pending orders. 🎉" : "No orders here yet."}</p>}
              {shownOrders.map((order) => <OrderCard key={order.id} order={order} busy={updatingOrder === order.id} setFulfilled={(fulfilled, paymentReceived) => void setFulfilled(order, fulfilled, paymentReceived)} setPaymentReceived={(received) => void setPaymentReceived(order, received)} products={products} giveGift={(index, productId) => void giveGift(order, index, productId)} />)}
            </div>
          </section>
        </aside>
      </div>
      </>)}

      {page === "summary" && (<>
      <SalesSummaryPanel summary={summary} />
      <section className="mt-6" aria-labelledby="analytics-title">
        <div className="flex items-center gap-2"><TrendingUp className="size-7 text-primary" /><h3 id="analytics-title" className="font-hand text-3xl font-bold">Analytics</h3></div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <article className="rounded-md border border-border bg-card p-4"><h4 className="font-hand text-xl font-bold">Items sold</h4><BarList label="Items sold" color="var(--primary)" rows={analytics.performance.map((item) => ({ name: item.name, value: item.sold }))} /></article>
          <article className="rounded-md border border-border bg-card p-4"><h4 className="font-hand text-xl font-bold">Wishlist requests</h4><BarList label="Wishlist requests" color="var(--secondary)" rows={analytics.wishlist.map((item) => ({ name: item.name, value: item.requests }))} /></article>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <AnalyticsList title="🏆 Best Sellers" items={analytics.best.map((item) => `${item.name} · ${item.sold} sold`)} />
          <AnalyticsList title="🐢 Slow Movers" items={analytics.slow.map((item) => `${item.name} · ${item.sold} sold`)} />
          <AnalyticsList title="📦 Restock Advice" items={analytics.performance.filter((item) => item.sold > 0 || item.stock <= 3).sort((a,b) => b.sold-a.sold).slice(0,3).map((item) => `Buy +${Math.max(5, Math.ceil(Math.max(item.sold * 2, 10) / 5) * 5)} units of ${item.name} for next week`)} />
        </div>
      </section>
      </>)}
    </div>
  );
}

/** What an offer card gives at checkout (see quote in lib/pricing.ts), under its text. */
function OfferAmounts({ offer, change }: { offer: DailyOffer; change: (patch: Partial<DailyOffer>) => void }) {
  const amount = (label: string, field: "percent" | "gift" | "pickUpTo" | "every", value: number, min: number, max: number) => (
    <label className="grid gap-1 text-xs font-bold">
      {label}
      <Input
        key={value}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step="1"
        aria-label={`${offer.id} ${label}`}
        defaultValue={value}
        // Kept when leaving the box (tapping Save does that first); anything but a whole number in range goes back.
        onBlur={(event) => {
          const n = Number(event.target.value);
          if (!event.target.value.trim() || !Number.isInteger(n) || n < min || n > max) { event.target.value = String(value); toast.error(`${label}: enter a whole number from ${min} to ${max}.`); return; }
          if (n !== value) change({ [field]: n });
        }}
      />
    </label>
  );
  const gives = offerGives(offer);
  return (
    <div className="grid gap-2 rounded-md border border-dashed border-primary/30 bg-card p-2">
      <p className="text-xs font-bold text-primary">Checkout gives: {gives}</p>
      {offer.id === "first" && amount("Discount (%)", "percent", offer.percent ?? OFFER_DEFAULTS.firstPercent, 0, 100)}
      {offer.id === "bulk" && (
        <div className="grid grid-cols-2 gap-2">
          {amount("Discount (%)", "percent", offer.percent ?? OFFER_DEFAULTS.bulkPercent, 0, 100)}
          {amount("Free chocolate (₹, 0 = none)", "gift", offer.gift ?? 0, 0, 1000)}
          <label className="col-span-2 flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={Boolean(offer.freeDelivery)} onChange={(event) => change({ freeDelivery: event.target.checked })} /> Free room delivery</label>
        </div>
      )}
      {offer.id === "tier50" && amount("Free chocolate (₹, 0 = none)", "gift", offer.gift ?? OFFER_DEFAULTS.tier50Gift, 0, 1000)}
      {offer.id === "tier100" && amount("Free pick: any item with MRP up to (₹)", "pickUpTo", offer.pickUpTo ?? FREE_PICK_VALUE, 1, 1000)}
      {offer.id === "loyalty" && (
        <div className="grid grid-cols-2 gap-2">
          {amount("Every how many orders", "every", offer.every ?? OFFER_DEFAULTS.loyaltyEvery, 2, 100)}
          {amount("Free pick: MRP up to (₹)", "pickUpTo", offer.pickUpTo ?? OFFER_DEFAULTS.loyaltyPickUpTo, 1, 1000)}
        </div>
      )}
    </div>
  );
}

/** 2nd, 3rd, 10th, 21st... */
function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** In words, what checkout gives for an offer card (its amounts, not its text). */
function offerGives(offer: DailyOffer): string {
  const rupees = (value: number) => `₹${value}`;
  switch (offer.id) {
    case "first":
      return `${offer.percent ?? OFFER_DEFAULTS.firstPercent}% off a customer's first order`;
    case "bulk": {
      const parts = [
        (offer.percent ?? OFFER_DEFAULTS.bulkPercent) > 0 ? `${offer.percent ?? OFFER_DEFAULTS.bulkPercent}% off` : "",
        offer.freeDelivery ? "free room delivery" : "",
        offer.gift ? `a free ${rupees(offer.gift)} chocolate` : "",
      ].filter(Boolean);
      return `on carts over ₹200: ${parts.length ? parts.join(" + ") : "nothing (set an amount)"}`;
    }
    case "tier50":
      return (offer.gift ?? OFFER_DEFAULTS.tier50Gift) > 0 ? `a free ${rupees(offer.gift ?? OFFER_DEFAULTS.tier50Gift)} chocolate from ₹50` : "nothing (set an amount)";
    case "tier100":
      return offer.pickUpTo == null ? "a free item she picks, MRP up to ₹12, from ₹100" : `a free item she picks, MRP up to ${rupees(offer.pickUpTo)}, from ₹100`;
    case "loyalty":
      return `every ${ordinal(offer.every ?? OFFER_DEFAULTS.loyaltyEvery)} completed order: a free item she picks, MRP up to ${rupees(offer.pickUpTo ?? OFFER_DEFAULTS.loyaltyPickUpTo)} (on top of any other offer)`;
  }
}

/** What to buy: items at or under their restock level (how many, from what sells) and what customers asked
 * for, to send on WhatsApp or copy. */
function ShoppingList({ products, sold, wishes }: { products: Product[]; sold: { name: string; qty: number }[]; wishes: Wish[] }) {
  const sales = new Map(sold.map((item) => [item.name, item.qty] as const));
  const restock = products
    .filter((item) => item.stock <= item.threshold)
    .map((item) => ({ item, buy: restockBuy(item, sales.get(item.name) ?? 0) }))
    .sort((a, b) => a.item.stock - b.item.stock || a.item.name.localeCompare(b.item.name));
  const asked = wishes.slice(0, 8);
  const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const text = [
    `🛒 Kannagi Night Mart shopping list (${today})`,
    ...(restock.length ? ["", "Restock:", ...restock.map(({ item, buy }) => `• ${item.name}: buy ${buy} (${item.stock} left)`)] : []),
    ...(asked.length ? ["", "Customers asked for:", ...asked.map((wish) => `• ${wish.name} (${plural(wish.count, "request")})`)] : []),
  ].join("\n");
  const empty = !restock.length && !asked.length;
  async function copy() {
    try { await navigator.clipboard.writeText(text); toast.success("Shopping list copied."); } catch { toast.error("Couldn't copy here: select the list and copy it."); }
  }
  return (
    <div aria-label="Shopping list" className="mt-3 rounded-md bg-card p-4 text-foreground">
      {empty ? <p className="text-sm">Nothing to buy: stock is above every restock level and no one has asked for anything. ✨</p> : <pre className="whitespace-pre-wrap font-sans text-sm">{text}</pre>}
      {!empty && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild size="sm"><a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer"><MessageCircle /> Send on WhatsApp</a></Button>
          <Button size="sm" variant="outline" onClick={() => void copy()}><ClipboardCopy /> Copy</Button>
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">Buys at least 5, enough for twice the restock level or what has sold so far.</p>
    </div>
  );
}

/** How many to buy: at least 5, enough for twice the restock level or what has sold so far. */
const restockBuy = (item: Product, sold: number) => Math.max(5, Math.ceil((Math.max(item.threshold * 2, sold) - item.stock) / 5) * 5);

/** The Restock page: items at or under their restock level, by shelf section (out of stock first in each),
 * and the shopping list. */
function RestockPanel({ products, sold, wishes, onEdit }: { products: Product[]; sold: { name: string; qty: number }[]; wishes: Wish[]; onEdit: (id: number) => void }) {
  const [shoppingOpen, setShoppingOpen] = useState(false);
  const sales = new Map(sold.map((item) => [item.name, item.qty] as const));
  const low = products.filter((item) => item.stock <= item.threshold);
  const bySection = new Map<string, Product[]>();
  for (const item of low) {
    const section = item.category || "Snacks";
    bySection.set(section, [...(bySection.get(section) ?? []), item]);
  }
  const rank = (section: string) => (CATEGORIES.includes(section) ? CATEGORIES.indexOf(section) : CATEGORIES.length);
  const sections = [...bySection.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([section, items]) => [section, items.sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name))] as const);
  const out = low.filter((item) => item.stock === 0).length;
  return (
    <section aria-labelledby="restock-title" className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><AlertTriangle className="size-7 text-primary" /><h3 id="restock-title" className="font-hand text-3xl font-bold">Restock</h3></div>
        <Button variant="secondary" onClick={() => setShoppingOpen((open) => !open)} aria-expanded={shoppingOpen}><ShoppingCart /> Shopping list</Button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{low.length === 0 ? "Everything is stocked up ✨" : `${plural(low.length, "item")} at or under the restock level${out ? `, ${out} out of stock` : ""}. Customers don't see sold-out items.`}</p>
      {shoppingOpen && <ShoppingList products={products} sold={sold} wishes={wishes} />}
      <div className="mt-4 space-y-3">
        {sections.map(([section, items]) => {
          const empty = items.filter((item) => item.stock === 0).length;
          return (
            <details key={section} open className="group rounded-md border-2 border-foreground/10 bg-card shadow-[3px_4px_0_var(--shadow-color)]">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
                <h4 className="min-w-0 flex-1 font-hand text-xl font-bold">{section}</h4>
                <span className="text-xs font-bold text-muted-foreground">{plural(items.length, "item")}{empty ? ` · ${empty} out` : ""}</span>
                <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
              </summary>
              <ul aria-label={`Restock: ${section}`} className="grid grid-cols-1 gap-2 border-t border-border p-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((item) => (
                  <li key={item.id} className="flex min-w-0 items-center gap-2 rounded-md bg-background px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold" title={item.name}>{item.name}</p>
                      <p className="text-xs text-muted-foreground">Restock at {item.threshold} · buy {restockBuy(item, sales.get(item.name) ?? 0)}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${item.stock === 0 ? "bg-alert text-alert-foreground" : "bg-accent text-accent-foreground"}`}>{item.stock === 0 ? "Out" : `${item.stock} left`}</span>
                    <Button size="icon" variant="ghost" className="size-8 shrink-0" aria-label={`Update ${item.name}'s stock`} title="Update stock" onClick={() => onEdit(item.id)}><PackagePlus /></Button>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
    </section>
  );
}

/** The reward a slice can give, as the shopkeeper picks it ("₹ off" is three5; four10 is the same). */
const SLICE_REWARDS: { value: CouponKind | "luck"; label: string }[] = [
  { value: "three5", label: "₹ OFF the order" },
  { value: "free60", label: "FREE room delivery" },
  { value: "halfDelivery", label: "50% OFF room delivery" },
  { value: "freeSnack100", label: "A free snack" },
  { value: "premium5", label: "₹ OFF on 2 premium items (₹45+)" },
  { value: "luck", label: "Better Luck Next Time (no prize)" },
];

/** A slice with its text made from what it gives (the server does the same when it saves). */
function withText(prize: WheelPrize): WheelPrize {
  return { ...prize, ...prizeText(prizeTerms(prize)) };
}

/** A whole-number box: kept when leaving it; anything else goes back, with a message. */
function WholeNumber({ label, ariaLabel, value, min, max, change }: { label: string; ariaLabel: string; value: number; min: number; max: number; change: (value: number) => void }) {
  return (
    <label className="grid gap-1 text-xs font-bold">
      {label}
      <Input
        key={value}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step="1"
        aria-label={ariaLabel}
        defaultValue={value}
        onBlur={(event) => {
          const n = Number(event.target.value);
          if (!event.target.value.trim() || !Number.isInteger(n) || n < min || n > max) { event.target.value = String(value); toast.error(`${label}: enter a whole number from ${min} to ${max}.`); return; }
          if (n !== value) change(n);
        }}
      />
    </label>
  );
}

/** The Spin wheel page of the dashboard: on/off for customers (at once), what each slice gives and the
 * cart it needs (its text is made from those, so the wheel always says what checkout gives), a preview,
 * and which wins when a coupon and an offer both apply. */
function WheelEditor({ prizes, setPrizes, couponRule, setCouponRule, enabled, switchWheel, unsaved, saving, save }: { prizes: WheelPrize[]; setPrizes: React.Dispatch<React.SetStateAction<WheelPrize[]>>; couponRule: CouponRule; setCouponRule: (value: CouponRule) => void; enabled: boolean; switchWheel: (enabled: boolean) => Promise<void>; unsaved: boolean; saving: boolean; save: () => void }) {
  const [switching, setSwitching] = useState(false);
  const change = (index: number, patch: Partial<WheelPrize>) => setPrizes((current) => current.map((item, itemIndex) => (itemIndex === index ? withText({ ...item, ...patch }) : item)));
  function pickReward(index: number, value: string) {
    if (value === "luck") { change(index, { kind: null, minOrder: null, minItems: null, amount: null }); return; }
    const kind = value as CouponKind;
    change(index, { kind, ...COUPON_DEFAULTS[kind] });
  }
  async function flip() {
    setSwitching(true);
    try { await switchWheel(!enabled); } finally { setSwitching(false); }
  }
  const active = prizes.filter((prize) => prize.active);
  const saveButton = (wide = false) => <Button className={wide ? "mt-4 w-full" : ""} onClick={save} disabled={saving}><Check /> {saving ? "Saving…" : "Save wheel"}</Button>;
  return (
    <div className="mt-5 grid gap-5">
      <section aria-labelledby="wheel-switch-title" className={`border-2 border-dashed p-4 shadow-[4px_5px_0_var(--shadow-color)] ${enabled ? "border-primary/35 bg-card" : "border-alert bg-alert/15"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2"><h3 id="wheel-switch-title" className="font-hand text-2xl font-bold">Spin &amp; Win for customers</h3><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${enabled ? "bg-stock text-stock-foreground" : "bg-alert text-alert-foreground"}`}>{enabled ? "On" : "Off"}</span></div>
            <p className="mt-1 text-sm text-muted-foreground">{enabled ? "Customers see the Spin & Win page and can spin once a day." : "Customers don't see the wheel and can't spin. Coupons they already won still work until they end (48 hours)."} This switch works at once (no Save needed).</p>
          </div>
          <Button variant={enabled ? "outline" : "default"} onClick={() => void flip()} disabled={switching}>{switching ? "Switching…" : enabled ? "Turn off Spin & Win" : "Turn on Spin & Win"}</Button>
        </div>
      </section>

      <section aria-labelledby="wheel-slices-title" className="border-2 border-dashed border-primary/35 bg-card p-4 shadow-[4px_5px_0_var(--shadow-color)]">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 id="wheel-slices-title" className="font-hand text-2xl font-bold">Wheel slices</h3><p className="text-sm text-muted-foreground">Pick what each slice gives and what the cart needs. Its text on the wheel is written from those, so checkout always gives what the wheel says.</p></div>{saveButton()}</div>
        {unsaved && <p role="status" className="mt-3 rounded-md bg-accent px-3 py-2 text-sm font-bold text-accent-foreground">Not saved yet: customers still see the old wheel. Tap Save wheel.</p>}
        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {prizes.map((prize, index) => {
              const name = `Slice ${index + 1}`;
              const kind = prize.kind === "four10" ? "three5" : prize.kind;
              const terms = prizeTerms(prize);
              return (
                <article key={`${prize.code}-${index}`} aria-label={name} className={`grid min-w-0 content-start gap-2 rounded-md border p-3 ${prize.active ? "border-border bg-background" : "border-dashed border-border bg-muted/40 opacity-75"}`}>
                  <div className="flex items-center justify-between gap-2"><span className="text-xs font-bold text-muted-foreground">{name}</span><label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" aria-label={`${name} on the wheel`} checked={prize.active} onChange={(event) => change(index, { active: event.target.checked })} /> On the wheel</label></div>
                  <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2">
                    <Input aria-label={`${name} icon`} maxLength={16} value={prize.icon} onChange={(event) => change(index, { icon: event.target.value })} />
                    <select aria-label={`${name} gives`} value={kind ?? "luck"} onChange={(event) => pickReward(index, event.target.value)} className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm">
                      {SLICE_REWARDS.map((reward) => <option key={reward.value} value={reward.value}>{reward.label}</option>)}
                    </select>
                  </div>
                  {terms && (
                    <div className="grid grid-cols-2 gap-2">
                      {!isDeliveryCoupon(terms.kind) && <WholeNumber label={terms.kind === "freeSnack100" ? "Snack worth up to (₹)" : "₹ OFF"} ariaLabel={`${name} amount`} value={terms.amount} min={1} max={500} change={(amount) => change(index, { amount })} />}
                      <WholeNumber label="Min. order (₹, 0 = any)" ariaLabel={`${name} minimum order`} value={terms.minOrder} min={0} max={5000} change={(minOrder) => change(index, { minOrder })} />
                      <WholeNumber label="Min. items (0 = any)" ariaLabel={`${name} minimum items`} value={terms.minItems} min={0} max={50} change={(minItems) => change(index, { minItems })} />
                    </div>
                  )}
                  <p className="rounded-md bg-card px-2 py-1 text-sm font-bold text-primary">Wheel says: {prize.icon} {prize.label}</p>
                  {terms && !isDeliveryCoupon(terms.kind) && terms.minOrder > 0 && terms.amount >= terms.minOrder && <p className="text-xs font-bold text-destructive">This gives as much as the whole minimum order.</p>}
                </article>
              );
            })}
          </div>
          <aside aria-label="Wheel preview" className="grid content-start justify-items-center gap-2 rounded-md border border-border bg-background p-3 text-center">
            <p className="text-sm font-bold">Preview ({active.length} slices on)</p>
            <WheelDisc prizes={active} className="size-64" />
            <p className="text-xs text-muted-foreground">How customers will see it after you save.</p>
          </aside>
        </div>
        <label className="mt-5 grid gap-1 text-sm font-bold">When a spin coupon and an offer both apply
          <select aria-label="Coupon rule" value={couponRule} onChange={(event) => setCouponRule(event.target.value as CouponRule)} className="h-10 w-full min-w-0 rounded-md border border-input bg-card px-2 font-normal">
            <option value="best">Bigger saving wins</option>
            <option value="coupon">Always use the spin coupon</option>
          </select>
          <span className="text-xs font-normal text-muted-foreground">{couponRule === "best" ? "If the offer saves more, the customer keeps her coupon for a later order." : "An eligible spin coupon is used even when an offer would save more."}</span>
        </label>
        <p className="mt-3 text-xs text-muted-foreground">Keep at least two slices on, including one Better Luck slice. A coupon already won keeps the terms it was won with.</p>
        {saveButton(true)}
      </section>
    </div>
  );
}

type DashboardPage = "dashboard" | "restock" | "wheel" | "manual" | "summary";
const DASHBOARD_PAGES: { id: DashboardPage; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "restock", label: "Restock", icon: AlertTriangle },
  { id: "wheel", label: "Spin wheel", icon: Sparkles },
  { id: "manual", label: "Manual sale", icon: Receipt },
  { id: "summary", label: "Summary", icon: TrendingUp },
];

const orderTime = (ms: number) => new Date(ms).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** One order for the shopkeeper: who it's for (name, mobile with Call / WhatsApp, where to hand it over), then what's in it. */
/** One order as the shopkeeper sees it; `cancel` adds the site admin's Cancel button. */
const requestItems = (request: OrderRequest) => request.items.map((item) => `${item.name} ×${item.qty}`).join(", ");

/** Her request on the shop page: what she asked for, and Withdraw. */
function MyRequestNote({ request, takingOrders, onWithdraw }: { request: OrderRequest; takingOrders: boolean; onWithdraw: () => void }) {
  return (
    <div role="status" aria-label="Your request" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-card/95 px-4 py-3 text-sm font-semibold text-foreground shadow-[3px_4px_0_var(--shadow-color)]">
      <p className="min-w-0 flex-1 basis-60">📨 Your request was sent {orderTime(request.createdAt)}: {requestItems(request)}. {takingOrders ? "The shop is taking orders now: you can order these from your cart." : "The shopkeeper will get in touch with you."}</p>
      <Button size="sm" variant="outline" onClick={onWithdraw}>Withdraw</Button>
    </div>
  );
}

/** In the cart while the shop isn't taking orders: the delivery she'd like, a note, and Send. */
function RequestForm({ cartItems, deliveries, myRequest, subtotal, onRequest }: { cartItems: (Product & { qty: number })[]; deliveries: readonly string[]; myRequest: OrderRequest | null; subtotal: number; onRequest: (input: OrderRequestInput) => Promise<void> }) {
  const [delivery, setDelivery] = useState<Delivery>((deliveries[0] as Delivery | undefined) ?? "Pickup");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  async function send() {
    if (sending || !cartItems.length) return;
    setSending(true);
    try {
      await onRequest({ items: cartItems.map((item) => ({ productId: item.id, quantity: item.qty })), delivery, ...(note.trim() ? { note: note.trim() } : {}) });
    } finally {
      setSending(false);
    }
  }
  return (
    <>
      {myRequest && <p className="mt-4 rounded-md border-2 border-dashed border-primary/35 bg-card p-3 text-sm">You already sent a request {orderTime(myRequest.createdAt)} ({requestItems(myRequest)}). Sending again replaces it.</p>}
      <div className="mt-4 flex justify-between text-sm"><span>Items at today&apos;s prices</span><span>{money(subtotal)}</span></div>
      <div className="mt-4 grid gap-2">
        <p className="font-hand text-xl font-bold">How would you like it?</p>
        <div role="group" aria-label="Request delivery" className="grid grid-cols-2 gap-2">
          {deliveries.map((option) => <Button key={option} type="button" variant={delivery === option ? "default" : "outline"} aria-pressed={delivery === option} onClick={() => setDelivery(option as Delivery)}>{option}</Button>)}
        </div>
      </div>
      <label className="mt-4 grid gap-1 text-sm font-semibold">Note for the shopkeeper (optional)<textarea aria-label="Request note" maxLength={200} rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. I'm awake till 1 am" className="rounded-md border border-input bg-card px-3 py-2 text-sm font-normal" /></label>
      <Button onClick={() => void send()} disabled={sending} className="mt-4 h-12 w-full text-base"><Send /> {sending ? "Sending…" : myRequest ? "Send new request" : "Send request to the shop"}</Button>
    </>
  );
}

/** A customer's request on the dashboard: who, where, what, and Done. */
function RequestCard({ request, done }: { request: OrderRequest; done: () => void }) {
  const { name, phone, block, room } = request.customer ?? {};
  const hostelRoom = block && room ? `Block ${block}, Room ${room}` : room ? `Room ${room}` : null;
  const call = phone ? callLink(phone) : undefined;
  const chat = phone ? whatsappChat(phone, `Hi${name ? ` ${name}` : ""}! About your Kannagi Night Mart request (${requestItems(request)}): `) : undefined;
  return (
    <article aria-label={`Request from ${name ?? "a customer"}`} className="min-w-0 border-2 border-primary/30 bg-card p-4 [overflow-wrap:anywhere] shadow-[3px_4px_0_var(--shadow-color)]">
      <div className="flex items-baseline justify-between gap-2"><p className="font-hand text-xl font-bold">{name ?? "Name not saved"}</p><span className="text-xs text-muted-foreground">{orderTime(request.createdAt)}</span></div>
      {phone ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="tabular-nums">{formatMobile(phone)}</span>
          {call && <a className="inline-flex items-center gap-1 font-semibold text-primary underline" href={call}><Phone className="size-3.5" />Call</a>}
          {chat && <a className="inline-flex items-center gap-1 font-semibold text-primary underline" href={chat} target="_blank" rel="noopener noreferrer"><MessageCircle className="size-3.5" />WhatsApp</a>}
        </p>
      ) : <p className="text-sm text-muted-foreground">No mobile number saved</p>}
      <p className="mt-1 text-sm">{request.delivery === "Room Delivery" ? <>🚚 Room delivery{hostelRoom ? ` to ${hostelRoom}` : ""}</> : <>🛍️ Pickup{hostelRoom ? ` · stays in ${hostelRoom}` : ""}</>}</p>
      <p className="mt-2 text-sm font-semibold">{requestItems(request)}</p>
      {request.note && <p className="mt-1 rounded-md bg-background/70 p-2 text-sm">“{request.note}”</p>}
      <Button className="mt-3 w-full" variant="secondary" onClick={done}><Check /> Done</Button>
    </article>
  );
}

// An order's free chocolate or snack: before the shop says which item it gave ("₹5 chocolate (free)",
// "₹10 free snack"), and after ("5 Star Mini (free ₹5 chocolate)"). See backend services.GIFT / GIVEN.
const GIFT_TEXT = /^₹(\d+(?:\.\d+)?) (?:chocolate \(free\)|free snack)$/;
const GIVEN_TEXT = /^(.+) \(free ₹(\d+(?:\.\d+)?) (chocolate|snack)\)$/;

/** Which item the shop gave for a free chocolate or snack; picking one takes it off the stock. */
function GiftChoice({ freebie, products, busy, label, choose }: { freebie: string; products: Product[]; busy: boolean; label: string; choose: (productId: number | null) => void }) {
  const given = GIVEN_TEXT.exec(freebie);
  const generic = GIFT_TEXT.exec(freebie);
  if (!given && !generic) return null;
  const chocolate = given ? given[3] === "chocolate" : freebie.includes("chocolate");
  const current = given ? products.find((product) => product.name === given[1]) : undefined;
  // Items that can be given (in stock, or the one already given); chocolates first for a free chocolate.
  const first = (product: Product) => Number(chocolate && /choc/i.test(product.category));
  const choices = products
    .filter((product) => product.stock > 0 || product.id === current?.id)
    .sort((a, b) => first(b) - first(a) || a.mrp - b.mrp || a.name.localeCompare(b.name));
  return (
    <label className={`mt-2 grid gap-1 rounded-md p-2 text-xs font-bold ${given ? "bg-background/70" : "bg-accent text-accent-foreground"}`}>
      {given ? `Free ${chocolate ? "chocolate" : "snack"} given (off the stock)` : `Which ${chocolate ? "chocolate" : "snack"} did you give free? It comes off the stock.`}
      <select aria-label={label} disabled={busy} value={current?.id ?? ""} onChange={(event) => choose(event.target.value ? Number(event.target.value) : null)} className="h-9 rounded-md border border-input bg-card px-2 text-sm font-normal text-foreground">
        <option value="">{given ? "None from the shop's stock (put it back)" : "Choose the item you gave…"}</option>
        {choices.map((product) => <option key={product.id} value={product.id}>{product.name} · ₹{product.mrp} · {product.stock} left</option>)}
      </select>
    </label>
  );
}

export function OrderCard({ order, busy, setFulfilled, setPaymentReceived, cancel, products, giveGift }: { order: AdminOrder; busy: boolean; setFulfilled: (fulfilled: boolean, paymentReceived?: boolean) => void; setPaymentReceived: (received: boolean) => void; cancel?: () => void; products?: Product[]; giveGift?: (index: number, productId: number | null) => void }) {
  // A UPI order whose payment isn't ticked yet: handing it over says the money arrived, so ask first.
  const handOver = () => {
    if (!awaitingConfirmation(order)) return setFulfilled(true);
    const reference = order.utr ? `She sent UPI reference ${order.utr}.` : "She hasn't sent a UPI reference.";
    if (window.confirm(`Did ${money(order.total)} arrive by UPI for order ${orderLabel(order)}?\n\n${reference} Only tap OK if you can see the money in PhonePe or your bank app: this confirms the payment and marks the order as fulfilled.`)) setFulfilled(true, true);
  };
  const { name, phone, email, block, room } = order.customer;
  const hostelRoom = block && room ? `Block ${block}, Room ${room}` : room ? `Room ${room}` : null;
  const call = phone ? callLink(phone) : undefined;
  const chat = phone ? whatsappChat(phone, `Hi${name ? ` ${name}` : ""}! About your Kannagi Night Mart order ${orderLabel(order)}: `) : undefined;
  return (
    <article aria-label={`Order ${orderLabel(order)}`} className={`min-w-0 border-2 border-foreground/10 p-4 [overflow-wrap:anywhere] shadow-[3px_4px_0_var(--shadow-color)] ${order.fulfilled || order.cancelled ? "bg-muted" : "bg-card"}`}>
      <div className="flex items-baseline justify-between gap-2"><p className="font-hand text-xl font-bold">Order {orderLabel(order)}</p><b>{money(order.total)}</b></div>
      <p className="text-xs text-muted-foreground">{orderTime(order.createdAt)}</p>
      {order.cancelled && <p className="mt-1 inline-block rounded-full bg-destructive px-2 py-0.5 text-[11px] font-bold text-destructive-foreground">✕ Cancelled by the admin: stock returned</p>}
      {awaitingConfirmation(order) && <p className="mt-1 inline-block rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-foreground">⏳ Not confirmed: payment to be confirmed</p>}
      <div aria-label="Customer" className="mt-2 space-y-1 rounded-md border border-border bg-background/70 p-3 text-sm">
        <p className="font-bold">{name ?? "Name not saved"}</p>
        {phone ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="tabular-nums">{formatMobile(phone)}</span>
            {call && <a className="inline-flex items-center gap-1 font-semibold text-primary underline" href={call}><Phone className="size-3.5" />Call</a>}
            {chat && <a className="inline-flex items-center gap-1 font-semibold text-primary underline" href={chat} target="_blank" rel="noopener noreferrer"><MessageCircle className="size-3.5" />WhatsApp</a>}
          </p>
        ) : <p className="text-muted-foreground">No mobile number saved</p>}
        <p>{order.delivery === "Room Delivery" ? <>🚚 <b>Deliver to {hostelRoom ?? order.details}</b></> : <>🛍️ <b>Pickup</b> from the shop{hostelRoom ? ` · stays in ${hostelRoom}` : ""}</>}</p>
        {email && <p className="break-all text-xs text-muted-foreground">{email}</p>}
      </div>
      <p className="mt-2 text-sm">{order.items.map((item) => `${item.name} ×${item.qty}`).join(", ")}</p>
      {order.freebies?.length ? <p className="text-xs font-bold text-primary">Free: {order.freebies.join(", ")}</p> : null}
      {giveGift && products && !order.cancelled && order.freebies.map((freebie, index) => <GiftChoice key={index} freebie={freebie} products={products} busy={busy} label={`Free item given with order ${orderLabel(order)}`} choose={(productId) => giveGift(index, productId)} />)}
      {order.cancelled ? null : order.payment === "UPI" ? (
        <div aria-label="Payment" className={`mt-2 rounded-md p-2 text-xs ${order.paymentConfirmed ? "bg-stock/40" : "bg-accent/60"}`}>
          <p className="font-bold">{order.paymentConfirmed ? "✓ UPI payment received" : order.utr ? "UPI · paid, please check" : "UPI · ⏳ waiting for payment"} · {money(order.total)}</p>
          {order.utr ? <p>UTR <span className="font-mono">{order.utr}</span>{order.paymentConfirmed ? "" : ": find this in your PhonePe / bank app"}</p> : !order.paymentConfirmed && <p>She hasn&apos;t sent a payment reference yet.</p>}
          {order.paymentConfirmed
            ? <Button size="sm" variant="ghost" className="mt-1 h-7 px-2" disabled={busy} onClick={() => setPaymentReceived(false)}>Undo</Button>
            : <Button size="sm" variant="outline" className="mt-2 w-full bg-card" disabled={busy} onClick={() => setPaymentReceived(true)}><Check /> Payment received</Button>}
        </div>
      ) : <p className="mt-1 text-xs text-muted-foreground">Payment: Pay on Delivery (collect {money(order.total)})</p>}
      {order.discount ? <p className="text-xs text-muted-foreground">Discount: {order.discountLabel} (−{money(order.discount)})</p> : null}
      {order.onRequest && <span className="mt-2 inline-block rounded-full bg-accent px-2 py-1 text-[11px] font-bold text-accent-foreground">On request (store was offline)</span>}
      {order.cancelled ? null : order.fulfilled ? (
        <div className="mt-3 flex items-center justify-between gap-2"><span className="inline-flex items-center gap-1 text-sm font-bold text-stock-foreground"><Check className="size-4" /> Fulfilled</span><Button size="sm" variant="ghost" disabled={busy} onClick={() => setFulfilled(false)}>Undo</Button></div>
      ) : <Button className="mt-3 w-full" disabled={busy} onClick={handOver}>{busy ? "Saving…" : "Mark as Fulfilled"}</Button>}
      {cancel && !order.cancelled && !order.fulfilled && <Button variant="outline" className="mt-2 w-full border-destructive/60 text-destructive" disabled={busy} onClick={cancel}><X /> Cancel order</Button>}
    </article>
  );
}

function AnalyticsList({ title, items }: { title: string; items: string[] }) {
  return <article className="rounded-md border-2 border-dashed border-primary/30 bg-product p-4"><h4 className="font-hand text-xl font-bold">{title}</h4><ol className="mt-3 space-y-2 text-sm font-semibold">{items.length ? items.map((item, index) => <li key={item}>{index + 1}. {item}</li>) : <li className="text-muted-foreground">Place orders to see insights.</li>}</ol></article>;
}

function OrderHistory({ orders, onOpen, onPay, onEditProfile, onOrderAgain, loyalty }: { orders: Order[]; onOpen: (order: Order) => void; onPay: (order: Order) => void; onEditProfile: () => void; onOrderAgain: (order: Order) => void; loyalty: Loyalty | null }) {
  return (
    <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6 [overflow-wrap:anywhere]">
      <p className="font-hand text-lg font-bold text-primary">Saved to your account</p>
      <div className="flex flex-wrap items-end justify-between gap-3"><h2 className="font-display text-4xl font-extrabold">My Orders</h2><Button variant="outline" size="sm" onClick={onEditProfile}>Edit my hostel details</Button></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <NotificationsCard />
        {loyalty?.active && <LoyaltyCard loyalty={loyalty} />}
      </div>
      {orders.length === 0 ? <p className="mt-6 border-2 border-dashed border-border bg-card p-8 text-center text-muted-foreground">Your first order will appear here.</p> : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {orders.map((order) => (
            <article key={order.id} className="rounded-md border-2 border-dashed border-primary/30 bg-card p-5 shadow-[4px_5px_0_var(--shadow-color)]">
              <div className="flex items-start justify-between gap-3"><div><h3 className="font-hand text-2xl font-bold">Order {orderLabel(order)}</h3><p className="text-xs text-muted-foreground">{order.createdAt ? new Date(order.createdAt).toLocaleString() : ""}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${orderState(order).waiting ? "bg-accent text-accent-foreground" : "bg-stock text-stock-foreground"}`}>{orderState(order).badge}</span></div>
              <p className="mt-3 text-sm">{order.items.map((item) => `${item.name} ×${item.qty}`).join(", ")}</p>
              <p className="mt-2 text-sm text-muted-foreground">{order.delivery} · {order.payment}</p>
              <p className="text-sm font-semibold">{orderState(order).detail}</p>
              {needsPayment(order) && <Button size="sm" className="mt-2 w-full" onClick={() => onPay(order)}>Pay {money(order.total)} now</Button>}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><b className="text-xl text-primary">{money(order.total)}</b><div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => onOrderAgain(order)} aria-label={`Order ${orderLabel(order)} again`}><RotateCcw /> Order again</Button><Button size="sm" variant="outline" onClick={() => onOpen(order)}>View receipt</Button></div></div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

/** Her loyalty card: a stamp per completed order; every `every` stamps, a free item at checkout. */
function LoyaltyCard({ loyalty }: { loyalty: Loyalty }) {
  return (
    <section aria-labelledby="loyalty-title" className="rounded-md border-2 border-dashed border-primary/40 bg-banner p-4 shadow-[3px_4px_0_var(--shadow-color)]">
      <h3 id="loyalty-title" className="font-hand text-2xl font-bold">🎟️ Loyalty card</h3>
      <div aria-label={`${loyalty.stamps} of ${loyalty.every} stamps`} className="mt-2 flex flex-wrap gap-1">
        {Array.from({ length: loyalty.every }, (_, index) => <span key={index} aria-hidden="true" className={`grid size-6 place-items-center rounded-full border-2 text-xs ${index < loyalty.stamps ? "border-primary bg-primary text-primary-foreground" : "border-primary/30 bg-card"}`}>{index < loyalty.stamps ? "★" : ""}</span>)}
      </div>
      <p className="mt-2 text-sm font-semibold">{loyalty.rewards > 0 ? `🎁 ${loyalty.rewards > 1 ? `${loyalty.rewards} rewards` : "A reward"} ready: pick a free item (MRP up to ₹${loyalty.pickUpTo}) at checkout.` : `${loyalty.every - loyalty.stamps} more completed ${loyalty.every - loyalty.stamps === 1 ? "order" : "orders"} for a free item (MRP up to ₹${loyalty.pickUpTo}).`}</p>
    </section>
  );
}

function ProfileForm({ profile, setProfile, submit, close }: { profile: CustomerProfile; setProfile: React.Dispatch<React.SetStateAction<CustomerProfile>>; submit: (event: FormEvent<HTMLFormElement>) => void; close?: () => void }) {
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-foreground/55 p-4 backdrop-blur-sm"><form onSubmit={submit} className="w-full max-w-md rounded-lg border-2 border-dashed border-primary/50 bg-card p-6 shadow-[7px_8px_0_var(--shadow-color)]"><div className="flex items-start justify-between gap-2"><div><p className="font-hand text-lg font-bold text-primary">{close ? "Update anytime" : "Just once"}</p><h2 className="font-display text-3xl font-extrabold">Your hostel details</h2></div>{close && <Button type="button" size="icon" variant="ghost" aria-label="Close" onClick={close}><X /></Button>}</div><p className="mt-1 text-sm text-muted-foreground">These details will be ready at checkout.</p><div className="mt-5 grid gap-3"><Input required maxLength={100} placeholder="Full name" value={profile.fullName} onChange={(event) => setProfile((current) => ({ ...current, fullName: event.target.value }))} /><Input required inputMode="tel" minLength={5} maxLength={20} placeholder="Mobile number" aria-label="Mobile number" value={profile.phone} onChange={(event) => setProfile((current) => ({ ...current, phone: event.target.value }))} /><div className="grid grid-cols-[1fr_2fr] gap-2"><select value={profile.block} onChange={(event) => setProfile((current) => ({ ...current, block: event.target.value as CustomerProfile["block"] }))} className="h-10 rounded-md border border-input bg-background px-3"><option value="A">Block A</option><option value="B">Block B</option><option value="C">Block C</option></select><Input required maxLength={20} placeholder="Room number" value={profile.roomNumber} onChange={(event) => setProfile((current) => ({ ...current, roomNumber: event.target.value }))} /></div></div><Button type="submit" className="mt-5 h-11 w-full">Save &amp; start shopping</Button></form></div>;
}

const MAX_PHOTO_SIZE = 600;

/** A price typed by the shopkeeper, or null if it's empty, not a number, ₹0 or more than ₹1,00,000. */
function parsePrice(value: string): number | null {
  const price = Number(value);
  return value.trim() && Number.isFinite(price) && price > 0 && price <= 100_000 ? Math.round(price * 100) / 100 : null;
}

/** An item's price hike typed by the shopkeeper: whole rupees from 0 to 1000, or null. */
function parseMarkup(value: string): number | null {
  const markup = Number(value);
  return value.trim() && Number.isInteger(markup) && markup >= 0 && markup <= 1000 ? markup : null;
}

// Shrink photos to a small JPEG before upload: quicker on hostel Wi-Fi, and the product list stays light.
// (An animated GIF becomes a still photo.)
function shrinkPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) { reject(new Error("Please choose a photo (an image file).")); return; }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_PHOTO_SIZE / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) { reject(new Error("Could not read that photo.")); return; }
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that photo. Try another one.")); };
    image.src = url;
  });
}

/** A product photo, with buttons to take one with the phone's camera or choose one from the gallery. */
function PhotoPicker({ label, emoji, image, onPick, onRemove, compact = false }: { label: string; emoji: string; image?: string | undefined; onPick: (image: string) => Promise<void> | void; onRemove?: () => Promise<void> | void; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");
  async function run(work: () => Promise<void> | void) {
    setBusy(true);
    try { await work(); } finally { setBusy(false); }
  }
  async function fromFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = ""; // so choosing the same photo again still works
    if (!file) return;
    await run(async () => {
      try { await onPick(await shrinkPhoto(file)); } catch (error) { toast.error(errorText(error, "Could not read that photo.")); }
    });
  }
  const picker = (text: string, Icon: typeof Camera, camera: boolean) => (
    <label className={`inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-input bg-background px-2 text-sm font-semibold hover:bg-accent [&_svg]:size-4 ${busy ? "pointer-events-none opacity-50" : ""}`}>
      <Icon />{text}
      <input type="file" accept="image/*" {...(camera ? { capture: "environment" as const } : {})} className="sr-only" disabled={busy} aria-label={`${text} for ${label}`} onChange={(event) => void fromFile(event.currentTarget)} />
    </label>
  );
  // compact: a square thumbnail with the buttons beside it (inventory cards); otherwise a big preview on top.
  return (
    <div className={compact ? "grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-3" : "grid content-start gap-2"}>
      <div className={`relative grid ${compact ? "aspect-square" : "aspect-[4/3]"} w-full place-items-center overflow-hidden rounded-md border-2 border-dashed border-primary/30 bg-product`}>
        {image ? <img src={image} alt={label} className="h-full w-full object-cover" /> : <div className="grid place-items-center gap-1 text-center text-muted-foreground"><span className={compact ? "text-4xl" : "text-5xl"} aria-hidden="true">{emoji}</span><span className="text-[11px] font-bold">No photo yet</span></div>}
        {busy && <div className="absolute inset-0 grid place-items-center bg-background/75 text-center text-xs font-bold" role="status">Saving photo…</div>}
      </div>
      <div className="grid min-w-0 content-start gap-2">
        <div className={compact ? "grid gap-2" : "grid grid-cols-2 gap-2"}>{picker("Take photo", Camera, true)}{picker("Choose photo", ImagePlus, false)}</div>
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Use a photo link instead</summary>
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Input placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} aria-label={`Photo link for ${label}`} />
            <Button type="button" size="sm" disabled={busy || !link.trim()} onClick={() => void run(async () => { await onPick(link.trim()); setLink(""); })}>Use link</Button>
          </div>
        </details>
        {image && onRemove && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run(onRemove)}>Remove photo</Button>}
      </div>
    </div>
  );
}

/** Horizontal bars drawn with plain HTML (no chart library): biggest first, the longest bar is the biggest value. */
function BarList({ label, color, rows }: { label: string; color: string; rows: { name: string; value: number }[] }) {
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...sorted.map((row) => row.value));
  if (!sorted.length) return <p className="mt-3 text-sm text-muted-foreground">Nothing yet.</p>;
  return (
    <ul aria-label={label} className="mt-3 grid max-h-64 gap-2 overflow-y-auto pr-1">
      {sorted.map((row) => (
        <li key={row.name} className="grid grid-cols-[minmax(0,8rem)_1fr_2.5rem] items-center gap-2 text-sm">
          <span className="truncate" title={row.name}>{row.name}</span>
          <span className="h-3 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full" style={{ width: `${(row.value / max) * 100}%`, background: color }} /></span>
          <span className="text-right font-bold tabular-nums">{row.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** A number with − and + buttons that can also be typed: Enter or leaving the box saves it, Esc puts it back. */
function Counter({ label, value, minus, plus, set }: { label: string; value: number; minus: () => void; plus: () => void; set: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const keep = useRef(false); // Esc: leave the box without saving
  function commit(typed: string) {
    setDraft(null);
    if (keep.current) { keep.current = false; return; }
    if (!typed.trim()) return;
    const next = Number(typed);
    if (!Number.isInteger(next) || next < 0 || next > 100_000) { toast.error(`${label}: enter a whole number from 0 to 100000.`); return; }
    if (next !== value) set(next);
  }
  return (
    <div className="mt-3 grid grid-cols-[minmax(0,1fr)_2.25rem_4rem_2.25rem] items-center gap-1">
      <span className="min-w-0 text-xs font-bold">{label}</span>
      <Button size="icon" variant="outline" aria-label={`${label}: one less`} onClick={minus}><Minus /></Button>
      <Input
        type="text"
        inputMode="numeric"
        aria-label={label}
        maxLength={6}
        value={draft ?? String(value)}
        onFocus={(event) => { setDraft(String(value)); event.currentTarget.select(); }}
        onChange={(event) => setDraft(event.target.value.replace(/\D/g, ""))}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          else if (event.key === "Escape") { keep.current = true; event.currentTarget.blur(); }
        }}
        className="h-9 px-1 text-center font-bold"
      />
      <Button size="icon" variant="outline" aria-label={`${label}: one more`} onClick={plus}><Plus /></Button>
    </div>
  );
}

/** A UPI order she hasn't paid (or hasn't told us about) yet. */
const needsPayment = (order: Order) => order.payment === "UPI" && !order.utr && !order.paymentConfirmed && !order.cancelled;

/** A UPI order the shopkeeper hasn't confirmed the payment for: the order isn't confirmed yet either. */
const awaitingConfirmation = (order: Order) => order.payment === "UPI" && !order.paymentConfirmed && !order.fulfilled && !order.cancelled;

/** Where an order stands, as the customer sees it. UPI orders are confirmed once the shopkeeper confirms the payment. */
function orderState(order: Order): { badge: string; waiting: boolean; detail: string } {
  if (order.cancelled) {
    const paid = order.payment === "UPI" && (order.paymentConfirmed || order.utr);
    return { badge: "Cancelled", waiting: false, detail: `This order was cancelled by the shop.${paid ? " If you paid by UPI, contact the shop to get your money back." : ""}` };
  }
  if (awaitingConfirmation(order)) {
    return order.utr
      ? { badge: "Payment to be confirmed", waiting: true, detail: `Payment sent (UTR ${order.utr}). Your order is confirmed once the shopkeeper confirms your payment.` }
      : { badge: "Waiting for your payment", waiting: true, detail: `Pay ${money(order.total)} by UPI. Your order is confirmed once the shopkeeper confirms your payment.` };
  }
  const paid = order.payment === "UPI" ? "✓ UPI payment confirmed by the shopkeeper" : `Pay ${money(order.total)} on delivery`;
  return order.fulfilled ? { badge: "Fulfilled", waiting: false, detail: paid } : { badge: "Confirmed · Preparing", waiting: false, detail: paid };
}

/** Pay for an order that is already placed: a QR to scan, then her UPI reference. The QR is the shop's own
 * (uploaded at /admin; she types the amount) or, without one, a QR with the amount and order filled in.
 * Scanning only: UPI apps (PhonePe, Paytm, ...) often refuse payments a website opens in them when the shop's
 * UPI ID is a personal one ("declined for security reasons"). */
function UpiPayment({ order, fresh, onDone, onLater }: { order: Order; fresh: boolean; onDone: (order: Order) => void; onLater: () => void }) {
  const site = useSite();
  const link = upiPayLink(site, order.total, `Kannagi Night Mart order ${orderLabel(order)}`);
  const shopQr = site.upiQr || null;
  const [qr, setQr] = useState("");
  const [utr, setUtr] = useState("");
  const [sending, setSending] = useState(false);
  useEffect(() => {
    let active = true;
    void import("qrcode")
      .then(({ default: QRCode }) => QRCode.toDataURL(shopQr ?? link, { margin: 2, width: 480, color: { dark: "#111936", light: "#ffffff" } }))
      .then((url) => { if (active) setQr(url); })
      .catch(() => { if (active) setQr(""); });
    return () => { active = false; };
  }, [link, shopQr]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^[A-Za-z0-9]{6,35}$/.test(utr.replace(/\s/g, ""))) { toast.error("Enter the UPI reference (UTR) from your payment app: 6 to 35 letters or digits."); return; }
    setSending(true);
    try {
      const updated = await api.reportPayment(order.id, utr);
      toast.success("Thanks! Your order is confirmed as soon as the shopkeeper confirms your payment.", { duration: 6000 });
      onDone(updated);
    } catch (error) {
      toast.error(errorText(error, "Could not send the reference. Please try again."));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[65] grid place-items-center bg-foreground/55 p-4 backdrop-blur-sm">
      <section aria-label="Pay by UPI" className="max-h-[92vh] w-full max-w-sm overflow-y-auto rounded-lg border-2 border-dashed border-primary/50 bg-card p-6 text-center shadow-[7px_8px_0_var(--shadow-color)]">
        <p className="font-hand text-lg font-bold text-primary">{fresh ? "Order saved: pay to confirm it" : "Pay for your order"}</p>
        <h2 className="font-display text-3xl font-extrabold">Order {orderLabel(order)}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Pay <b className="text-foreground">{money(order.total)}</b> by UPI. Your order is confirmed once the shopkeeper confirms your payment.</p>
        {qr ? <img src={qr} alt={shopQr ? "The shop's UPI QR code" : `UPI QR code for ${money(order.total)}`} width={240} height={240} className="mx-auto mt-4 size-44 rounded-md bg-white p-1" /> : <div className="mx-auto mt-4 grid size-44 place-items-center text-sm text-muted-foreground">Generating QR…</div>}
        {shopQr ? (
          <>
            <p className="mt-2 text-sm font-bold">Scan with any UPI app and pay {money(order.total)}</p>
            <p className="text-xs text-muted-foreground">Your UPI app shows <b>{site.upiName}</b>. Type in <b>{money(order.total)}</b> and write <b>{orderLabel(order)}</b> in the note.</p>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm font-bold">Scan &amp; pay {money(order.total)} to {site.upiId}</p>
            <p className="text-xs text-muted-foreground">Your UPI app will show <b>{site.upiName}</b> (Kannagi Night Mart). The amount and order number are filled in.</p>
          </>
        )}
        <form onSubmit={send} className="mt-4 border-t border-border pt-4 text-left">
          <label className="grid gap-1 text-sm font-bold">After paying, enter the UPI reference (UTR)
            <Input value={utr} onChange={(e) => setUtr(e.target.value)} inputMode="text" autoComplete="off" maxLength={40} placeholder="e.g. 412345678901" aria-label="UPI transaction reference" className="h-11 font-normal" />
          </label>
          <p className="mt-1 text-xs text-muted-foreground">It&apos;s in your UPI app&apos;s payment details. The shopkeeper uses it to find your payment.</p>
          <Button type="submit" disabled={sending} className="mt-3 h-11 w-full">{sending ? "Sending…" : "I've paid · send reference"}</Button>
        </form>
        <Button variant="ghost" className="mt-1 w-full" onClick={onLater}>Pay later</Button>
        <p className="text-xs text-muted-foreground">Your order stays saved; you can pay from My Orders.</p>
      </section>
    </div>
  );
}

function OrderReceipt({ order, fresh, onPay, close }: { order: Order; fresh: boolean; onPay: () => void; close: () => void }) {
  const site = useSite();
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-foreground/55 p-4 backdrop-blur-sm"><section className="max-h-[92vh] w-full max-w-sm overflow-y-auto rounded-lg border-2 border-dashed border-primary/50 bg-card p-6 text-center shadow-[7px_8px_0_var(--shadow-color)]">{order.cancelled ? <div className="mx-auto grid size-14 place-items-center rounded-full bg-destructive text-destructive-foreground"><X className="size-7" /></div> : orderState(order).waiting ? <div className="mx-auto grid size-14 place-items-center rounded-full bg-accent text-accent-foreground"><Hourglass className="size-7" /></div> : <div className="mx-auto grid size-14 place-items-center rounded-full bg-stock text-stock-foreground"><Check className="size-7" /></div>}<p className="mt-3 font-hand text-lg font-bold text-primary">{order.cancelled || orderState(order).waiting ? orderState(order).badge : fresh ? "Order placed!" : order.createdAt ? new Date(order.createdAt).toLocaleString() : "Receipt"}</p><h2 className="font-display text-4xl font-extrabold">Order {orderLabel(order)}</h2><p className="mt-2 text-sm text-muted-foreground">{order.delivery === "Pickup" ? "Tell the shopkeeper this order ID when you pick up your snacks." : "Keep this number for delivery updates."}</p><div className="mt-4 rounded-md bg-product p-4 text-left text-sm"><p><b>{order.items.map((item) => `${item.name} ×${item.qty}`).join(", ")}</b></p><p className="mt-1">{order.delivery} · {order.payment}</p><p className="mt-1 font-semibold">{orderState(order).detail}</p>{order.discountLabel && <p className="mt-1 font-semibold">{order.discountLabel}{order.discount > 0 ? ` (−${money(order.discount)})` : ""}</p>}{order.freebies.length > 0 && <p className="font-semibold">Free: {order.freebies.join(", ")}</p>}{order.onRequest && <p className="mt-1 text-xs">Placed while the store was offline — the shopkeeper will confirm it.</p>}<p className="mt-2 text-xl font-extrabold text-primary">Total {money(order.total)}</p></div>{order.delivery === "Pickup" && !order.cancelled && <div className="mt-4 rounded-md bg-accent p-3 text-sm font-semibold text-accent-foreground"><p>If {site.pickupPoint} is closed or the shopkeeper is unavailable, call {spacedPhone(site.helpPhone)} for assistance.</p><Button asChild variant="outline" className="mt-3 w-full bg-card"><a href={`tel:+91${site.helpPhone}`}><Phone /> Call {spacedPhone(site.helpPhone)}</a></Button></div>}{needsPayment(order) && <Button onClick={onPay} className="mt-5 w-full">Pay {money(order.total)} by UPI now</Button>}<Button onClick={close} variant={needsPayment(order) ? "outline" : "default"} className={needsPayment(order) ? "mt-2 w-full" : "mt-5 w-full"}>Done</Button></section></div>;
}

function Checkout({ cartItems, products, coupon, firstOrder, dailyOffers, couponRule, storeOnline, takingOrders, myRequest, onRequest, loyalty, profile, onClose, onComplete }: { cartItems: (Product & { qty: number })[]; products: Product[]; coupon: Coupon | null; firstOrder: boolean; dailyOffers: DailyOffer[]; couponRule: CouponRule; storeOnline: boolean; takingOrders: boolean; myRequest: OrderRequest | null; onRequest: (input: OrderRequestInput) => Promise<void>; loyalty: Loyalty | null; profile: CustomerProfile; onClose: () => void; onComplete: (input: PlaceOrderInput) => Promise<void> }) {
  const site = useSite();
  const rules = priceRules(site);
  // Only the options the admin has turned on (at least one of each always is).
  const deliveries = (["Pickup", "Room Delivery"] as const).filter((option) => (option === "Pickup" ? site.pickupEnabled : site.roomDeliveryEnabled));
  const payments = (["Pay on Delivery", "UPI"] as const).filter((option) => (option === "UPI" ? site.upiEnabled : site.cashEnabled));
  const [deliveryChoice, setDelivery] = useState<Delivery>("Pickup");
  const [paymentChoice, setPayment] = useState<Payment>("Pay on Delivery");
  const delivery: Delivery = deliveries.includes(deliveryChoice) ? deliveryChoice : deliveries[0] ?? "Pickup";
  const payment: Payment = payments.includes(paymentChoice) ? paymentChoice : payments[0] ?? "UPI";
  const [name, setName] = useState(profile.fullName); const [phone, setPhone] = useState(profile.phone); const [room, setRoom] = useState(profile.roomNumber); const [block, setBlock] = useState(profile.block);
  const [placing, setPlacing] = useState(false);
  const [freeItem, setFreeItem] = useState("");
  const [rewardItem, setRewardItem] = useState("");
  const previousDeal = useRef<string | undefined>(undefined);

  const lines = useMemo(() => cartItems.map((item) => ({ product: item, qty: item.qty })), [cartItems]);
  const priced = useMemo(
    () => quote({ lines, delivery, firstOrder, coupon, dailyOffers, couponRule, rules }),
    // rules is rebuilt each render; its delivery fee is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [coupon, couponRule, dailyOffers, delivery, firstOrder, lines, rules.deliveryFee],
  );
  const best = priced.deal;
  const subtotal = toRupees(priced.subtotal);
  const discount = toRupees(priced.discount);
  const total = toRupees(priced.total);
  // Items she could take free: cheap enough, and still in stock after her own cart.
  const pickUpTo = best?.pickUpTo ?? FREE_PICK_MAX_PRICE;
  const freeChoices = products.filter((item) => item.mrp <= pickUpTo && item.stock - (cartItems.find((line) => line.id === item.id)?.qty ?? 0) > 0);
  const couponCheck = couponStatus(coupon, cartSummary(lines), delivery);
  const couponApplied = best?.kind === "coupon";

  useEffect(() => {
    if (best?.kind === "tier100" && previousDeal.current === "tier50") toast.success(`Applied ${best.label} (replaced the ₹50+ offer)`);
    previousDeal.current = best?.kind;
  }, [best]);

  const getsFreePick = Boolean(best?.freePick);
  // Her loyalty reward (on top of any offer): a free item up to the card's MRP, still in stock after her
  // cart and the other free pick. Left empty, it's kept for a later order.
  const rewardReady = Boolean(loyalty?.active && loyalty.rewards > 0);
  const rewardChoices = products.filter((item) => item.mrp <= (loyalty?.pickUpTo ?? 0) && item.stock - (cartItems.find((line) => line.id === item.id)?.qty ?? 0) - (getsFreePick && freeItem === item.name ? 1 : 0) > 0);
  const gift = best?.gift ?? 0;
  const freeDelivery = Boolean(best?.freeDelivery);

  // The server re-checks stock, prices, offers and the coupon; this only sends what the customer chose.
  const placeOrder = useCallback(async () => {
    if (!cartItems.length || placing) return;
    if (delivery === "Room Delivery" && !(name.trim() && phone.trim() && room.trim())) {
      toast.error("Add your name, mobile number and room for room delivery.");
      return;
    }
    if (delivery === "Room Delivery" && !isMobile(phone)) { toast.error("Enter a 10-digit mobile number."); return; }
    setPlacing(true);
    try {
      await onComplete({
        items: cartItems.map((item) => ({ productId: item.id, quantity: item.qty })),
        delivery,
        payment,
        ...(getsFreePick && freeItem ? { freePick: freeItem } : {}),
        ...(rewardReady && rewardItem ? { loyaltyPick: rewardItem } : {}),
        ...(delivery === "Room Delivery" ? { name: name.trim(), phone: phone.trim(), block, room: room.trim() } : {}),
        expectedTotal: total,
      });
    } finally {
      setPlacing(false);
    }
  }, [block, cartItems, delivery, freeItem, getsFreePick, name, onComplete, payment, phone, placing, rewardItem, rewardReady, room, total]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/50 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="max-h-[92vh] w-full overflow-y-auto rounded-t-xl bg-background p-5 shadow-2xl sm:max-w-xl sm:rounded-xl">
        <div className="flex items-center justify-between">
          <div><p className="font-hand text-lg font-bold text-primary">Almost snack time!</p><h2 className="font-hand text-3xl font-bold">Your midnight cart</h2></div>
          <Button size="icon" variant="ghost" onClick={onClose}><X /></Button>
        </div>

        {cartItems.length === 0 ? (
          <p className="py-12 text-center text-muted-foreground">Your cart is waiting for a snack.</p>
        ) : (
          <>
            {!storeOnline && takingOrders && <p className="mt-4 rounded-md bg-accent p-3 text-sm font-semibold text-accent-foreground">🌙 Store is offline right now — your order goes through as an <b>on-request</b> order and the shopkeeper will confirm it.</p>}
            {!takingOrders && <p className="mt-4 rounded-md bg-accent p-3 text-sm font-semibold text-accent-foreground">🌙 The store is offline and isn&apos;t taking orders right now. Send the shop a <b>request</b> for these snacks: the shopkeeper sees it and gets in touch with you. Nothing is charged until you order.</p>}

            <div className="mt-5 space-y-2">
              {cartItems.map(item => <div key={item.id} className="flex items-center justify-between border-b border-border py-2"><span className="flex items-center gap-2">{item.image ? <img src={item.image} alt="" className="size-8 rounded object-cover" /> : <span aria-hidden="true">{item.emoji}</span>}<span><b>{item.name}</b> × {item.qty}</span></span><span>{money(toRupees(lineTotal(item, item.qty)))}</span></div>)}
            </div>

            {!takingOrders ? <RequestForm cartItems={cartItems} deliveries={deliveries} myRequest={myRequest} subtotal={subtotal} onRequest={onRequest} /> : <>
            {coupon && <div className={`mt-4 rounded-md border-2 border-dashed p-3 text-sm font-bold ${couponApplied ? "border-stock bg-stock text-stock-foreground" : "border-primary/30 bg-banner text-foreground"}`}><p>{coupon.icon} {coupon.label}</p><p className="mt-1 text-xs font-semibold">{couponCheck.eligible && !couponApplied ? `Saved for later: ${best?.label ?? "another offer"} saves you more on this order.` : couponCheck.reason}</p>{!couponCheck.eligible && <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => toast.info(couponCheck.reason)}>Check coupon</Button>}</div>}

            {(gift > 0 || freeDelivery || getsFreePick) && (
              <div className="mt-4 border-2 border-dashed border-primary/35 bg-banner p-4">
                <p className="flex items-center gap-2 font-hand text-xl font-bold"><Gift className="size-5" /> Your freebies</p>
                {gift > 0 && <p className="mt-1 text-sm font-semibold">✓ {best?.label}: free ₹{gift} chocolate added to your bag.</p>}
                {freeDelivery && <p className="mt-1 text-sm font-semibold">✓ {best?.label}: free room delivery.</p>}
                {getsFreePick && (
                  <label className="mt-3 grid gap-1 text-sm font-semibold">
                    Pick your free ₹{best?.pickValue ?? 10} item
                    <select aria-label="Free item" value={freeItem} onChange={(e) => setFreeItem(e.target.value)} className="h-10 rounded-md border border-input bg-card px-2">
                      <option value="">Choose an item…</option>
                      {freeChoices.map((item) => <option key={item.id} value={item.name}>{item.emoji} {item.name}</option>)}
                    </select>
                  </label>
                )}
              </div>
            )}

            {rewardReady && loyalty && (
              <div className="mt-4 border-2 border-dashed border-stock bg-stock/25 p-4">
                <p className="font-hand text-xl font-bold">🎟️ Your loyalty reward</p>
                <p className="mt-1 text-sm">{loyalty.rewards > 1 ? `${loyalty.rewards} rewards` : "A reward"} ready: a free item with MRP up to ₹{loyalty.pickUpTo}, on top of your other offers. Pick one now or keep it for later.</p>
                <select aria-label="Loyalty free item" value={rewardItem} onChange={(e) => setRewardItem(e.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-card px-2 text-sm">
                  <option value="">Keep it for a later order</option>
                  {rewardChoices.map((item) => <option key={item.id} value={item.name}>{item.emoji} {item.name}</option>)}
                </select>
              </div>
            )}

            <CheckoutChoice title="Delivery Options" options={deliveries} value={delivery} setValue={(v) => setDelivery(v as Delivery)} deliveryFee={site.deliveryFee} />
            {delivery === "Pickup" ? (
              <div className="mt-3 rounded-md bg-accent p-3 text-sm font-semibold text-accent-foreground">
                <p>Come and take your order from Kannagi Hostel, {site.pickupPoint}.</p>
                <Button asChild variant="outline" className="mt-2 h-auto min-h-10 w-full whitespace-normal bg-card py-2 text-center">
                  <a href={shopWhatsApp(site, `Hi! Pickup order from Kannagi Night Mart: ${cartItems.map((item) => `${item.name} x${item.qty}`).join(", ")} — total ${money(total)}.`)} target="_blank" rel="noopener noreferrer">Message shopkeeper on WhatsApp · +91 {spacedPhone(site.shopPhone)}</a>
                </Button>
              </div>
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Input placeholder="Name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
                <Input placeholder="Mobile number" aria-label="Mobile number" inputMode="tel" autoComplete="tel-national" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} />
                <label className="grid grid-cols-[auto_1fr] items-center gap-2 rounded-md border border-input bg-card px-3 text-sm">Block <select value={block} onChange={(e) => setBlock(e.target.value as Block)} className="h-9 bg-transparent outline-none"><option>A</option><option>B</option><option>C</option></select><ChevronDown className="hidden" /></label>
                <Input placeholder="Room No." maxLength={20} value={room} onChange={(e) => setRoom(e.target.value)} />
              </div>
            )}

            <CheckoutChoice title="Payment Mode" options={payments} value={payment} setValue={(v) => setPayment(v as Payment)} deliveryFee={site.deliveryFee} />
            {payment === "UPI" && (
              <div className="mt-3 rounded-md border-2 border-dashed border-primary/35 bg-card p-4 text-sm">
                <p className="font-bold">Place the order first, then pay {money(total)} by UPI.</p>
                <p className="mt-1 text-muted-foreground">The QR code and UPI app buttons appear right after. Your order is saved before you pay, so nothing is lost if you switch to your UPI app.</p>
              </div>
            )}

            <div className="mt-5 space-y-1 border-t border-border pt-4 text-sm">
              <div className="flex justify-between"><span>Items subtotal</span><span>{money(subtotal)}</span></div>
              <div className="flex justify-between"><span>{delivery}</span><span>{priced.fee ? `+ ${money(toRupees(priced.fee))}` : "Free"}</span></div>
              {best && <div className="flex justify-between gap-3 font-bold text-primary"><span>{couponApplied ? `Spin reward · ${best.label}` : best.label}</span><span>{discount > 0 ? `− ${money(discount)}` : "Applied"}</span></div>}
              <div className="flex justify-between font-hand text-2xl font-bold"><span>Total</span><span>{money(total)}</span></div>
            </div>
            <Button onClick={() => void placeOrder()} disabled={placing} className="mt-4 h-12 w-full text-base">{placing ? "Placing order…" : payment === "UPI" ? `Place Order & Pay ${money(total)}` : `Place Order · ${money(total)}`}</Button>
            </>}
          </>
        )}
      </section>
    </div>
  );
}

function CheckoutChoice({ title, options, value, setValue, deliveryFee }: { title: string; options: readonly string[]; value: string; setValue: (value: string) => void; deliveryFee: number }) {
  return <fieldset className="mt-5"><legend className="font-hand text-xl font-bold">{title}</legend><div className={`mt-2 grid gap-2 ${options.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>{options.map(option => <Button type="button" key={option} variant={value === option ? "default" : "outline"} onClick={() => setValue(option)} className="h-auto min-h-10 whitespace-normal px-2">{option}{option === "Room Delivery" && (deliveryFee ? ` + ₹${deliveryFee}` : " · Free")}{option === "Pickup" && " · Free"}</Button>)}</div></fieldset>;
}
