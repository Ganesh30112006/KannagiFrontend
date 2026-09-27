// The shop, order history and shopkeeper dashboard (routes /shop and /dashboard; the site admin's
// /admin shows it too).
// Kept out of the route files so the router can code-split them.
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronDown,
  Gift,
  Heart,
  Hourglass,
  History,
  ImagePlus,
  LayoutDashboard,
  LockKeyhole,
  MessageCircle,
  Minus,
  PackagePlus,
  LogOut,
  Phone,
  Plus,
  Receipt,
  Search,
  ShoppingBag,
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
import { api, ApiError } from "@/lib/api";
import { staleSince, useLiveSync, writeMark } from "@/lib/live-sync";
import { ROLE_KEY } from "@/lib/login-role";
import { callLink, formatMobile, isMobile, whatsappChat } from "@/lib/phone";
import { DEFAULT_SITE, hoursLabel, priceRules, shopWhatsApp, SiteContext, spacedPhone, useSite } from "@/lib/site";
import { upiPayLink } from "@/lib/upi";
import { cartSummary, couponStatus, FREE_PICK_MAX_PRICE, isEggProduct, lineTotal, money, quote, toRupees } from "@/lib/pricing";
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
  ManualSale,
  Order,
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

// Shown on the wheel only if fewer than two prizes are switched on (the server spins the same ones).
const defaultWheelPrizes: WheelPrize[] = [
  { code: "DROP60", label: "FREE Delivery on ₹60+ Orders", shortLabel: "FREE DELIVERY ₹60+", icon: "🚚", kind: "free60", active: true },
  { code: "TRIO5", label: "Buy Any 3 Items & Get ₹5 OFF", shortLabel: "3 ITEMS ₹5 OFF", icon: "🍪", kind: "three5", active: true },
  { code: "SNACK100", label: "Free ₹10 Snack on ₹100+ Orders", shortLabel: "FREE SNACK ₹100+", icon: "🎁", kind: "freeSnack100", active: true },
  { code: "HALFDROP", label: "50% OFF Room Delivery", shortLabel: "½ DELIVERY", icon: "🛵", kind: "halfDelivery", active: true },
  { code: "FOUR10", label: "Buy 4 Items & Get ₹10 OFF", shortLabel: "4 ITEMS ₹10 OFF", icon: "🎉", kind: "four10", active: true },
  { code: "PREMIUM5", label: "₹5 OFF on 2 Premium Items", shortLabel: "2 PREMIUM ₹5 OFF", icon: "⭐", kind: "premium5", active: true },
  { code: "LUCK", label: "Better Luck Next Time", shortLabel: "BETTER LUCK!", icon: "✨", kind: null, active: true },
  { code: "TRIO5B", label: "Buy Any 3 Items & Get ₹5 OFF", shortLabel: "3 ITEMS ₹5 OFF", icon: "🍪", kind: "three5", active: true },
  { code: "DROP60B", label: "FREE Delivery on ₹60+ Orders", shortLabel: "FREE DELIVERY ₹60+", icon: "🚚", kind: "free60", active: true },
  { code: "SNACK100B", label: "Free ₹10 Snack on ₹100+ Orders", shortLabel: "FREE SNACK ₹100+", icon: "🎁", kind: "freeSnack100", active: true },
];

const orderLabel = (order: Order) => `#${String(order.orderNumber).padStart(4, "0")}`;
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;



const emptyProfile: CustomerProfile = { fullName: "", phone: "", block: "A", roomNumber: "" };

