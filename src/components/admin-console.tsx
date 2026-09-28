// The admin console at /admin: the whole shop and shopkeeper dashboard, shop details (UPI ID and
// QR, contacts, pickup point, hours, payment and delivery options, prices, sign-ups), people
// (customers, shopkeepers and admins: new passwords, blocking, deleting), every order, investment
// (stock bought and the stock left), profit (day by day and item by item), and access (adding
// shopkeepers and admins, your own password). Admins sign in with their mobile number and password.
// Nothing links here; the backend answers 404 to anyone without an admin session.
import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Ban,
  ClipboardList,
  History,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Pencil,
  Phone,
  QrCode,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Store,
  Trash2,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { toast, Toaster } from "sonner";

import { OrderCard, ShopPage } from "@/components/shop-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminApi, ORDER_PAGE } from "@/lib/admin-api";
import { api, SIGNED_OUT } from "@/lib/api";
import { alertsState } from "@/lib/order-alerts";
import { staleSince, useLiveSync, writeMark } from "@/lib/live-sync";
import type {
  AdminOrder,
  AdminOrderStatus,
  AdminOverview,
  AdminUser,
  AdminUserRole,
  Block,
  Investment,
  InvestmentItem,
  InvestmentPeriod,
  Profit,
  ProfitFigures,
  ProfitItem,
  SiteAdminSettings,
  SiteSettings,
  StaffRole,
  User,
} from "@/lib/mart-types";
import { callLink, formatMobile, isMobile, whatsappChat } from "@/lib/phone";
import { money, toPaise, toRupees } from "@/lib/pricing";
import { hourLabel } from "@/lib/site";
import { readQrImage, upiProfileLink, upiQrName, upiQrPayee } from "@/lib/upi";

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;
const UPI_ID = /^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,63}$/;
const REFRESH_MS = 15_000;
const orderLabel = (order: AdminOrder) => `#${String(order.orderNumber).padStart(4, "0")}`;

type Tab =
  "overview" | "shop" | "details" | "people" | "orders" | "investment" | "profit" | "access";
const TABS: { id: Tab; label: string; icon: typeof Store }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "shop", label: "Shop & dashboard", icon: Store },
  { id: "details", label: "Shop details", icon: Settings },
  { id: "people", label: "People", icon: Users },
  { id: "orders", label: "Orders", icon: ClipboardList },
  { id: "investment", label: "Investment", icon: Wallet },
  { id: "profit", label: "Profit", icon: TrendingUp },
  { id: "access", label: "Access", icon: KeyRound },
];

// --- sign-in ---

const TITLE = "Admin | Kannagi Night Mart";

export function AdminSignIn() {
  useEffect(() => {
    document.title = TITLE;
  }, []);
  const router = useRouter();
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!isMobile(mobile)) {
      toast.error("Enter your 10-digit mobile number.");
      return;
    }
    setBusy(true);
    try {
      await adminApi.login(mobile.trim(), password);
      await router.invalidate();
    } catch (error) {
      toast.error(errorText(error, "Could not sign in."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="grid min-h-screen place-items-center bg-background p-4 text-foreground">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-3 rounded-lg border-2 border-primary bg-card p-6 shadow-[6px_7px_0_var(--shadow-color)]"
      >
        <ShieldCheck className="size-9 text-primary" />
        <h1 className="font-display text-3xl font-extrabold">Admin</h1>
        <p className="text-sm text-muted-foreground">Kannagi Night Mart site administration.</p>
        <Input
          type="tel"
          inputMode="tel"
          autoComplete="username"
          required
          maxLength={20}
          placeholder="Mobile number"
          aria-label="Admin mobile number"
          value={mobile}
          onChange={(event) => setMobile(event.target.value)}
        />
        <Input
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
          placeholder="Password"
          aria-label="Admin password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Button disabled={busy} className="h-11 w-full">
          <ShieldCheck />
          {busy ? "Please wait…" : "Sign in"}
        </Button>
      </form>
      <Toaster position="top-center" richColors />
    </main>
  );
}

// --- console ---

/** Whose orders the Orders tab shows (from a person's card in People). */
type OrdersOf = { id: string; label: string };

export function AdminConsole({ user }: { user: User }) {
  useEffect(() => {
    document.title = TITLE;
  }, []);
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [peopleRole, setPeopleRole] = useState<AdminUserRole>("all");
  const [ordersOf, setOrdersOf] = useState<OrdersOf | null>(null);
  const open = useCallback((next: Tab, role?: AdminUserRole) => {
    if (role) setPeopleRole(role);
    setTab(next);
  }, []);
  const showOrders = useCallback((person: OrdersOf) => {
    setOrdersOf(person);
    setTab("orders");
  }, []);

  async function signOut() {
    await api.logout().catch(() => undefined);
    await router.invalidate();
  }

  // Signed out while the console is open (the 12-hour session ended, the password was changed, or the
  // account was blocked or deleted): back to the sign-in instead of a page whose every action fails.
  useEffect(() => {
    const backToSignIn = () => void router.invalidate();
    window.addEventListener(SIGNED_OUT, backToSignIn);
    return () => window.removeEventListener(SIGNED_OUT, backToSignIn);
  }, [router]);

  // Order alerts on this device follow the admin's sign-in, which lasts 12 hours: signing in again here
  // keeps them going, without opening the shop dashboard.
  useEffect(() => {
    void alertsState().catch(() => undefined);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b-4 border-primary bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 pt-4">
          <div className="min-w-0">
            <p className="font-hand text-lg font-bold text-primary">Kannagi Night Mart</p>
            <h1 className="font-display text-3xl font-extrabold">Admin console</h1>
            {user.phone && (
              <p className="text-xs text-muted-foreground">
                Signed in as {formatMobile(user.phone)}
                {user.isOwner ? " (main admin)" : ""}
              </p>
            )}
          </div>
          <Button variant="outline" onClick={() => void signOut()}>
            <LogOut />
            Sign out
          </Button>
        </div>
        <nav
          aria-label="Admin sections"
          className="mx-auto flex max-w-6xl flex-wrap gap-1 px-4 py-3"
        >
          {TABS.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              size="sm"
              variant={tab === id ? "default" : "ghost"}
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
            >
              <Icon />
              {label}
            </Button>
          ))}
        </nav>
      </header>
      {tab === "shop" ? (
        // The full shop and shopkeeper dashboard: products, stock, offers, spin wheel, store status,
        // orders and sales, plus the customer view. It brings its own notifications.
        <ShopPage user={user} initialMode="admin" signedOutTo="/admin" />
      ) : (
        <main className="mx-auto max-w-6xl px-4 py-6 pb-16">
          {tab === "overview" && <OverviewTab open={open} />}
          {tab === "details" && <DetailsTab />}
          {tab === "people" && (
            <PeopleTab
              me={user}
              role={peopleRole}
              setRole={setPeopleRole}
              showOrders={showOrders}
              addStaff={() => setTab("access")}
            />
          )}
          {tab === "orders" && (
            <OrdersTab customer={ordersOf} clearCustomer={() => setOrdersOf(null)} />
          )}
          {tab === "investment" && <InvestmentTab />}
          {tab === "profit" && <ProfitTab />}
          {tab === "access" && <AccessTab me={user} />}
          <Toaster position="top-center" richColors />
        </main>
      )}
    </div>
  );
}

/** Loads data for a tab, then keeps it fresh (every 15 s, and right after any change from this browser). */
function useAdminData<T>(
  load: () => Promise<T>,
  deps: unknown[],
): [T | null, (value: T | null) => void, () => void] {
  const [data, setData] = useState<T | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const refresh = useCallback(async () => {
    const mark = writeMark();
    const value = await loadRef.current();
    if (!staleSince(mark)) setData(value);
  }, []);
  const syncSoon = useLiveSync(refresh, { enabled: true, everyMs: REFRESH_MS });
  // A new search or filter loads at once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => syncSoon(), deps);
  return [data, setData, syncSoon];
}

function Section({
  title,
  children,
  note,
}: {
  title: string;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <section className="mt-5 rounded-lg border-2 border-foreground/10 bg-card p-4 shadow-[3px_4px_0_var(--shadow-color)] sm:p-5">
      <h2 className="font-hand text-2xl font-bold">{title}</h2>
      {note && <p className="mt-1 text-sm text-muted-foreground">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

// --- overview ---

function OverviewTab({ open }: { open: (tab: Tab, role?: AdminUserRole) => void }) {
  const [overview] = useAdminData<AdminOverview>(() => adminApi.overview(), []);
  const tiles: [string, string | number, Tab, AdminUserRole?][] = overview
    ? [
        ["Orders today", overview.ordersToday, "orders"],
        ["Manual sales today", overview.manualSalesToday ?? 0, "shop"],
        ["Money in today (online + manual)", money(overview.revenueToday), "orders"],
        ["Stock left (at MRP)", money(overview.stockValue ?? 0), "investment"],
        ["Open orders", overview.openOrders, "orders"],
        ["UPI payments to confirm", overview.awaitingPayment, "orders"],
        ["Password requests", overview.resetRequests, "people", "resets"],
        ["Customers", overview.customers, "people", "customers"],
        ["Shopkeepers", overview.shopkeepers, "people", "shopkeepers"],
        ["Admins", overview.admins, "people", "admins"],
        ["Blocked accounts", overview.blocked, "people", "blocked"],
        ["Store right now", overview.storeOnline ? "Online" : "Offline", "shop"],
      ]
    : [];
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Everything on the customer and shopkeeper side is controlled from here. Changes reach open
        pages within seconds.
      </p>
      {!overview && <p className="mt-6 text-muted-foreground">Loading…</p>}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([label, value, target, role]) => (
          <button
            key={label}
            type="button"
            onClick={() => open(target, role)}
            className={`min-w-0 rounded-lg border-2 border-dashed p-4 text-left hover:border-primary ${role === "resets" && Number(value) > 0 ? "border-primary bg-accent" : "border-primary/30 bg-card"}`}
          >
            <p className="text-xs font-bold text-muted-foreground">{label}</p>
            <p className="font-display text-xl font-extrabold text-primary [overflow-wrap:anywhere] sm:text-3xl">
              {value}
            </p>
          </button>
        ))}
      </div>
      <Section title="Where things are">
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          <li>
            <b>Shop &amp; dashboard:</b> products, photos, stock, prices, offers, spin wheel, store
            open/closed and orders; Manual sale (sales made in person) and Summary (online, manual
            and total sales and profit). Also shows the shop as customers see it.
          </li>
          <li>
            <b>Shop details:</b> UPI ID and QR, payee name, phone numbers, pickup point, hours,
            payment and delivery options, delivery fee, markup, new sign-ups.
          </li>
          <li>
            <b>People:</b> customers, shopkeepers and admins: set a new password, block, sign out,
            edit hostel details, see someone&apos;s orders, delete an account.
          </li>
          <li>
            <b>Orders:</b> every order ever, searchable, with older ones a tap away: confirm
            payments, mark fulfilled, cancel.
          </li>
          <li>
            <b>Investment:</b> new stock bought (today, the last 7 days, this month, last month or
            all time) and what the stock left is worth, with every stock change and who made it.
          </li>
          <li>
            <b>Profit:</b> profit day by day (a night&apos;s sales after midnight count with that
            night) and item by item, online and manual, and the profit in the stock left.
          </li>
          <li>
            <b>Access:</b> add a shopkeeper or another admin (their mobile number and password), and
            change your own password.
          </li>
        </ul>
      </Section>
    </>
  );
}

// --- shop details ---

type Toggle = {
  [K in keyof SiteSettings]-?: SiteSettings[K] extends boolean ? K : never;
}[keyof SiteSettings];

const editable = (settings: SiteAdminSettings): SiteSettings => {
  const { photoUploadsEnabled: _photos, ...rest } = settings;
  return rest;
};

function useQr(text: string) {
  const [qr, setQr] = useState("");
  useEffect(() => {
    let active = true;
    void import("qrcode")
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(text, {
          margin: 1,
          width: 200,
          color: { dark: "#111936", light: "#ffffff" },
        }),
      )
      .then((url) => {
        if (active) setQr(url);
      })
      .catch(() => {
        if (active) setQr("");
      });
    return () => {
      active = false;
    };
  }, [text]);
  return qr;
}