export function ShopPage({ user, initialMode = "customer", signedOutTo = "/" }: { user: User; initialMode?: "customer" | "history" | "admin"; signedOutTo?: "/" | "/admin" }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"customer" | "history" | "admin">(initialMode);
  const [adminUnlocked, setAdminUnlocked] = useState(user.isShopkeeper);
  const [loaded, setLoaded] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [wishes, setWishes] = useState<Wish[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [adminOrders, setAdminOrders] = useState<AdminOrder[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [wishInput, setWishInput] = useState("");
  const [wishMessage, setWishMessage] = useState("");
  const [store, setStore] = useState<StoreStatus | null>(null);
  const [coupon, setCoupon] = useState<Coupon | null>(null);
  const [spun, setSpun] = useState(false);
  const [wheelOpen, setWheelOpen] = useState(false);
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
  const [salesSummary, setSalesSummary] = useState<SalesSummary | null>(null);
  const [manualSales, setManualSales] = useState<ManualSale[]>([]);
  // Shop details the site admin sets (UPI, contacts, hours, options, prices).
  const [site, setSite] = useState<SiteDetails>(DEFAULT_SITE);
  const newestOrderId = useRef<number | null>(null);
  // What the page has, as revisions: /sync sends back only what changed since.
  const revs = useRef<KnownRevs>(NO_REVS);
  // Offer edits the shopkeeper hasn't saved yet; syncing never overwrites them.
  const promotionsDirty = useRef(false);
  const ordersRef = useRef<Order[]>([]);
  ordersRef.current = orders;
  const payingRef = useRef<Order | null>(null);
  payingRef.current = paying;
  const [justPlacedId, setJustPlacedId] = useState<number | null>(null);

  const applyPromotions = useCallback((promotions: Promotions) => {
    promotionsDirty.current = false;
    setLaunchMessage(promotions.launchMessage);
    setDailyOffers(promotions.dailyOffers);
    setWheelRewards(promotions.wheelPrizes);
    setCouponRule(promotions.couponRule);
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
      if (data.profile) { setProfile(data.profile); setProfileSaved(true); }
      // Customers are asked once for their hostel details; the shopkeeper isn't (she runs the shop).
      else if (!data.user.isShopkeeper) setProfileOpen(true);
      applyPromotions(data.promotions);
      setStore(data.store);
      setWishes(data.wishes);
      setSpun(data.spin.spunToday);
      setCoupon(data.spin.coupon ?? null);
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
    if (data.promotions) {
      if (!promotionsDirty.current) applyPromotions(data.promotions);
      else toast.info("Offers were changed on another device. Saving here will replace them.", { id: "offers-changed", duration: 8000 });
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

  // Clamp to current stock so a restock/sale elsewhere never leaves the cart over the limit.
  const cartItems = useMemo(
    () => products.map((product) => ({ ...product, qty: Math.min(cart[product.id] ?? 0, product.stock) })).filter((item) => item.qty > 0),
    [cart, products],
  );
  const itemCount = cartItems.reduce((sum, item) => sum + item.qty, 0);
  const unpaid = orders.find((order) => needsPayment(order) && !order.fulfilled);
  const subtotal = toRupees(cartSummary(cartItems.map((item) => ({ product: item, qty: item.qty })), priceRules(site)).subtotal);

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
        result.alreadyRequested
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

  function finishSpin(result: SpinResult) {
    setSpun(true);
    setCoupon(result.coupon ?? null);
  }

  /** A setter for an offers field that also marks the offers as edited but not saved. */
  function edited<T>(set: (value: T) => void) {
    return (value: T) => { promotionsDirty.current = true; set(value); };
  }

  async function changeOverride(override: StoreOverride) {
    try {
      setStore(await api.admin.setStore(override));
    } catch (error) {
      toast.error(errorText(error, "Could not update the store status."));
    }
  }

  return (
    <SiteContext.Provider value={site}>
    <main className="min-h-screen bg-background pb-24 text-foreground">
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
                {storeOnline ? "🟢 Store is ONLINE — Midnight Craving Service Active!" : "🌙 Store Offline — Orders available on request when shopkeeper is around!"}
              </p>
            )}
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
        <div className={`mx-auto grid max-w-2xl ${adminUnlocked ? "grid-cols-3" : "grid-cols-2"} rounded-md border border-border bg-card p-1 shadow-sm`}>
          <Button variant={mode === "customer" ? "default" : "ghost"} className="h-auto min-h-9 gap-1 whitespace-normal px-1 text-xs leading-tight sm:gap-2 sm:px-4 sm:text-sm [&_svg]:hidden sm:[&_svg]:block" onClick={() => { setMode("customer"); void navigate({ to: "/shop" }); }}><ShoppingBag /> Customer Shop</Button>
          <Button variant={mode === "history" ? "default" : "ghost"} className="h-auto min-h-9 gap-1 whitespace-normal px-1 text-xs leading-tight sm:gap-2 sm:px-4 sm:text-sm [&_svg]:hidden sm:[&_svg]:block" onClick={() => setMode("history")}><History /> My Orders</Button>
          {adminUnlocked && <Button variant={mode === "admin" ? "default" : "ghost"} className="h-auto min-h-9 gap-1 whitespace-normal px-1 text-xs leading-tight sm:gap-2 sm:px-4 sm:text-sm [&_svg]:hidden sm:[&_svg]:block" onClick={openDashboard}><LockKeyhole /> Shopkeeper</Button>}
        </div>
      </nav>

      {mode === "customer" ? (
        <CustomerView loaded={loaded} products={products} cart={cart} updateCart={updateCart} wishes={wishes} wishInput={wishInput} setWishInput={setWishInput} submitWish={submitWish} wishMessage={wishMessage} coupon={coupon} firstOrder={loaded && firstOrder} launchMessage={launchMessage} dailyOffers={dailyOffers} />
      ) : mode === "history" ? <OrderHistory orders={orders} onOpen={setReceipt} onPay={setPaying} onEditProfile={() => setProfileOpen(true)} /> : adminUnlocked ? (
        <AdminView products={products} setProducts={setProducts} wishes={wishes} orders={adminOrders} setOrders={setAdminOrders} override={store?.override ?? "auto"} setOverride={changeOverride} storeOnline={storeOnline} launchMessage={launchMessage} setLaunchMessage={edited(setLaunchMessage)} dailyOffers={dailyOffers} setDailyOffers={edited(setDailyOffers)} wheelRewards={wheelRewards} setWheelRewards={edited(setWheelRewards)} couponRule={couponRule} setCouponRule={edited(setCouponRule)} summary={salesSummary} manualSales={manualSales} setManualSales={setManualSales} promotionsSaved={() => { promotionsDirty.current = false; }} />
      ) : (
        <section className="mx-auto grid max-w-md gap-3 px-4 py-16 text-center">
          <h2 className="font-hand text-3xl font-bold">Shopkeeper dashboard</h2>
          <p className="text-muted-foreground">This account is a customer account. Shopkeepers sign in on the Shopkeeper tab with their mobile number and the password the admin gave them.</p>
          <Button onClick={() => void signInAsShopkeeper()}><Store /> Sign in as shopkeeper</Button>
          <Button variant="ghost" onClick={() => { setMode("customer"); void navigate({ to: "/shop" }); }}><ShoppingBag /> Back to the shop</Button>
        </section>
      )}

      {mode === "customer" && (
        <>
          <Button onClick={() => setWheelOpen(true)} className="fixed bottom-24 right-4 z-40 h-12 rounded-full bg-accent px-4 text-accent-foreground shadow-[0_10px_28px_var(--shadow-color)] hover:bg-accent/90">
            <Sparkles className="size-5" /> <span className="font-hand text-base font-bold">Spin &amp; Win! 🎡</span>
          </Button>
          <Button onClick={() => setCartOpen(true)} className="fixed bottom-4 left-1/2 z-40 h-14 -translate-x-1/2 rounded-full px-5 shadow-[0_10px_28px_var(--shadow-color)]">
            <ShoppingBag className="size-5" /> <span>{itemCount} {itemCount === 1 ? "item" : "items"} · {money(subtotal)}</span><span className="rounded-full bg-accent px-3 py-1 text-accent-foreground">Checkout</span>
          </Button>
        </>
      )}

      {wheelOpen && <SpinWheel prizes={wheelRewards.filter((prize) => prize.active)} spun={spun} coupon={coupon} onResult={finishSpin} onClose={() => setWheelOpen(false)} />}

      {cartOpen && (
        <Checkout
          cartItems={cartItems}
          products={products}
          coupon={coupon}
          firstOrder={firstOrder}
          dailyOffers={dailyOffers}
          couponRule={couponRule}
          storeOnline={storeOnline}
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

function CustomerView({ loaded, products, cart, updateCart, wishes, wishInput, setWishInput, submitWish, wishMessage, coupon, firstOrder, launchMessage, dailyOffers }: { loaded: boolean; products: Product[]; cart: Record<number, number>; updateCart: (id: number, delta: number) => void; wishes: Wish[]; wishInput: string; setWishInput: (value: string) => void; submitWish: (event: FormEvent<HTMLFormElement>) => void; wishMessage: string; coupon: Coupon | null; firstOrder: boolean; launchMessage: string; dailyOffers: DailyOffer[] }) {
  const site = useSite();
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
            </article>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Only the single best discount applies to a cart — we always pick the one that saves you most.</p>
      </section>

      <div className="mb-5 flex items-end justify-between gap-4">
        <div><p className="font-hand text-lg font-bold text-primary">Pick your midnight fix</p><h2 className="font-hand text-4xl font-bold">Snack shelf</h2></div>
        <span className="hidden rounded-full bg-secondary px-3 py-1 text-sm font-bold text-secondary-foreground sm:block">MRP + ₹{site.markup} · eggs charged once per bundle</span>
      </div>
      {products.length === 0 && <p className="border-2 border-dashed border-border bg-card p-8 text-center text-muted-foreground">{loaded ? "The shelf is empty right now — check back soon!" : "Loading snacks…"}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {products.map((product, index) => {
          const qty = cart[product.id] ?? 0;
          const soldOut = product.stock === 0;
          const low = product.stock > 0 && product.stock <= product.threshold;
          return (
            <article key={product.id} className={`product-card relative min-w-0 border-2 border-foreground/10 bg-card p-3 shadow-[3px_4px_0_var(--shadow-color)] ${index % 3 === 1 ? "rotate-[.6deg]" : index % 3 === 2 ? "-rotate-[.5deg]" : ""}`}>
              <div className="grid aspect-square place-items-center overflow-hidden rounded-sm bg-product text-6xl sm:text-7xl">
                {product.image ? <img src={product.image} alt={product.name} className="h-full w-full object-cover" loading="lazy" decoding="async" /> : <span aria-hidden="true">{product.emoji}</span>}
              </div>
              <span className={`absolute right-1 top-1 rounded-full px-2 py-1 text-[10px] font-bold ${soldOut ? "bg-foreground text-background" : low ? "bg-accent text-accent-foreground" : "bg-stock text-stock-foreground"}`}>
                {soldOut ? "Out of Stock" : low ? `Only ${product.stock} left!` : "In Stock"}
              </span>
              <h3 className="mt-3 min-h-12 font-hand text-xl font-bold leading-tight">{product.name}</h3>
              <div className="flex items-end justify-between gap-2"><div className="min-w-0 [overflow-wrap:anywhere]">{isEggProduct(product) ? <><p className="text-lg font-bold text-primary">{money(product.mrp)} / egg</p><p className="text-[11px] text-muted-foreground">Quantity total + ₹{site.markup} once</p></> : <><p className="text-lg font-bold text-primary">{money(product.mrp + site.markup)}</p><p className="text-[11px] text-muted-foreground">MRP {money(product.mrp)} + ₹{site.markup}</p></>}</div></div>
              <div className="mt-3 grid grid-cols-[2rem_1fr_2rem] items-center rounded-md border border-border bg-background p-1">
                <Button size="icon" variant="ghost" aria-label={`Remove ${product.name}`} onClick={() => updateCart(product.id, -1)} disabled={!qty}><Minus /></Button>
                <span className="text-center font-bold">{qty}</span>
                <Button size="icon" aria-label={`Add ${product.name}`} onClick={() => updateCart(product.id, 1)} disabled={soldOut || qty >= product.stock}><Plus /></Button>
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
        <div className="mt-4 flex flex-wrap gap-2">{wishes.slice(0, 3).map(({ name, count }) => <span key={name} className="rounded-full bg-card px-3 py-1 text-xs font-bold text-foreground">{name} · {plural(count, "request")}</span>)}</div>
      </section>
    </div>
  );
}

const wheelColors = ["var(--secondary)", "var(--accent)", "var(--banner)", "var(--stock)", "var(--product)"];

function SpinWheel({ prizes, spun, coupon, onResult, onClose }: { prizes: WheelPrize[]; spun: boolean; coupon: Coupon | null; onResult: (result: SpinResult) => void; onClose: () => void }) {
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<WheelPrize | undefined>(undefined);
  // The server's list wins once it has picked a prize, so the pointer lands on the right slice.
  const [serverWheel, setServerWheel] = useState<WheelPrize[] | null>(null);
  const wheel = serverWheel ?? (prizes.length >= 2 ? prizes : defaultWheelPrizes);
  const slice = 360 / wheel.length;
  const wheelGradient = `conic-gradient(${wheel.map((_, index) => `${wheelColors[index % wheelColors.length]} ${index * slice}deg ${(index + 1) * slice}deg`).join(", ")})`;

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

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/60 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
       <section className="w-full max-w-md overflow-hidden rounded-lg border-2 border-dashed border-primary/50 bg-card p-5 text-center shadow-[0_0_32px_color-mix(in_oklab,var(--accent)_55%,transparent),7px_8px_0_var(--shadow-color)]">
        <div className="flex items-start justify-between">
          <h2 className="font-hand text-3xl font-bold">Spin &amp; Win Midnight Discounts! 🎡</h2>
          <Button size="icon" variant="ghost" onClick={onClose}><X /></Button>
        </div>
         <div className="relative mx-auto mt-4 size-[min(88vw,24rem)]">
           <span className="absolute left-1/2 top-[-12px] z-20 -translate-x-1/2 text-4xl text-primary drop-shadow-md">▼</span>
          <div
              className="relative size-full overflow-hidden rounded-full border-[6px] border-primary shadow-[0_0_22px_var(--secondary),5px_7px_0_var(--shadow-color)]"
            style={{
              transform: `rotate(${angle}deg)`,
              transition: spinning ? "transform 3.2s cubic-bezier(.17,.67,.2,1)" : undefined,
              background: wheelGradient,
            }}
           >
              {wheel.map((prize, index) => {
                const middle = index * slice + slice / 2;
                const radians = middle * Math.PI / 180;
                return (
                  <div key={`${prize.code}-${index}`} className="absolute z-10 -translate-x-1/2 -translate-y-1/2" style={{ left: `${50 + Math.sin(radians) * 29}%`, top: `${50 - Math.cos(radians) * 29}%` }}>
                    <span className="flex h-[4.2rem] w-[4.25rem] items-center justify-center overflow-hidden px-0.5 text-center font-display text-[7px] font-extrabold leading-none text-foreground drop-shadow-sm sm:h-[4.8rem] sm:w-[4.8rem] sm:text-[8px]">{prize.icon}<br />{prize.label}</span>
                  </div>
                );
              })}
           </div>
            <div className="pointer-events-none absolute inset-0 grid place-items-center"><span className="grid size-11 place-items-center rounded-full border-4 border-card bg-primary font-hand text-[10px] font-bold text-primary-foreground shadow-md">SPIN</span></div>
        </div>
        {result !== undefined && (
          <p className="mt-4 font-hand text-xl font-bold text-primary">{result.kind ? `You won ${result.label}! It is saved and will apply when eligible.` : `${result.icon} ${result.label}`}</p>
        )}
        {result === undefined && !spinning && spun && coupon && <p className="mt-4 font-hand text-xl font-bold text-primary">Your coupon {coupon.code} ({coupon.label}) is already saved.</p>}
        <Button className="mt-4 h-12 w-full text-base" onClick={spin} disabled={spinning || spun}>
           {spinning ? "Spinning…" : spun ? "Come back tomorrow for another spin 💫" : "Spin today’s wheel!"}
        </Button>
      </section>
    </div>
  );
}

function AdminView({ products, setProducts, wishes, orders, setOrders, override, setOverride, storeOnline, launchMessage, setLaunchMessage, dailyOffers, setDailyOffers, wheelRewards, setWheelRewards, couponRule, setCouponRule, summary, manualSales, setManualSales, promotionsSaved }: { products: Product[]; setProducts: React.Dispatch<React.SetStateAction<Product[]>>; wishes: Wish[]; orders: AdminOrder[]; setOrders: React.Dispatch<React.SetStateAction<AdminOrder[]>>; override: StoreOverride; setOverride: (value: StoreOverride) => void; storeOnline: boolean; launchMessage: string; setLaunchMessage: (value: string) => void; dailyOffers: DailyOffer[]; setDailyOffers: React.Dispatch<React.SetStateAction<DailyOffer[]>>; wheelRewards: WheelPrize[]; setWheelRewards: React.Dispatch<React.SetStateAction<WheelPrize[]>>; couponRule: CouponRule; setCouponRule: (value: CouponRule) => void; summary: SalesSummary | null; manualSales: ManualSale[]; setManualSales: React.Dispatch<React.SetStateAction<ManualSale[]>>; promotionsSaved: () => void }) {
  const site = useSite();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newStock, setNewStock] = useState("5");
  const [newPrice, setNewPrice] = useState("20");
  const [newImage, setNewImage] = useState<string | undefined>();
  const addFormRef = useRef<HTMLFormElement>(null);
  const [savingPromotions, setSavingPromotions] = useState(false);
  // The dashboard's pages: shop management, entering an in-person sale, and the sales figures.
  const [page, setPage] = useState<DashboardPage>("dashboard");
  const lowStock = products.filter((item) => item.stock <= item.threshold);
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
  function updateProduct(id: number, changes: { stock?: number; stockDelta?: number; threshold?: number; mrp?: number; image?: string | null }) {
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

  function openAddForm() {
    setPage("dashboard");
    setAdding(true);
    // The form sits at the top of the dashboard; bring it into view from the inventory button too.
    window.setTimeout(() => addFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newName.trim()) return;
    const image = newImage;
    const mrp = parsePrice(newPrice);
    const stock = Number(newStock);
    if (mrp === null) { toast.error("Enter a purchase price above ₹0."); return; }
    if (!Number.isInteger(stock) || stock < 0) { toast.error("Starting stock must be a whole number (0 or more)."); return; }
    try {
      const created = await api.admin.createProduct({ name: newName.trim(), mrp, stock, ...(image ? { image } : {}) });
      setProducts((current) => [...current, created]);
      setNewName(""); setNewStock("5"); setNewPrice("20"); setNewImage(undefined); setAdding(false);
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

  async function setFulfilled(order: AdminOrder, fulfilled: boolean) {
    setUpdatingOrder(order.id);
    try {
      const updated = await (fulfilled ? api.admin.fulfillOrder(order.id) : api.admin.unfulfillOrder(order.id));
      setOrders((current) => current.map((item) => (item.id === order.id ? updated : item)));
      if (fulfilled) toast.success(`Order ${orderLabel(order)} marked as fulfilled.`, { action: { label: "Undo", onClick: () => void setFulfilled(updated, false) } });
    } catch (error) {
      toast.error(errorText(error, "Could not update the order."));
    } finally {
      setUpdatingOrder(null);
    }
  }

  async function savePromotions() {
    if (wheelRewards.filter((reward) => reward.active).length < 2) { toast.error("Keep at least two wheel slices active."); return; }
    if (!wheelRewards.some((reward) => reward.active && reward.kind === null)) { toast.error("Keep one Better Luck slice active."); return; }
    setSavingPromotions(true);
    try {
      await api.admin.savePromotions({ launchMessage: launchMessage.trim(), dailyOffers, wheelPrizes: wheelRewards, couponRule });
      promotionsSaved();
      toast.success("Offers and spin wheel updated for customers.");
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

      <div role="tablist" aria-label="Dashboard pages" className="mt-4 grid grid-cols-3 gap-1 rounded-md border border-border bg-card p-1">
        {DASHBOARD_PAGES.map(({ id, label, icon: Icon }) => (
          <Button key={id} role="tab" aria-selected={page === id} variant={page === id ? "default" : "ghost"} className="h-auto min-h-10 gap-1 whitespace-normal px-1 text-xs leading-tight sm:gap-2 sm:text-sm [&_svg]:hidden sm:[&_svg]:block" onClick={() => setPage(id)}>
            <Icon /> {label}
          </Button>
        ))}
      </div>

      {page === "manual" && <ManualSalePanel products={products} sales={manualSales} onRecorded={manualSaleRecorded} onUndone={(sale) => setManualSales((current) => current.map((item) => (item.id === sale.id ? sale : item)))} />}

      {page === "dashboard" && (<>
      {adding && (
        <form ref={addFormRef} onSubmit={addProduct} aria-label="Add item" className="mt-5 grid scroll-mt-36 gap-4 border-2 border-dashed border-primary/35 bg-card p-4 sm:grid-cols-[14rem_1fr]">
          <PhotoPicker label="New item" emoji="🛍️" image={newImage} onPick={setNewImage} onRemove={() => setNewImage(undefined)} />
          <div className="grid content-start gap-3">
            <h3 className="font-hand text-2xl font-bold">Add a new item</h3>
            <label className="grid gap-1 text-xs font-bold">Item name<Input required maxLength={80} placeholder="e.g. Oreo biscuits" value={newName} onChange={(e) => setNewName(e.target.value)} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-xs font-bold">MRP (₹)<Input required type="number" inputMode="decimal" min="0.01" max="100000" step="0.01" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} aria-label="Purchase price" /></label>
              <label className="grid gap-1 text-xs font-bold">Starting stock<Input required type="number" inputMode="numeric" min="0" max="100000" step="1" value={newStock} onChange={(e) => setNewStock(e.target.value)} aria-label="Starting stock" /></label>
            </div>
            <p className="text-xs text-muted-foreground">Customers pay MRP + ₹{site.markup}. Add a real photo so customers recognise the item; you can also add or change it later.</p>
            <Button type="submit" className="h-11"><PackagePlus /> Add item</Button>
          </div>
        </form>
      )}

      <section className="mt-5 border-2 border-dashed border-primary/35 bg-card p-4 shadow-[4px_5px_0_var(--shadow-color)]">
        <h3 className="font-hand text-2xl font-bold">Store status</h3>
        <p className="mt-1 text-sm text-muted-foreground">Auto follows shop hours ({hoursLabel(site)}). Right now customers see: <b>{storeOnline ? "Online" : "Offline / on request"}</b>.</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(["auto", "online", "offline"] as const).map((option) => (
            <Button key={option} variant={override === option ? "default" : "outline"} onClick={() => setOverride(option)} className="h-auto min-h-10 whitespace-normal capitalize">
              {option === "auto" ? "Auto (by time)" : option === "online" ? "Force Online" : "Force Offline"}
            </Button>
          ))}
        </div>
      </section>

      <section className="mt-5 border-2 border-dashed border-primary/35 bg-card p-4 shadow-[4px_5px_0_var(--shadow-color)]">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-hand text-2xl font-bold">Offers &amp; Spin Wheel</h3><p className="text-sm text-muted-foreground">Only shopkeepers can edit what customers see.</p></div><Button onClick={savePromotions} disabled={savingPromotions}><Check /> {savingPromotions ? "Saving…" : "Save changes"}</Button></div>
        <label className="mt-4 grid gap-1 text-sm font-bold">Launching offer message<Input maxLength={200} value={launchMessage} onChange={(event) => setLaunchMessage(event.target.value)} /></label>
        <label className="mt-4 grid gap-1 text-sm font-bold">When a spin coupon and an offer both apply
          <select aria-label="Coupon rule" value={couponRule} onChange={(event) => setCouponRule(event.target.value as CouponRule)} className="h-10 w-full min-w-0 rounded-md border border-input bg-card px-2 font-normal">
            <option value="best">Bigger saving wins</option>
            <option value="coupon">Always use the spin coupon</option>
          </select>
          <span className="text-xs font-normal text-muted-foreground">{couponRule === "best" ? "If the offer saves more, the customer keeps her coupon for a later order." : "An eligible spin coupon is used even when an offer would save more."}</span>
        </label>
        <h4 className="mt-5 font-hand text-xl font-bold">Daily offer cards</h4>
        <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
          {dailyOffers.map((offer, index) => <article key={offer.id} className="grid min-w-0 gap-2 rounded-md border border-border bg-background p-3"><div className="grid grid-cols-[4rem_1fr] gap-2"><Input aria-label={`${offer.id} icon`} maxLength={16} value={offer.icon} onChange={(event) => setDailyOffers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, icon: event.target.value } : item))} /><Input aria-label={`${offer.id} title`} maxLength={80} value={offer.title} onChange={(event) => setDailyOffers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} /></div><Input aria-label={`${offer.id} description`} maxLength={200} value={offer.note} onChange={(event) => setDailyOffers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, note: event.target.value } : item))} /><label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={offer.active} onChange={(event) => setDailyOffers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, active: event.target.checked } : item))} /> Show this offer</label></article>)}
        </div>
        <h4 className="mt-5 font-hand text-xl font-bold">Spin wheel slices</h4>
        <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
           {wheelRewards.map((reward, index) => <article key={`${reward.code}-${index}`} className="grid min-w-0 gap-2 rounded-md border border-border bg-background p-3"><div className="grid grid-cols-[4rem_1fr] gap-2"><Input aria-label={`${reward.code} icon`} maxLength={16} value={reward.icon} onChange={(event) => setWheelRewards((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, icon: event.target.value } : item))} /><Input aria-label={`${reward.code} offer text`} maxLength={80} value={reward.label} onChange={(event) => setWheelRewards((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value, shortLabel: event.target.value } : item))} /></div><select aria-label={`${reward.code} reward rule`} value={reward.kind ?? "luck"} onChange={(event) => setWheelRewards((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, kind: event.target.value === "luck" ? null : event.target.value as CouponKind } : item))} className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"><option value="free60">Free delivery on ₹60+</option><option value="three5">₹5 off any 3 items</option><option value="freeSnack100">Free ₹10 snack on ₹100+</option><option value="halfDelivery">50% off room delivery</option><option value="four10">₹10 off any 4 items</option><option value="premium5">₹5 off 2 premium items</option><option value="luck">Better Luck Next Time</option></select><label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={reward.active} onChange={(event) => setWheelRewards((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, active: event.target.checked } : item))} /> Active slice</label></article>)}
        </div>
        <Button className="mt-4 w-full" onClick={savePromotions} disabled={savingPromotions}><Check /> {savingPromotions ? "Saving…" : "Save offers & wheel"}</Button>
      </section>



      <section className="mt-6 bg-alert p-5 text-alert-foreground shadow-[5px_6px_0_var(--shadow-color)]">
        <div className="flex items-center gap-2"><AlertTriangle className="size-6" /><h3 className="font-hand text-2xl font-bold">Restock Needed! 🚨</h3></div>
        <div className="mt-3 flex flex-wrap gap-2">{lowStock.length === 0 && <span className="text-sm font-bold">Everything is stocked up ✨</span>}{lowStock.map((item) => <span key={item.id} className="rounded-full bg-card px-3 py-1 text-sm font-bold text-foreground">Restock Alert: {item.name} ({item.stock} remaining)</span>)}</div>
      </section>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,.65fr)]">
        <section>
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-hand text-3xl font-bold">Inventory Management</h3><Button variant="secondary" onClick={openAddForm}><PackagePlus /> Add item</Button></div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {products.map((item) => (
              <article key={item.id} className="min-w-0 border-2 border-foreground/10 bg-card p-4 shadow-[3px_4px_0_var(--shadow-color)]">
                <PhotoPicker label={item.name} emoji={item.emoji} image={item.image} onPick={(image) => updateProduct(item.id, { image })} onRemove={() => updateProduct(item.id, { image: null })} compact />
                <div className="mt-3 min-w-0">
                  <div className="min-w-0"><h4 className="truncate font-hand text-xl font-bold">{item.name}</h4><p className="text-xs text-muted-foreground">{isEggProduct(item) ? `${money(item.mrp)} per egg + ₹${site.markup} per bundle` : `MRP ${money(item.mrp)} + ₹${site.markup}`}</p></div>
                </div>
                <label className="mt-3 grid gap-1 text-xs font-bold">Purchase / MRP price<Input key={item.mrp} type="number" min="0" step="0.01" defaultValue={item.mrp} onBlur={(event) => changePrice(item, event.target)} /></label>
                <Counter label="Current stock" value={item.stock} minus={() => changeProduct(item.id,"stock",-1)} plus={() => changeProduct(item.id,"stock",1)} set={(value) => changeProduct(item.id, "stock", value - item.stock)} />
                <Counter label="Restock threshold" value={item.threshold} minus={() => changeProduct(item.id,"threshold",-1)} plus={() => changeProduct(item.id,"threshold",1)} set={(value) => changeProduct(item.id, "threshold", value - item.threshold)} />
                 <Button variant="destructive" className="mt-3 w-full" onClick={() => void deleteProduct(item)}><Trash2 /> Delete item</Button>
              </article>
            ))}
          </div>
        </section>
        <aside className="space-y-7">
          <section className="border-2 border-dashed border-primary/35 bg-accent p-5"><h3 className="font-hand text-2xl font-bold">Customer Wishlist Requests</h3><div className="mt-4 space-y-3">{wishes.length === 0 && <p className="text-sm">No requests yet.</p>}{wishes.map(({ name, count }, index) => <div key={name} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-foreground/10 pb-2"><span className="grid size-7 place-items-center rounded-full bg-primary font-bold text-primary-foreground">{index+1}</span><span className="font-bold [overflow-wrap:anywhere]">{name}</span><span className="text-sm">{plural(count, "Request")}</span></div>)}</div></section>
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
              {shownOrders.map((order) => <OrderCard key={order.id} order={order} busy={updatingOrder === order.id} setFulfilled={(fulfilled) => void setFulfilled(order, fulfilled)} setPaymentReceived={(received) => void setPaymentReceived(order, received)} />)}
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

type DashboardPage = "dashboard" | "manual" | "summary";
const DASHBOARD_PAGES: { id: DashboardPage; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "manual", label: "Manual sale", icon: Receipt },
  { id: "summary", label: "Summary", icon: TrendingUp },
];

const orderTime = (ms: number) => new Date(ms).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** One order for the shopkeeper: who it's for (name, mobile with Call / WhatsApp, where to hand it over), then what's in it. */
/** One order as the shopkeeper sees it; `cancel` adds the site admin's Cancel button. */
export function OrderCard({ order, busy, setFulfilled, setPaymentReceived, cancel }: { order: AdminOrder; busy: boolean; setFulfilled: (fulfilled: boolean) => void; setPaymentReceived: (received: boolean) => void; cancel?: () => void }) {
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
      ) : awaitingConfirmation(order) ? (
        <><Button className="mt-3 w-full" disabled>Mark as Fulfilled</Button><p className="mt-1 text-center text-xs text-muted-foreground">Confirm the payment first (Payment received).</p></>
      ) : <Button className="mt-3 w-full" disabled={busy} onClick={() => setFulfilled(true)}>{busy ? "Saving…" : "Mark as Fulfilled"}</Button>}
      {cancel && !order.cancelled && !order.fulfilled && <Button variant="outline" className="mt-2 w-full border-destructive/60 text-destructive" disabled={busy} onClick={cancel}><X /> Cancel order</Button>}
    </article>
  );
}