function DetailsTab() {
  const [draft, setDraft] = useState<SiteSettings | null>(null);
  const [info, setInfo] = useState<SiteAdminSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = useRef(false);

  const load = useCallback(async () => {
    const settings = await adminApi.settings();
    setInfo(settings);
    // Never overwrite changes that aren't saved yet.
    if (!dirty.current) setDraft(editable(settings));
  }, []);
  useLiveSync(load, { enabled: true, everyMs: REFRESH_MS });

  const set = <K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) => {
    dirty.current = true;
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  // With the shop's own QR uploaded, customers scan a QR with exactly its text; otherwise one made from the UPI ID.
  const qr = useQr(
    draft
      ? draft.upiQr || upiProfileLink({ upiId: draft.upiId.trim(), upiName: draft.upiName.trim() })
      : "upi://pay",
  );
  const qrPayee = draft?.upiQr ? upiQrPayee(draft.upiQr) : null;
  const qrMismatch = Boolean(
    draft && qrPayee && qrPayee.toLowerCase() !== draft.upiId.trim().toLowerCase(),
  );
  const qrFile = useRef<HTMLInputElement>(null);
  const [readingQr, setReadingQr] = useState(false);

  async function uploadQr(file: File | undefined) {
    if (!file) return;
    setReadingQr(true);
    try {
      const text = await readQrImage(file);
      const payee = text ? upiQrPayee(text) : null;
      if (!text || !payee) {
        toast.error(
          text
            ? "That QR isn't a UPI payment QR. Upload the QR from your PhonePe, Google Pay or Paytm app."
            : "Couldn't find a QR code in that picture. Try a clear screenshot of the whole QR.",
        );
        return;
      }
      const name = upiQrName(text);
      dirty.current = true;
      setDraft((current) =>
        current
          ? { ...current, upiQr: text, upiId: payee, upiName: name ? name.slice(0, 60) : current.upiName }
          : current,
      );
      toast.success(`QR read: it pays ${payee}. Press Save to use it.`);
    } catch {
      toast.error("Couldn't open that picture. Try a PNG or JPEG screenshot of the QR.");
    } finally {
      setReadingQr(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const problems = [
      !UPI_ID.test(draft.upiId.trim()) && "Enter a UPI ID like 7032767115@ibl.",
      qrMismatch && `The QR pays ${qrPayee}, not ${draft.upiId.trim()}. Upload the QR for this UPI ID, or remove the QR.`,
      !isMobile(draft.shopPhone) && "Enter a 10-digit shop phone number.",
      !isMobile(draft.helpPhone) && "Enter a 10-digit help phone number.",
      draft.openHour === draft.closeHour && "Opening and closing hours must be different.",
      !(draft.upiEnabled || draft.cashEnabled) && "Keep at least one way to pay.",
      !(draft.pickupEnabled || draft.roomDeliveryEnabled) && "Keep at least one way to get orders.",
    ].filter(Boolean);
    if (problems.length) {
      toast.error(String(problems[0]));
      return;
    }
    setSaving(true);
    try {
      const saved = await adminApi.saveSettings({ ...draft, upiId: draft.upiId.trim() });
      dirty.current = false;
      setInfo(saved);
      setDraft(editable(saved));
      toast.success("Saved. Customers and shopkeepers see the new details within seconds.");
    } catch (error) {
      toast.error(errorText(error, "Could not save."));
    } finally {
      setSaving(false);
    }
  }

  if (!draft) return <p className="text-muted-foreground">Loading…</p>;
  const toggle = (key: Toggle, label: string, note?: string) => (
    <label className="flex items-start gap-2 text-sm font-bold">
      <input
        type="checkbox"
        className="mt-1"
        checked={draft[key]}
        onChange={(event) => set(key, event.target.checked)}
      />
      <span>
        {label}
        {note && <span className="block text-xs font-normal text-muted-foreground">{note}</span>}
      </span>
    </label>
  );
  const field = (label: string, input: ReactNode, note?: string) => (
    <label className="grid gap-1 text-sm font-bold">
      {label}
      {input}
      {note && <span className="text-xs font-normal text-muted-foreground">{note}</span>}
    </label>
  );
  const hours = Array.from({ length: 24 }, (_, hour) => hour);

  return (
    <form onSubmit={save}>
      <Section
        title="UPI payments (QR code)"
        note="Customers pay by scanning the QR on the right. Upload your own QR from PhonePe, Google Pay or Paytm and they scan exactly that; without one, they get a QR made from the UPI ID with the amount filled in."
      >
        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <div className="grid gap-3">
            <div className="grid gap-1 text-sm font-bold">
              Shop&apos;s UPI QR
              <div className="flex flex-wrap gap-2">
                <input
                  ref={qrFile}
                  type="file"
                  accept="image/*"
                  aria-label="Upload the shop's UPI QR"
                  className="sr-only"
                  onChange={(event) => {
                    void uploadQr(event.target.files?.[0]);
                    event.target.value = ""; // the same picture again still counts as a new upload
                  }}
                />
                <Button type="button" variant="outline" disabled={readingQr} onClick={() => qrFile.current?.click()}>
                  <QrCode /> {readingQr ? "Reading QR…" : draft.upiQr ? "Upload a new QR" : "Upload QR"}
                </Button>
                {draft.upiQr && (
                  <Button type="button" variant="ghost" onClick={() => set("upiQr", null)}>
                    Remove QR
                  </Button>
                )}
              </div>
              <span className="text-xs font-normal text-muted-foreground">
                {draft.upiQr
                  ? `Uploaded: customers scan your QR (it pays ${qrPayee ?? "?"}) and type in the amount.`
                  : "A screenshot of your QR (PhonePe: profile → QR code). The UPI ID and name below are filled in from it."}
              </span>
            </div>
            {field(
              "UPI ID",
              <Input
                aria-label="UPI ID"
                maxLength={130}
                value={draft.upiId}
                onChange={(event) => set("upiId", event.target.value)}
                placeholder="7032767115@ibl"
              />,
              qrMismatch
                ? `This isn't the UPI ID your QR pays (${qrPayee}). Upload the QR for this UPI ID, or remove the QR.`
                : "The UPI ID from your PhonePe / GPay QR (the part after pa=).",
            )}
            {field(
              "Payee name",
              <Input
                aria-label="Payee name"
                value={draft.upiName}
                maxLength={60}
                onChange={(event) => set("upiName", event.target.value)}
              />,
              "The bank account holder's name, as UPI apps show it before paying.",
            )}
            {toggle("upiEnabled", "Accept UPI payments")}
            {toggle("cashEnabled", "Accept Pay on Delivery")}
          </div>
          <figure className="justify-self-center text-center">
            {qr ? (
              <img
                src={qr}
                alt={`UPI QR code for ${draft.upiId}`}
                width={200}
                height={200}
                className="size-44 rounded-md bg-white p-1"
              />
            ) : (
              <div className="grid size-44 place-items-center text-sm text-muted-foreground">
                <QrCode className="size-10" />
              </div>
            )}
            <figcaption className="mt-1 max-w-44 break-words text-xs text-muted-foreground">
              {draft.upiQr ? "Your QR, as customers scan it. " : ""}Scan with your UPI app to check it shows{" "}
              <b>{draft.upiName}</b>.
            </figcaption>
          </figure>
        </div>
      </Section>

      <Section title="Contact & pickup">
        <div className="grid gap-3 sm:grid-cols-2">
          {field(
            "Shop phone (calls & WhatsApp)",
            <Input
              aria-label="Shop phone"
              inputMode="tel"
              maxLength={20}
              value={draft.shopPhone}
              onChange={(event) => set("shopPhone", event.target.value)}
            />,
          )}
          {field(
            "Help phone",
            <Input
              aria-label="Help phone"
              inputMode="tel"
              maxLength={20}
              value={draft.helpPhone}
              onChange={(event) => set("helpPhone", event.target.value)}
            />,
            "Shown on pickup receipts for when the shop is closed.",
          )}
          {field(
            "Pickup point",
            <Input
              aria-label="Pickup point"
              maxLength={80}
              value={draft.pickupPoint}
              onChange={(event) => set("pickupPoint", event.target.value)}
            />,
            "e.g. Block B, Room 618",
          )}
        </div>
      </Section>

      <Section
        title="Hours"
        note="With the store set to Auto, it's online between these hours (shop time); outside them, orders come in as requests."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {field(
            "Opens at",
            <select
              aria-label="Opens at"
              value={draft.openHour}
              onChange={(event) => set("openHour", Number(event.target.value))}
              className="h-10 rounded-md border border-input bg-background px-2 font-normal"
            >
              {hours.map((hour) => (
                <option key={hour} value={hour}>
                  {hourLabel(hour)}
                </option>
              ))}
            </select>,
          )}
          {field(
            "Closes at",
            <select
              aria-label="Closes at"
              value={draft.closeHour}
              onChange={(event) => set("closeHour", Number(event.target.value))}
              className="h-10 rounded-md border border-input bg-background px-2 font-normal"
            >
              {hours.map((hour) => (
                <option key={hour} value={hour}>
                  {hourLabel(hour)}
                </option>
              ))}
            </select>,
          )}
        </div>
      </Section>

      <Section
        title="Delivery & prices"
        note="Changing a price rule changes what customers pay from the next order on; carts update by themselves."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {toggle("pickupEnabled", "Offer Pickup")}
          {toggle("roomDeliveryEnabled", "Offer Room Delivery")}
          {field(
            "Room delivery fee (₹)",
            <Input
              aria-label="Room delivery fee"
              type="number"
              min={0}
              max={100}
              step={1}
              value={draft.deliveryFee}
              onChange={(event) =>
                set(
                  "deliveryFee",
                  Math.max(0, Math.min(100, Math.round(Number(event.target.value) || 0))),
                )
              }
            />,
            "The FREE Delivery and 50% OFF Delivery coupons follow this.",
          )}
          {field(
            "Markup per item (₹)",
            <Input
              aria-label="Markup per item"
              type="number"
              min={0}
              max={100}
              step={1}
              value={draft.markup}
              onChange={(event) =>
                set(
                  "markup",
                  Math.max(0, Math.min(100, Math.round(Number(event.target.value) || 0))),
                )
              }
            />,
            "Customers pay MRP + this (eggs: once per order).",
          )}
        </div>
      </Section>

      <Section title="Customers">
        {toggle(
          "signupsOpen",
          "Allow new customer accounts",
          "When off, existing customers can still sign in and order.",
        )}
      </Section>

      {info && (
        <p className="mt-4 text-xs text-muted-foreground">
          Photo uploads{" "}
          {info.photoUploadsEnabled ? "go to Cloudinary" : "are stored in the database"}.
        </p>
      )}
      <div className="sticky bottom-0 mt-4 flex gap-2 border-t border-border bg-background/95 py-3">
        <Button disabled={saving} className="h-auto min-h-11 min-w-0 flex-1 whitespace-normal">
          <Save />
          {saving ? "Saving…" : "Save shop details"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-11 whitespace-normal"
          disabled={saving}
          onClick={() => {
            dirty.current = false;
            if (info) setDraft(editable(info));
          }}
        >
          Undo changes
        </Button>
      </div>
    </form>
  );
}

// --- people ---

const ROLES: [AdminUserRole, string][] = [
  ["all", "Everyone"],
  ["resets", "Password requests"],
  ["customers", "Customers"],
  ["shopkeepers", "Shopkeepers"],
  ["admins", "Admins"],
  ["blocked", "Blocked"],
];

const when = (ms: number) =>
  new Date(ms).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

/** An easy-to-read password to give someone (no look-alike characters such as 0/o or 1/l). */
function suggestPassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyz23456789";
  const picks = Array.from(
    crypto.getRandomValues(new Uint32Array(8)),
    (n) => letters[n % letters.length],
  );
  return `${picks.slice(0, 4).join("")}-${picks.slice(4).join("")}`;
}

/** A customer account (an older API doesn't say: then the ones with an email). */
const isCustomer = (person: AdminUser) => person.isCustomer ?? Boolean(person.email);

/** How a person is named on the page: a customer's name or number, or an admin's or shopkeeper's number. */
const nameOf = (person: AdminUser) =>
  isCustomer(person)
    ? person.profile?.fullName ||
      (person.mobile ? formatMobile(person.mobile) : (person.email ?? "Customer"))
    : person.phone
      ? formatMobile(person.phone)
      : "Account";

function PeopleTab({
  me,
  role,
  setRole,
  showOrders,
  addStaff,
}: {
  me: User;
  role: AdminUserRole;
  setRole: (role: AdminUserRole) => void;
  showOrders: (person: OrdersOf) => void;
  addStaff: () => void;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  const [people, setPeople] = useAdminData<AdminUser[]>(
    () => adminApi.users(role, search),
    [role, search],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [settingPassword, setSettingPassword] = useState<string | null>(null);
  // Kept above the list: in "Password requests" she drops off the list once her password is set.
  const [told, setTold] = useState<{ person: AdminUser; password: string } | null>(null);

  async function act(person: AdminUser, run: () => Promise<AdminUser>, done: string) {
    setBusy(person.id);
    try {
      const updated = await run();
      setPeople((people ?? []).map((item) => (item.id === updated.id ? updated : item)));
      toast.success(done);
      return true;
    } catch (error) {
      toast.error(errorText(error, "That didn't work."));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(person: AdminUser) {
    setBusy(person.id);
    try {
      await adminApi.dismissResetRequest(person.id);
      setPeople(
        (people ?? [])
          .filter((item) => role !== "resets" || item.id !== person.id)
          .map((item) => {
            if (item.id !== person.id) return item;
            const { resetRequestedAt: _asked, ...rest } = item;
            return rest;
          }),
      );
      toast.success("Request taken off the list.");
    } catch (error) {
      toast.error(errorText(error, "That didn't work."));
    } finally {
      setBusy(null);
    }
  }

  async function remove(person: AdminUser) {
    const orders = person.orderCount
      ? `Their ${person.orderCount} past order${person.orderCount === 1 ? "" : "s"} stay in Orders. `
      : "";
    const data = isCustomer(person) ? ", hostel details, wishlist votes and coupons" : "";
    if (
      !window.confirm(
        `Delete ${nameOf(person)}? ${orders}The account${data} are deleted, and it can't sign in again. This can't be undone.`,
      )
    )
      return;
    setBusy(person.id);
    try {
      await adminApi.deleteUser(person.id);
      setPeople((people ?? []).filter((item) => item.id !== person.id));
      toast.success(`${nameOf(person)} deleted.`);
    } catch (error) {
      toast.error(errorText(error, "That didn't work."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Show people" className="flex flex-wrap gap-1">
          {ROLES.map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={role === value ? "default" : "outline"}
              aria-pressed={role === value}
              onClick={() => setRole(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <label className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            aria-label="Search people"
            className="pl-9"
            placeholder="Name, mobile or room"
            maxLength={100}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      {role === "resets" && (
        <p className="mt-3 text-sm text-muted-foreground">
          Customers who tapped &ldquo;Forgot password?&rdquo;. The shop sends no messages or codes
          by itself: set a new password here, then send it to her on WhatsApp or call her.
        </p>
      )}
      {(role === "shopkeepers" || role === "admins") && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            {role === "admins"
              ? "Admins sign in at /admin with their mobile number and password."
              : "Shopkeepers sign in on the Shopkeeper tab with their mobile number and password."}
          </span>
          <Button size="sm" variant="outline" onClick={addStaff}>
            <UserPlus />
            Add a shopkeeper or admin
          </Button>
        </div>
      )}
      {told && <PasswordToGive {...told} close={() => setTold(null)} />}
      {!people && <p className="mt-6 text-muted-foreground">Loading…</p>}
      {people?.length === 0 && (
        <p className="mt-6 text-muted-foreground">
          {role === "resets" ? "Nobody is waiting for a new password." : "Nobody matches."}
        </p>
      )}
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        {people?.map((person) => {
          const self = person.id === me.id;
          // The main admin (from the server settings) and your own account can't be blocked,
          // deleted or given a new password from here.
          const locked = person.isOwner || self;
          return (
            <article
              key={person.id}
              aria-label={person.mobile ?? person.phone ?? person.email ?? "Account"}
              className={`min-w-0 rounded-lg border-2 border-foreground/10 p-4 shadow-[3px_4px_0_var(--shadow-color)] [overflow-wrap:anywhere] ${person.blocked ? "bg-muted" : "bg-card"}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 break-all font-bold">{nameOf(person)}</p>
                {person.isAdmin && (
                  <span className="rounded-full bg-foreground px-2 py-0.5 text-[11px] font-bold text-background">
                    {person.isOwner ? "Main admin" : "Admin"}
                  </span>
                )}
                {person.isShopkeeper && (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">
                    Shopkeeper
                  </span>
                )}
                {self && (
                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-bold">
                    You
                  </span>
                )}
                {person.blocked && (
                  <span className="rounded-full bg-destructive px-2 py-0.5 text-[11px] font-bold text-destructive-foreground">
                    Blocked
                  </span>
                )}
                {person.resetRequestedAt && (
                  <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-foreground">
                    Forgot password · {when(person.resetRequestedAt)}
                  </span>
                )}
              </div>
              {person.mobile && (
                <p className="mt-1 text-sm">
                  Mobile (signs in with it){" "}
                  <a className="underline" href={callLink(person.mobile)}>
                    {formatMobile(person.mobile)}
                  </a>
                </p>
              )}
              {person.profile ? (
                <p className="mt-1 text-sm">
                  {person.profile.fullName} · {formatMobile(person.profile.phone)} · Block{" "}
                  {person.profile.block}, Room {person.profile.roomNumber}
                </p>
              ) : (
                isCustomer(person) && (
                  <p className="mt-1 text-sm text-muted-foreground">No hostel details saved</p>
                )
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {person.orderCount} order{person.orderCount === 1 ? "" : "s"} ·{" "}
                {money(person.spent)} · joined{" "}
                {new Date(person.createdAt).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </p>
              {person.isOwner && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Set in the server settings (ADMIN_MOBILE, ADMIN_PASSWORD), so it can&apos;t be
                  blocked, deleted or given a new password here.
                </p>
              )}
              {self && !person.isOwner && (
                <p className="mt-1 text-xs text-muted-foreground">
                  This is you: change your password in Access.
                </p>
              )}
              {settingPassword === person.id ? (
                <PasswordSetter
                  cancel={() => setSettingPassword(null)}
                  save={async (password) => {
                    if (
                      await act(
                        person,
                        () => adminApi.setPassword(person.id, password),
                        "Password changed. They're signed out everywhere.",
                      )
                    ) {
                      setSettingPassword(null);
                      setTold({ person, password });
                    }
                  }}
                />
              ) : editing === person.id ? (
                <ProfileEditor
                  person={person}
                  cancel={() => setEditing(null)}
                  save={(profile) =>
                    act(
                      person,
                      () => adminApi.editProfile(person.id, profile),
                      "Details saved.",
                    ).then(() => setEditing(null))
                  }
                />
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {(!locked || person.blocked) && (
                    <Button
                      size="sm"
                      variant={person.blocked ? "default" : "outline"}
                      disabled={busy === person.id}
                      onClick={() => {
                        if (
                          !person.blocked &&
                          !window.confirm(
                            `Block ${nameOf(person)}? They're signed out everywhere and can't sign in or order until unblocked.`,
                          )
                        )
                          return;
                        void act(
                          person,
                          () => adminApi.blockUser(person.id, !person.blocked),
                          person.blocked ? "Unblocked." : "Blocked and signed out.",
                        );
                      }}
                    >
                      {person.blocked ? (
                        <>
                          <UserCheck />
                          Unblock
                        </>
                      ) : (
                        <>
                          <Ban />
                          Block
                        </>
                      )}
                    </Button>
                  )}
                  {!self && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === person.id}
                      onClick={() =>
                        void act(
                          person,
                          () => adminApi.signOutUser(person.id),
                          "Signed out on every device.",
                        )
                      }
                    >
                      <LogOut />
                      Sign out everywhere
                    </Button>
                  )}
                  {!locked && (
                    <Button
                      size="sm"
                      variant={person.resetRequestedAt ? "default" : "outline"}
                      disabled={busy === person.id}
                      onClick={() => setSettingPassword(person.id)}
                    >
                      <KeyRound />
                      Set new password
                    </Button>
                  )}
                  {person.resetRequestedAt && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === person.id}
                      onClick={() => void dismiss(person)}
                    >
                      <X />
                      Dismiss request
                    </Button>
                  )}
                  {isCustomer(person) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === person.id}
                      onClick={() => setEditing(person.id)}
                    >
                      <Pencil />
                      Edit details
                    </Button>
                  )}
                  {person.orderCount > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => showOrders({ id: person.id, label: nameOf(person) })}
                    >
                      <ClipboardList />
                      Orders
                    </Button>
                  )}
                  {!locked && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-destructive/60 text-destructive"
                      disabled={busy === person.id}
                      onClick={() => void remove(person)}
                    >
                      <Trash2 />
                      Delete
                    </Button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}

function PasswordSetter({
  save,
  cancel,
}: {
  save: (password: string) => Promise<void>;
  cancel: () => void;
}) {
  const [password, setPassword] = useState(suggestPassword);
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="mt-3 grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (password.trim().length < 8) {
          toast.error("The password needs at least 8 characters.");
          return;
        }
        setSaving(true);
        void save(password.trim()).finally(() => setSaving(false));
      }}
    >
      <p className="text-xs text-muted-foreground">
        A new password (8+ characters). Every device they&apos;re signed in on is signed out.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="New password"
          required
          minLength={8}
          maxLength={128}
          autoComplete="off"
          className="min-w-0 flex-1 basis-40 font-mono"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setPassword(suggestPassword())}
        >
          Suggest another
        </Button>
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={saving}>
          <Save />
          {saving ? "Saving…" : "Save password"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={cancel}>
          <X />
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** After a password is set, or an account made: send it from this phone (the shop sends nothing by
 * itself). Customers get their new password; shopkeepers and admins their number, password and where
 * to sign in. */
function PasswordToGive({
  person,
  password,
  close,
  title = "New password for",
}: {
  person: AdminUser;
  password: string;
  close: () => void;
  title?: string;
}) {
  const staff = !isCustomer(person);
  const mobile = staff ? (person.phone ?? "") : (person.mobile ?? person.profile?.phone ?? "");
  const signIn = person.isAdmin
    ? `${window.location.origin}/admin`
    : `${window.location.origin}/ (the Shopkeeper tab)`;
  const message = staff
    ? `Hi! Your Kannagi Night Mart ${person.isAdmin ? "admin" : "shopkeeper"} sign-in:\nMobile number: ${formatMobile(mobile)}\nPassword: ${password}\nSign in at ${signIn}`
    : `Hi! Your Kannagi Night Mart password has been reset.\nSign in with your mobile number${person.mobile ? ` ${formatMobile(person.mobile)}` : ""} and this new password: ${password}`;
  const whatsapp = whatsappChat(mobile, message);
  const call = callLink(mobile);
  return (
    <section
      role="status"
      aria-label="New password to give"
      className="mt-4 rounded-lg border-2 border-primary bg-accent p-4 text-accent-foreground"
    >
      <p className="text-sm">
        {title} <b className="break-all">{nameOf(person)}</b>:
      </p>
      <p className="mt-1 break-all font-mono text-2xl font-extrabold">{password}</p>
      <p className="mt-1 text-xs">
        {mobile
          ? `Send it on WhatsApp or tell them on a call (${formatMobile(mobile)}).`
          : "There's no mobile number on this account: tell her in person, or add her number with Edit details."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {whatsapp && (
          <Button asChild size="sm">
            <a href={whatsapp} target="_blank" rel="noopener noreferrer">
              <MessageCircle />
              {staff ? "WhatsApp" : "WhatsApp her"}
            </a>
          </Button>
        )}
        {call && (
          <Button asChild size="sm" variant="outline" className="bg-card">
            <a href={call}>
              <Phone />
              {staff ? "Call" : "Call her"}
            </a>
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={close}>
          Done
        </Button>
      </div>
    </section>
  );
}

function ProfileEditor({
  person,
  save,
  cancel,
}: {
  person: AdminUser;
  save: (profile: {
    fullName: string;
    phone: string;
    block: Block;
    roomNumber: string;
  }) => Promise<void>;
  cancel: () => void;
}) {
  const [fullName, setFullName] = useState(person.profile?.fullName ?? "");
  const [phone, setPhone] = useState(person.profile?.phone ?? "");
  const [block, setBlock] = useState<Block>((person.profile?.block as Block | undefined) ?? "A");
  const [roomNumber, setRoomNumber] = useState(person.profile?.roomNumber ?? "");
  return (
    <form
      className="mt-3 grid gap-2 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!isMobile(phone)) {
          toast.error("Enter a 10-digit mobile number.");
          return;
        }
        void save({
          fullName: fullName.trim(),
          phone: phone.trim(),
          block,
          roomNumber: roomNumber.trim(),
        });
      }}
    >
      <Input
        aria-label="Full name"
        required
        maxLength={100}
        placeholder="Full name"
        value={fullName}
        onChange={(event) => setFullName(event.target.value)}
      />
      <Input
        aria-label="Mobile number"
        required
        inputMode="tel"
        maxLength={20}
        placeholder="Mobile number"
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
      />
      <select
        aria-label="Block"
        value={block}
        onChange={(event) => setBlock(event.target.value as Block)}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      >
        <option>A</option>
        <option>B</option>
        <option>C</option>
      </select>
      <Input
        aria-label="Room number"
        required
        maxLength={20}
        placeholder="Room number"
        value={roomNumber}
        onChange={(event) => setRoomNumber(event.target.value)}
      />
      <div className="flex gap-2 sm:col-span-2">
        <Button size="sm">
          <Save />
          Save details
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={cancel}>
          <X />
          Cancel
        </Button>
      </div>
    </form>
  );
}

// --- orders ---

const STATUSES: [AdminOrderStatus, string][] = [
  ["all", "All"],
  ["open", "Open"],
  ["awaiting", "UPI to confirm"],
  ["fulfilled", "Fulfilled"],
  ["cancelled", "Cancelled"],
];

function OrdersTab({
  customer,
  clearCustomer,
}: {
  customer: OrdersOf | null;
  clearCustomer: () => void;
}) {
  const [status, setStatus] = useState<AdminOrderStatus>(customer ? "all" : "open");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  const only = customer ? { userId: customer.id } : {};
  // The newest page stays fresh on its own; older pages load when asked for.
  const [orders, setOrders] = useAdminData<AdminOrder[]>(
    () => adminApi.orders(status, search, only),
    [status, search, customer?.id],
  );
  const [older, setOlder] = useState<AdminOrder[]>([]);
  const [olderFull, setOlderFull] = useState<boolean | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  useEffect(() => {
    setOlder([]);
    setOlderFull(null);
  }, [status, search, customer?.id]);
  // A new order pushes the oldest one off the newest page. With older pages open, that order is
  // neither on the page nor among the older ones: keep it between the two instead of losing it.
  const previousPage = useRef<AdminOrder[] | null>(null);
  useEffect(() => {
    const before = previousPage.current;
    previousPage.current = orders;
    const oldestOnPage = orders?.at(-1)?.id;
    if (!before || oldestOnPage === undefined || older.length === 0) return;
    const pushedOff = before.filter((order) => order.id < oldestOnPage);
    if (pushedOff.length) {
      setOlder((current) => [...pushedOff, ...current.filter((order) => !pushedOff.some((moved) => moved.id === order.id))]);
    }
  }, [orders, older.length]);
  const shown = orders
    ? [...orders, ...older.filter((old) => !orders.some((order) => order.id === old.id))]
    : null;
  const moreToShow = olderFull ?? (orders?.length ?? 0) >= ORDER_PAGE;
  const [busy, setBusy] = useState<number | null>(null);

  async function act(order: AdminOrder, run: () => Promise<AdminOrder>, done?: string) {
    setBusy(order.id);
    try {
      const updated = await run();
      const swap = (list: AdminOrder[]) =>
        list.map((item) => (item.id === updated.id ? updated : item));
      setOrders(swap(orders ?? []));
      setOlder(swap);
      if (done) toast.success(done);
    } catch (error) {
      toast.error(errorText(error, "Could not update the order."));
    } finally {
      setBusy(null);
    }
  }

  async function showOlder() {
    const oldest = shown?.at(-1);
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const page = await adminApi.orders(status, search, { ...only, before: oldest.id });
      setOlder((current) => [...current, ...page]);
      setOlderFull(page.length >= ORDER_PAGE);
    } catch (error) {
      toast.error(errorText(error, "Could not load older orders."));
    } finally {
      setLoadingOlder(false);
    }
  }

  function cancel(order: AdminOrder) {
    const paid = order.payment === "UPI" && (order.paymentConfirmed || order.utr);
    const question = `Cancel order ${orderLabel(order)} (${money(order.total)})? Its items go back on the shelf and it stops counting in sales.${paid ? " She paid by UPI: return the money to her yourself." : ""}`;
    if (!window.confirm(question)) return;
    void act(order, () => adminApi.cancelOrder(order.id), `Order ${orderLabel(order)} cancelled.`);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Show orders" className="flex flex-wrap gap-1">
          {STATUSES.map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={status === value ? "default" : "outline"}
              aria-pressed={status === value}
              onClick={() => setStatus(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <label className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            aria-label="Search all orders"
            className="pl-9"
            placeholder="Order #, name, mobile, room or UTR"
            maxLength={100}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      {customer && (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span>
            Orders of <b className="break-all">{customer.label}</b>
          </span>
          <Button size="sm" variant="ghost" onClick={clearCustomer}>
            <X />
            Show everyone&apos;s
          </Button>
        </p>
      )}
      {!shown && <p className="mt-6 text-muted-foreground">Loading…</p>}
      {shown?.length === 0 && <p className="mt-6 text-muted-foreground">No orders here.</p>}
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown?.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            busy={busy === order.id}
            setFulfilled={(fulfilled) =>
              void act(order, () =>
                fulfilled ? api.admin.fulfillOrder(order.id) : api.admin.unfulfillOrder(order.id),
              )
            }
            setPaymentReceived={(received) =>
              void act(order, () => api.admin.setPaymentReceived(order.id, received))
            }
            cancel={() => cancel(order)}
          />
        ))}
      </div>
      {shown && shown.length > 0 && moreToShow && (
        <div className="mt-4">
          <Button variant="outline" disabled={loadingOlder} onClick={() => void showOlder()}>
            <History />
            {loadingOlder ? "Loading…" : "Show older orders"}
          </Button>
        </div>
      )}
    </>
  );
}

// --- investment ---

const PERIODS: [InvestmentPeriod, string][] = [
  ["today", "Today"],
  ["week", "Last 7 days"],
  ["month", "This month"],
  ["last_month", "Last month"],
  ["all", "All time"],
];
/** 2026-09-01 (a shop date) as 1 Sep 2026. */
const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const changeTime = (ms: number) =>
  new Date(ms).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
const units = (count: number) => `${count} item${count === 1 ? "" : "s"}`;

/** Items with how many and what they cost, biggest first. */
function ValueList({
  label,
  items,
  empty,
}: {
  label: string;
  items: InvestmentItem[];
  empty: string;
}) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul
      aria-label={label}
      className="max-h-96 divide-y divide-border overflow-y-auto rounded-md border border-border"
    >
      {items.map((item) => (
        // A long name and a big amount: the amount goes under the name rather than squeezing it.
        <li
          key={item.name}
          className="flex flex-wrap items-baseline justify-between gap-x-3 p-2 text-sm"
        >
          <span className="min-w-0 grow basis-32 [overflow-wrap:anywhere]">
            {item.emoji ? `${item.emoji} ` : ""}
            <b>{item.name}</b> × {item.qty}
          </span>
          <span className="ml-auto shrink-0 font-bold tabular-nums">{money(item.value)}</span>
        </li>
      ))}
    </ul>
  );
}

function InvestmentTab() {
  const [period, setPeriod] = useState<InvestmentPeriod>("month");
  const [loaded] = useAdminData<Investment>(() => adminApi.investment(period), [period]);
  const data = loaded?.period === period ? loaded : null; // not the last period's figures while a new one loads
  const dates = data
    ? data.start
      ? data.start === data.end
        ? dayLabel(data.start)
        : `${dayLabel(data.start)} – ${dayLabel(data.end)}`
      : `All time, up to ${dayLabel(data.end)}`
    : "";
  // Stock changes are recorded from the first one after this was added: purchases before it aren't here.
  const since = data?.trackingSince;
  const partly =
    since !== undefined &&
    data?.start !== undefined &&
    new Date(`${data.start}T00:00:00`).getTime() < since;
  return (
    <>
      <p className="text-sm text-muted-foreground">
        What went into stock, at MRP (what the shop pays). New stock bought is the stock added on
        the dashboard: a new item&apos;s starting stock, + and typed numbers. Changes to one item by
        the same person within 10 minutes count as one, so a mistake put right at once isn&apos;t
        counted.
      </p>
      <div role="group" aria-label="Period" className="mt-4 flex flex-wrap gap-1">
        {PERIODS.map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            variant={period === value ? "default" : "outline"}
            aria-pressed={period === value}
            onClick={() => setPeriod(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      {!data ? (
        <p className="mt-6 text-muted-foreground">Loading…</p>
      ) : (
        <>
          <p className="mt-3 text-sm font-bold">{dates}</p>
          {since === undefined ? (
            <p className="mt-1 text-xs text-muted-foreground">
              No stock changes recorded yet: new stock counts from the next time stock is added on
              the dashboard.
            </p>
          ) : (
            partly && (
              <p className="mt-1 text-xs text-muted-foreground">
                Stock changes are recorded from {changeTime(since)}; stock bought before then
                isn&apos;t included.
              </p>
            )
          )}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <article
              aria-label="New stock bought"
              className="min-w-0 rounded-lg border-2 border-primary bg-card p-4 shadow-[4px_5px_0_var(--shadow-color)]"
            >
              <h2 className="font-hand text-xl font-bold">New stock bought</h2>
              <p className="[overflow-wrap:anywhere] font-display text-2xl font-extrabold sm:text-3xl text-primary">
                {money(data.bought)}
              </p>
              <p className="text-sm">{units(data.boughtUnits)}, at MRP</p>
            </article>
            <article
              aria-label="Stock left now"
              className="min-w-0 rounded-lg border-2 border-dashed border-primary/30 bg-card p-4"
            >
              <h2 className="font-hand text-xl font-bold">Stock left now</h2>
              <p className="[overflow-wrap:anywhere] font-display text-2xl font-extrabold sm:text-3xl text-primary">
                {money(data.left.value)}
              </p>
              <p className="text-sm">
                {units(data.left.units)} ({data.left.items} kind{data.left.items === 1 ? "" : "s"}),
                at MRP. Worth {money(data.left.saleValue)} at shop prices.
              </p>
            </article>
            <article
              aria-label="Stock taken off"
              className="min-w-0 rounded-lg border-2 border-dashed border-primary/30 bg-card p-4"
            >
              <h2 className="font-hand text-xl font-bold">Stock taken off</h2>
              <p className="[overflow-wrap:anywhere] font-display text-2xl font-extrabold sm:text-3xl">
                {money(data.takenOff)}
              </p>
              <p className="text-sm">
                {units(data.takenOffUnits)} taken off by hand or deleted with their item.
              </p>
            </article>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Stock left is right now, whatever the period. Sales, cancelled orders and undone sales
            change the stock left but aren&apos;t stock bought or taken off. Eggs at shop prices
            count at MRP each (their markup is per order).
          </p>
          <div className="grid grid-cols-1 gap-x-5 lg:grid-cols-2">
            <Section title="Bought in this period">
              <ValueList
                label="Bought in this period"
                items={data.boughtItems}
                empty="No new stock recorded in this period."
              />
            </Section>
            <Section title="Stock left now">
              <ValueList label="Stock left now" items={data.leftItems} empty="Nothing in stock." />
            </Section>
          </div>
          <Section
            title="Stock changes"
            note={
              data.entryCount > data.entries.length
                ? `The latest ${data.entries.length} of ${data.entryCount} in this period.`
                : undefined
            }
          >
            {data.entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stock changes in this period.</p>
            ) : (
              <ul
                aria-label="Stock changes"
                className="max-h-[32rem] divide-y divide-border overflow-y-auto rounded-md border border-border"
              >
                {data.entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 p-2 text-sm"
                  >
                    <span className="min-w-0 grow basis-32 [overflow-wrap:anywhere]">
                      <b className={entry.change > 0 ? "text-primary" : ""}>
                        {entry.change > 0 ? `+${entry.change}` : `−${-entry.change}`}
                      </b>{" "}
                      {entry.name} at {money(entry.price)}
                    </span>
                    <span className="ml-auto shrink-0 font-bold tabular-nums">
                      {entry.change > 0 ? "" : "−"}
                      {money(toRupees(toPaise(entry.price) * Math.abs(entry.change)))}
                    </span>
                    <span className="basis-full text-xs text-muted-foreground">
                      {changeTime(entry.createdAt)}
                      {entry.recordedBy ? ` · by ${formatMobile(entry.recordedBy)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </>
  );
}

// --- profit ---

const DAYS_SHOWN = 31;
const signedMoney = (rupees: number) => (rupees < 0 ? `−${money(-rupees)}` : money(rupees));
/** +₹20, −₹3.50 or ₹0: what a line adds to the profit. */
const changeMoney = (rupees: number) =>
  rupees === 0 ? money(0) : rupees < 0 ? `−${money(-rupees)}` : `+${money(rupees)}`;
const profitColor = (rupees: number) => (rupees < 0 ? "text-destructive" : "text-primary");
const howMany = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;
/** 2026-09-28 as Mon, 28 Sep (with the year when it isn't `year`). */
const weekdayLabel = (day: string, year: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(day.startsWith(year) ? {} : { year: "numeric" }),
  });
/** When each day starts: 12 → "from 12:00 PM to 12:00 PM the next day"; 0 (midnight) needs no words. */
const dayRuns = (startsAt: number) => {
  if (startsAt === 0) return null;
  const hour = hourLabel((startsAt + 24) % 24);
  return startsAt > 0
    ? `from ${hour} to ${hour} the next day`
    : `from ${hour} the day before to ${hour}`;
};
const moneyLine = (figures: Pick<ProfitFigures, "revenue" | "cost" | "gifts">) =>
  `${money(figures.revenue)} in − ${money(figures.cost)} cost${figures.gifts ? ` − ${money(figures.gifts)} gifts` : ""}`;

function FiguresCard({
  label,
  figures,
  noun,
  main,
}: {
  label: string;
  figures: ProfitFigures;
  noun: string;
  main?: boolean;
}) {
  return (
    <article
      aria-label={label}
      className={`min-w-0 rounded-lg border-2 bg-card p-4 ${main ? "border-primary shadow-[4px_5px_0_var(--shadow-color)]" : "border-dashed border-primary/30"}`}
    >
      <h2 className="font-hand text-xl font-bold">{label}</h2>
      <p
        className={`[overflow-wrap:anywhere] font-display text-2xl font-extrabold sm:text-3xl ${profitColor(figures.profit)}`}
      >
        {signedMoney(figures.profit)}
      </p>
      <p className="text-sm [overflow-wrap:anywhere]">
        {howMany(figures.count, noun)}, {howMany(figures.items, "item")}: {moneyLine(figures)}.
      </p>
    </article>
  );
}

/** Items with what they made, most profit first. */
function ProfitList({
  label,
  items,
  empty,
  detail,
}: {
  label: string;
  items: ProfitItem[];
  empty: string;
  detail: (item: ProfitItem) => string;
}) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul
      aria-label={label}
      className="max-h-96 divide-y divide-border overflow-y-auto rounded-md border border-border"
    >
      {items.map((item) => (
        <li
          key={item.name}
          className="flex flex-wrap items-baseline justify-between gap-x-3 p-2 text-sm"
        >
          <span className="min-w-0 grow basis-32 [overflow-wrap:anywhere]">
            {item.emoji ? `${item.emoji} ` : ""}
            <b>{item.name}</b> × {item.qty}
          </span>
          <span className={`ml-auto shrink-0 font-bold tabular-nums ${profitColor(item.profit)}`}>
            {signedMoney(item.profit)}
          </span>
          <span className="basis-full text-xs text-muted-foreground">{detail(item)}</span>
        </li>
      ))}
    </ul>
  );
}

function ProfitTab() {
  const [period, setPeriod] = useState<InvestmentPeriod>("month");
  const [allDays, setAllDays] = useState(false);
  const [loaded] = useAdminData<Profit>(() => adminApi.profit(period), [period]);
  const data = loaded?.period === period ? loaded : null; // not the last period's figures while a new one loads
  const dates = data
    ? data.start
      ? data.start === data.end
        ? dayLabel(data.start)
        : `${dayLabel(data.start)} – ${dayLabel(data.end)}`
      : `All time, up to ${dayLabel(data.end)}`
    : "";
  const runs = data ? dayRuns(data.dayStartsAt) : null;
  const days = data ? (allDays ? data.days : data.days.slice(0, DAYS_SHOWN)) : [];
  const year = data ? data.end.slice(0, 4) : "";
  const stockProfit = data
    ? toRupees(toPaise(data.stock.saleValue) - toPaise(data.stock.value))
    : 0;
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Profit is the money received minus what the items sold cost (their MRP) and the free gifts
        given with orders. Online orders and manual sales both count, UPI orders once their payment
        is confirmed. Cancelled orders and undone manual sales don&apos;t count.
      </p>
      <div role="group" aria-label="Period" className="mt-4 flex flex-wrap gap-1">
        {PERIODS.map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            variant={period === value ? "default" : "outline"}
            aria-pressed={period === value}
            onClick={() => {
              setPeriod(value);
              setAllDays(false);
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      {!data ? (
        <p className="mt-6 text-muted-foreground">Loading…</p>
      ) : (
        <>
          <p className="mt-3 text-sm font-bold">{dates}</p>
          {runs && (
            <p className="mt-1 text-xs text-muted-foreground">
              Each day runs {runs} (halfway through the hours the shop is closed), so a night&apos;s
              sales after midnight count with that night.
            </p>
          )}
          {data.awaiting > 0 && (
            <p className="mt-2 rounded-md border-2 border-dashed border-primary/40 bg-accent p-2 text-sm">
              {howMany(data.awaiting, "UPI order")} ({money(data.awaitingMoney)}) in this period{" "}
              {data.awaiting === 1 ? "is" : "are"} waiting for the payment to be confirmed (Orders).{" "}
              {data.awaiting === 1 ? "It counts" : "They count"} once confirmed.
            </p>
          )}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FiguresCard label="Profit" figures={data.total} noun="sale" main />
            <FiguresCard label="Online orders" figures={data.online} noun="order" />
            <FiguresCard label="Manual sales" figures={data.manual} noun="sale" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Gifts are the free chocolates, free picks (at their MRP) and free snacks the offers give
            with orders. The dashboard&apos;s Summary doesn&apos;t take gifts off, so its profit can
            be a little higher.
          </p>
          <Section
            title="Profit each day"
            note={
              data.days.length > days.length
                ? `The latest ${days.length} of ${data.days.length} days.`
                : "Newest first."
            }
          >
            <ul
              aria-label="Profit each day"
              className="divide-y divide-border rounded-md border border-border"
            >
              {days.map((day) => {
                const sales = [
                  day.orders ? howMany(day.orders, "order") : "",
                  day.manualSales ? howMany(day.manualSales, "manual sale") : "",
                ].filter(Boolean);
                return (
                  <li
                    key={day.day}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 p-2 text-sm"
                  >
                    <span className="min-w-0 grow basis-32 font-bold">
                      {weekdayLabel(day.day, year)}
                    </span>
                    <span
                      className={`ml-auto shrink-0 font-bold tabular-nums ${sales.length ? profitColor(day.profit) : "text-muted-foreground"}`}
                    >
                      {sales.length ? signedMoney(day.profit) : "—"}
                    </span>
                    <span className="basis-full text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {sales.length ? `${sales.join(" + ")} · ${moneyLine(day)}` : "No sales"}
                    </span>
                  </li>
                );
              })}
            </ul>
            {data.days.length > days.length && (
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setAllDays(true)}>
                Show all {data.days.length} days
              </Button>
            )}
          </Section>
          <div className="grid grid-cols-1 gap-x-5 lg:grid-cols-2">
            <Section
              title="Profit on each item"
              note="Each item at the shop's prices (eggs: MRP each plus the markup once per sale), minus its MRP."
            >
              <ProfitList
                label="Profit on each item"
                items={data.items}
                empty="Nothing sold in this period."
                detail={(item) => `sold for ${money(item.revenue)}, cost ${money(item.cost)}`}
              />
              <dl
                aria-label="From the items' profit to the profit"
                className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-sm"
              >
                <dt>Items&apos; profit</dt>
                <dd className="text-right tabular-nums">{signedMoney(data.itemProfit)}</dd>
                <dt>Room delivery fees</dt>
                <dd className="text-right tabular-nums">{changeMoney(data.deliveryFees)}</dd>
                <dt>Discounts (offers, coupons, first orders)</dt>
                <dd className="text-right tabular-nums">{changeMoney(-data.discounts)}</dd>
                <dt>Manual sales for another amount</dt>
                <dd className="text-right tabular-nums">{changeMoney(data.amountChanges)}</dd>
                <dt>Free gifts</dt>
                <dd className="text-right tabular-nums">{changeMoney(-data.total.gifts)}</dd>
                <dt className="border-t border-border pt-1 font-bold">Profit</dt>
                <dd
                  className={`border-t border-border pt-1 text-right font-bold tabular-nums ${profitColor(data.total.profit)}`}
                >
                  {signedMoney(data.total.profit)}
                </dd>
              </dl>
            </Section>
            <Section title="Profit in the stock left" note="Right now, whatever the period.">
              <p className="mb-3 text-sm [overflow-wrap:anywhere]">
                If the {howMany(data.stock.units, "item")} left all sell at the shop&apos;s prices,
                they bring in {money(data.stock.saleValue)} for stock that cost{" "}
                {money(data.stock.value)}:{" "}
                <b className={profitColor(stockProfit)}>{signedMoney(stockProfit)}</b> profit.
              </p>
              <ProfitList
                label="Profit in the stock left"
                items={data.stockItems}
                empty="Nothing in stock."
                detail={(item) => `worth ${money(item.revenue)}, cost ${money(item.cost)}`}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Eggs show no profit here: their markup is added once per sale, however many are
                bought.
              </p>
            </Section>
          </div>
        </>
      )}
    </>
  );
}

// --- access ---

function AccessTab({ me }: { me: User }) {
  const [role, setRole] = useState<StaffRole>("shopkeeper");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState(suggestPassword);
  const [made, setMade] = useState<{ person: AdminUser; password: string } | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [nextAgain, setNextAgain] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      toast.error(errorText(error, "That didn't work."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section
        title="Add a shopkeeper or admin"
        note={
          <>
            They sign in with this mobile number and password: shopkeepers on the Shopkeeper tab of
            the sign-in page, admins here at /admin. The shop sends nothing, so give them the
            password on WhatsApp or a call. Find, block, reset or delete them in People.
          </>
        }
      >
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isMobile(mobile)) {
              toast.error("Enter a 10-digit mobile number.");
              return;
            }
            if (password.trim().length < 8) {
              toast.error("The password needs at least 8 characters.");
              return;
            }
            void run(async () => {
              const person = await adminApi.addStaff(mobile.trim(), password.trim(), role);
              setMade({ person, password: password.trim() });
              setMobile("");
              setPassword(suggestPassword());
              toast.success(role === "admin" ? "Admin added." : "Shopkeeper added.");
            });
          }}
        >
          <div role="group" aria-label="New account is for" className="flex flex-wrap gap-1">
            {(
              [
                ["shopkeeper", "Shopkeeper"],
                ["admin", "Admin"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={role === value ? "default" : "outline"}
                aria-pressed={role === value}
                onClick={() => setRole(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Input
              type="tel"
              inputMode="tel"
              aria-label="New account mobile number"
              placeholder="Their mobile number"
              maxLength={20}
              value={mobile}
              onChange={(event) => setMobile(event.target.value)}
            />
            <Input
              aria-label="New account password"
              autoComplete="off"
              className="font-mono"
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button type="button" variant="ghost" onClick={() => setPassword(suggestPassword())}>
              Suggest another
            </Button>
          </div>
          <Button disabled={busy} className="justify-self-start">
            <UserPlus />
            {role === "admin" ? "Add admin" : "Add shopkeeper"}
          </Button>
        </form>
        {made && (
          <PasswordToGive
            {...made}
            title={
              made.person.isAdmin ? "Sign-in for the new admin" : "Sign-in for the new shopkeeper"
            }
            close={() => setMade(null)}
          />
        )}
      </Section>

      <Section
        title="Your password"
        note={
          me.isOwner
            ? undefined
            : "At least 8 characters. Changing it signs out your other sessions; this one stays signed in."
        }
      >
        {me.isOwner ? (
          <p className="text-sm">
            You&apos;re the main admin: your password is <b>ADMIN_PASSWORD</b> in the server
            settings (the root <code>.env</code> where the API runs, or Render&apos;s Environment
            tab). Change it there; the next start uses it and signs out your old sessions.
          </p>
        ) : (
          <form
            className="grid gap-2 sm:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (next.trim().length < 8) {
                toast.error("The new password needs at least 8 characters.");
                return;
              }
              if (next !== nextAgain) {
                toast.error("The two new passwords don't match.");
                return;
              }
              void run(async () => {
                await adminApi.changePassword(current, next);
                setCurrent("");
                setNext("");
                setNextAgain("");
                toast.success("Password changed. Your other sessions are signed out.");
              });
            }}
          >
            <Input
              type="password"
              autoComplete="current-password"
              aria-label="Current admin password"
              placeholder="Current password"
              maxLength={128}
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
            <Input
              type="password"
              autoComplete="new-password"
              aria-label="New admin password"
              placeholder="New password"
              maxLength={128}
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
            <Input
              type="password"
              autoComplete="new-password"
              aria-label="New admin password again"
              placeholder="New password again"
              maxLength={128}
              value={nextAgain}
              onChange={(event) => setNextAgain(event.target.value)}
            />
            <Button disabled={busy} className="sm:col-span-3 sm:justify-self-start">
              <ShieldCheck />
              Change password
            </Button>
          </form>
        )}
      </Section>
    </>
  );
}