function AnalyticsList({ title, items }: { title: string; items: string[] }) {
  return <article className="rounded-md border-2 border-dashed border-primary/30 bg-product p-4"><h4 className="font-hand text-xl font-bold">{title}</h4><ol className="mt-3 space-y-2 text-sm font-semibold">{items.length ? items.map((item, index) => <li key={item}>{index + 1}. {item}</li>) : <li className="text-muted-foreground">Place orders to see insights.</li>}</ol></article>;
}

function OrderHistory({ orders, onOpen, onPay, onEditProfile }: { orders: Order[]; onOpen: (order: Order) => void; onPay: (order: Order) => void; onEditProfile: () => void }) {
  return <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6 [overflow-wrap:anywhere]"><p className="font-hand text-lg font-bold text-primary">Saved to your account</p><div className="flex flex-wrap items-end justify-between gap-3"><h2 className="font-display text-4xl font-extrabold">My Orders</h2><Button variant="outline" size="sm" onClick={onEditProfile}>Edit my hostel details</Button></div>{orders.length === 0 ? <p className="mt-6 border-2 border-dashed border-border bg-card p-8 text-center text-muted-foreground">Your first order will appear here.</p> : <div className="mt-6 grid gap-4 sm:grid-cols-2">{orders.map((order) => <article key={order.id} className="rounded-md border-2 border-dashed border-primary/30 bg-card p-5 shadow-[4px_5px_0_var(--shadow-color)]"><div className="flex items-start justify-between gap-3"><div><h3 className="font-hand text-2xl font-bold">Order {orderLabel(order)}</h3><p className="text-xs text-muted-foreground">{order.createdAt ? new Date(order.createdAt).toLocaleString() : ""}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${orderState(order).waiting ? "bg-accent text-accent-foreground" : "bg-stock text-stock-foreground"}`}>{orderState(order).badge}</span></div><p className="mt-3 text-sm">{order.items.map((item) => `${item.name} ×${item.qty}`).join(", ")}</p><p className="mt-2 text-sm text-muted-foreground">{order.delivery} · {order.payment}</p><p className="text-sm font-semibold">{orderState(order).detail}</p>{needsPayment(order) && <Button size="sm" className="mt-2 w-full" onClick={() => onPay(order)}>Pay {money(order.total)} now</Button>}<div className="mt-3 flex items-center justify-between"><b className="text-xl text-primary">{money(order.total)}</b><Button size="sm" variant="outline" onClick={() => onOpen(order)}>View receipt</Button></div></article>)}</div>}</section>;
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

function Checkout({ cartItems, products, coupon, firstOrder, dailyOffers, couponRule, storeOnline, profile, onClose, onComplete }: { cartItems: (Product & { qty: number })[]; products: Product[]; coupon: Coupon | null; firstOrder: boolean; dailyOffers: DailyOffer[]; couponRule: CouponRule; storeOnline: boolean; profile: CustomerProfile; onClose: () => void; onComplete: (input: PlaceOrderInput) => Promise<void> }) {
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
  const previousDeal = useRef<string | undefined>(undefined);

  const lines = useMemo(() => cartItems.map((item) => ({ product: item, qty: item.qty })), [cartItems]);
  const priced = useMemo(
    () => quote({ lines, delivery, firstOrder, coupon, dailyOffers, couponRule, rules }),
    // rules is rebuilt each render; its two numbers are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [coupon, couponRule, dailyOffers, delivery, firstOrder, lines, rules.markup, rules.deliveryFee],
  );
  const best = priced.deal;
  const subtotal = toRupees(priced.subtotal);
  const discount = toRupees(priced.discount);
  const total = toRupees(priced.total);
  // Items she could take free: cheap enough, and still in stock after her own cart.
  const freeChoices = products.filter((item) => item.mrp <= FREE_PICK_MAX_PRICE && item.stock - (cartItems.find((line) => line.id === item.id)?.qty ?? 0) > 0);
  const couponCheck = couponStatus(coupon, cartSummary(lines, rules), delivery);
  const couponApplied = best?.kind === "coupon";

  useEffect(() => {
    if (best?.kind === "tier100" && previousDeal.current === "tier50") toast.success(`Applied ${best.label} (replaced the ₹50+ offer)`);
    previousDeal.current = best?.kind;
  }, [best]);

  const getsTenSnack = Boolean(best?.freePick);
  const getsFiveChocolate = best?.kind === "tier50";

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
        ...(getsTenSnack && freeItem ? { freePick: freeItem } : {}),
        ...(delivery === "Room Delivery" ? { name: name.trim(), phone: phone.trim(), block, room: room.trim() } : {}),
        expectedTotal: total,
      });
    } finally {
      setPlacing(false);
    }
  }, [block, cartItems, delivery, freeItem, getsTenSnack, name, onComplete, payment, phone, placing, room, total]);

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
            {!storeOnline && <p className="mt-4 rounded-md bg-accent p-3 text-sm font-semibold text-accent-foreground">🌙 Store is offline right now — your order goes through as an <b>on-request</b> order and the shopkeeper will confirm it.</p>}

            <div className="mt-5 space-y-2">
              {cartItems.map(item => <div key={item.id} className="flex items-center justify-between border-b border-border py-2"><span className="flex items-center gap-2">{item.image ? <img src={item.image} alt="" className="size-8 rounded object-cover" /> : <span aria-hidden="true">{item.emoji}</span>}<span><b>{item.name}</b> × {item.qty}</span></span><span>{money(toRupees(lineTotal(item, item.qty, rules)))}</span></div>)}
            </div>

            {coupon && <div className={`mt-4 rounded-md border-2 border-dashed p-3 text-sm font-bold ${couponApplied ? "border-stock bg-stock text-stock-foreground" : "border-primary/30 bg-banner text-foreground"}`}><p>{coupon.icon} {coupon.label}</p><p className="mt-1 text-xs font-semibold">{couponCheck.eligible && !couponApplied ? `Saved for later: ${best?.label ?? "another offer"} saves you more on this order.` : couponCheck.reason}</p>{!couponCheck.eligible && <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => toast.info(couponCheck.reason)}>Check coupon</Button>}</div>}

            {(getsFiveChocolate || getsTenSnack) && (
              <div className="mt-4 border-2 border-dashed border-primary/35 bg-banner p-4">
                <p className="flex items-center gap-2 font-hand text-xl font-bold"><Gift className="size-5" /> Your freebies</p>
                {getsFiveChocolate && <p className="mt-1 text-sm font-semibold">✓ ₹50+ Offer: free ₹5 chocolate added to your bag.</p>}
                {getsTenSnack && (
                  <label className="mt-3 grid gap-1 text-sm font-semibold">
                    Pick your free ₹10 item
                    <select aria-label="Free item" value={freeItem} onChange={(e) => setFreeItem(e.target.value)} className="h-10 rounded-md border border-input bg-card px-2">
                      <option value="">Choose an item…</option>
                      {freeChoices.map((item) => <option key={item.id} value={item.name}>{item.emoji} {item.name}</option>)}
                    </select>
                  </label>
                )}
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
          </>
        )}
      </section>
    </div>
  );
}

function CheckoutChoice({ title, options, value, setValue, deliveryFee }: { title: string; options: readonly string[]; value: string; setValue: (value: string) => void; deliveryFee: number }) {
  return <fieldset className="mt-5"><legend className="font-hand text-xl font-bold">{title}</legend><div className={`mt-2 grid gap-2 ${options.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>{options.map(option => <Button type="button" key={option} variant={value === option ? "default" : "outline"} onClick={() => setValue(option)} className="h-auto min-h-10 whitespace-normal px-2">{option}{option === "Room Delivery" && (deliveryFee ? ` + ₹${deliveryFee}` : " · Free")}{option === "Pickup" && " · Free"}</Button>)}</div></fieldset>;
}
