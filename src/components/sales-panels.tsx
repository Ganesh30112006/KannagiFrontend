// The shopkeeper dashboard's Manual sale and Summary pages (on /dashboard, and in /admin's Shop & dashboard).
import { Minus, Plus, Search, TrendingUp, Undo2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { ManualPayment, ManualSale, Product, SalesFigures, SalesSummary } from "@/lib/mart-types";
import { formatMobile } from "@/lib/phone";
import { cartSummary, isEggProduct, lineTotal, money, salePrice, toPaise, toRupees } from "@/lib/pricing";
import { priceRules, useSite } from "@/lib/site";

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const saleTime = (ms: number) => new Date(ms).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
/** ₹15, or −₹5 when a sale brought in less than the items cost. */
const signedMoney = (rupees: number) => (rupees < 0 ? `−${money(-rupees)}` : money(rupees));
const profit = (figures: Pick<SalesFigures, "revenue" | "investment">) => toRupees(toPaise(figures.revenue) - toPaise(figures.investment));
const MAX_QTY = 1000; // per item in one sale, as the API allows

/** An amount received typed in rupees (₹0 allowed: a giveaway), or null if it isn't one. */
function parseAmount(value: string): number | null {
  const text = value.trim();
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text);
  return amount <= 100_000 ? amount : null;
}

/** −, a box to type the number into, + (for picking quantities; nothing is saved until the sale is recorded).
 * Taps are steps applied to the latest count, so quick repeated taps all count. */
function QtyStepper({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (update: (count: number) => number) => void }) {
  return (
    <div className="grid grid-cols-[2.25rem_2.75rem_2.25rem] items-center gap-1">
      <Button type="button" size="icon" variant="outline" aria-label={`${label}: one less`} disabled={value === 0} onClick={() => onChange((count) => count - 1)}><Minus /></Button>
      <Input
        type="text"
        inputMode="numeric"
        aria-label={`${label} quantity`}
        placeholder="0"
        value={value ? String(value) : ""}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "").slice(0, 4);
          onChange(() => (digits ? Number(digits) : 0));
        }}
        className="h-9 px-1 text-center font-bold"
      />
      <Button type="button" size="icon" variant="outline" aria-label={`${label}: one more`} disabled={value >= max} onClick={() => onChange((count) => count + 1)}><Plus /></Button>
    </div>
  );
}

/** Enter a sale made in person (at the shop's room, outside the website): its items come off the stock and it
 * counts in the Summary. Below it, the latest manual sales, each of which can be undone. */
export function ManualSalePanel({ products, sales, onRecorded, onUndone }: { products: Product[]; sales: ManualSale[]; onRecorded: (sale: ManualSale, taken: Record<number, number>) => void; onUndone: (sale: ManualSale) => void }) {
  const site = useSite();
  const rules = priceRules(site);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState<string | null>(null); // null (or empty): the shop's prices
  const [payment, setPayment] = useState<ManualPayment>("Cash");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [undoing, setUndoing] = useState<number | null>(null);

  const lines = products.filter((product) => (qty[product.id] ?? 0) > 0).map((product) => ({ product, qty: qty[product.id] ?? 0 }));
  const shopTotal = toRupees(cartSummary(lines, rules).subtotal);
  const itemCount = lines.reduce((sum, line) => sum + line.qty, 0);
  const typedAmount = amount !== null && amount.trim() !== "";
  const received = typedAmount ? parseAmount(amount) : shopTotal;
  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => !query || product.name.toLowerCase().includes(query)).sort((a, b) => a.name.localeCompare(b.name));
  }, [products, search]);

  function setCount(product: Product, update: (count: number) => number) {
    setQty((current) => {
      const wanted = update(current[product.id] ?? 0);
      const count = Math.max(0, Math.min(wanted, product.stock, MAX_QTY));
      if (wanted > product.stock) toast.error(`Only ${product.stock} ${product.name} in stock. If there are more, correct the stock on the Dashboard first.`, { id: `stock-${product.id}` });
      const copy = { ...current };
      if (count) copy[product.id] = count;
      else delete copy[product.id];
      return copy;
    });
  }

  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (lines.length === 0) { toast.error("Choose what was sold first."); return; }
    if (received === null) { toast.error("Enter the amount received in rupees, like 50 or 49.50 (or clear it for the shop's prices)."); return; }
    setSaving(true);
    try {
      const sale = await api.admin.recordManualSale({
        items: lines.map((line) => ({ productId: line.product.id, quantity: line.qty })),
        payment,
        ...(typedAmount ? { amount: received } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast.success(`Sale #${sale.id} recorded: ${money(sale.total)}. Stock updated.`);
      onRecorded(sale, Object.fromEntries(lines.map((line) => [line.product.id, line.qty])));
      // Every sale starts afresh, Cash included, so one paid by UPI can't carry over to the next.
      setQty({});
      setAmount(null);
      setPayment("Cash");
      setNote("");
      setSearch("");
    } catch (error) {
      toast.error(errorText(error, "Could not record the sale."));
    } finally {
      setSaving(false);
    }
  }

  async function undo(sale: ManualSale) {
    if (!window.confirm(`Undo sale #${sale.id} (${money(sale.total)})? Its items go back into stock and it stops counting in sales.`)) return;
    setUndoing(sale.id);
    try {
      onUndone(await api.admin.undoManualSale(sale.id));
      toast.success(`Sale #${sale.id} undone. Its items are back in stock.`);
    } catch (error) {
      toast.error(errorText(error, "Could not undo the sale."));
    } finally {
      setUndoing(null);
    }
  }

  return (
    <div className="mt-5 grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
      <form onSubmit={record} aria-label="Manual sale" className="min-w-0 border-2 border-dashed border-primary/35 bg-card p-4 shadow-[4px_5px_0_var(--shadow-color)]">
        <h3 className="font-hand text-2xl font-bold">Record a manual sale</h3>
        <p className="text-sm text-muted-foreground">For sales made in person, outside the website. The items come off the stock and the sale counts in the Summary.</p>
        <label className="relative mt-3 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" className="pl-9" placeholder="Find an item" aria-label="Find an item" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <ul aria-label="Items" className="mt-3 max-h-[26rem] divide-y divide-border overflow-y-auto rounded-md border border-border">
          {shown.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">{products.length ? "No item matches your search." : "No items in the shop yet: add them on the Dashboard."}</li>}
          {shown.map((product) => (
            <li key={product.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 p-2">
              <div className="min-w-0">
                <p className="font-bold leading-tight [overflow-wrap:anywhere]">{product.emoji} {product.name}</p>
                <p className="text-xs text-muted-foreground">{money(salePrice(product, rules))}{isEggProduct(product) ? ` each + ₹${rules.markup} per bundle` : ""} · {product.stock ? `${product.stock} in stock` : "Out of stock"}</p>
              </div>
              <QtyStepper label={product.name} value={qty[product.id] ?? 0} max={product.stock} onChange={(update) => setCount(product, update)} />
            </li>
          ))}
        </ul>

        <div aria-label="This sale" aria-live="polite" className="mt-4 rounded-md bg-product p-3 text-sm">
          {lines.length === 0 ? (
            <p className="text-muted-foreground">Nothing chosen yet.</p>
          ) : (
            <ul className="space-y-1">
              {lines.map((line) => (
                <li key={line.product.id} className="flex justify-between gap-2"><span className="min-w-0 truncate">{line.product.name} ×{line.qty}</span><span>{money(toRupees(lineTotal(line.product, line.qty, rules)))}</span></li>
              ))}
            </ul>
          )}
          <p className="mt-2 flex justify-between gap-2 border-t border-foreground/10 pt-2 font-bold"><span>{plural(itemCount, "item")} at shop prices</span><span>{money(shopTotal)}</span></p>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="grid content-start gap-1 text-xs font-bold">
            Amount received (₹)
            <Input inputMode="decimal" aria-label="Amount received" placeholder="Shop prices" maxLength={9} value={amount ?? (lines.length ? String(shopTotal) : "")} onChange={(event) => setAmount(event.target.value)} />
            {typedAmount && received !== shopTotal && (
              <button type="button" className="justify-self-start text-xs font-normal underline" onClick={() => setAmount(null)}>Use shop prices ({money(shopTotal)})</button>
            )}
          </label>
          <div className="grid content-start gap-1 text-xs font-bold">
            Paid by
            <div role="group" aria-label="Paid by" className="grid grid-cols-2 gap-1">
              {(["Cash", "UPI"] as const).map((option) => (
                <Button key={option} type="button" variant={payment === option ? "default" : "outline"} aria-pressed={payment === option} className="h-10" onClick={() => setPayment(option)}>{option}</Button>
              ))}
            </div>
          </div>
        </div>
        <label className="mt-3 grid gap-1 text-xs font-bold">
          Note (optional)
          <Input maxLength={100} aria-label="Sale note" placeholder="e.g. Block B, Room 204" value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <Button type="submit" disabled={saving || lines.length === 0} className="mt-4 h-auto min-h-11 w-full whitespace-normal">
          {saving ? "Recording…" : lines.length ? `Record sale · ${received === null ? "check the amount" : money(received)}` : "Record sale"}
        </Button>
      </form>

      <section aria-labelledby="manual-sales-title" className="min-w-0">
        <h3 id="manual-sales-title" className="font-hand text-2xl font-bold">Recent manual sales</h3>
        {sales.length === 0 && <p className="mt-3 border-2 border-dashed border-border bg-card p-6 text-center text-muted-foreground">No manual sales yet.</p>}
        <ul className="mt-3 space-y-3">
          {sales.map((sale) => (
            <li key={sale.id}>
              <article aria-label={`Manual sale #${sale.id}`} className={`border-2 bg-card p-3 ${sale.cancelled ? "border-dashed border-border opacity-60" : "border-foreground/10 shadow-[3px_4px_0_var(--shadow-color)]"}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="font-bold">Sale #{sale.id} · {money(sale.total)}{sale.cancelled && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">Undone</span>}</p>
                  <p className="text-xs text-muted-foreground">{saleTime(sale.createdAt)} · {sale.payment}</p>
                </div>
                <p className="mt-1 [overflow-wrap:anywhere] text-sm">{sale.items.map((item) => `${item.name} ×${item.qty}`).join(", ")}</p>
                <p className="[overflow-wrap:anywhere] text-xs text-muted-foreground">Profit {signedMoney(profit({ revenue: sale.total, investment: sale.investment }))}{sale.note ? ` · ${sale.note}` : ""}{sale.recordedBy ? ` · by ${formatMobile(sale.recordedBy)}` : ""}</p>
                {!sale.cancelled && (
                  <Button variant="outline" size="sm" className="mt-2" disabled={undoing === sale.id} onClick={() => void undo(sale)}><Undo2 /> {undoing === sale.id ? "Undoing…" : "Undo sale"}</Button>
                )}
              </article>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const NO_SALES: SalesFigures = { count: 0, items: 0, revenue: 0, investment: 0 };

/** Online sales, manual sales and both together: how many, items, money in, cost and profit (all time). */
export function SalesSummaryPanel({ summary }: { summary: SalesSummary | null }) {
  // An API from before manual sales sends only the combined figures (briefly, while a deploy finishes).
  const online = summary?.online ?? (summary ? { ...NO_SALES, revenue: summary.revenue, investment: summary.investment } : NO_SALES);
  const manual = summary?.manual ?? NO_SALES;
  const total: SalesFigures = {
    count: online.count + manual.count,
    items: online.items + manual.items,
    revenue: toRupees(toPaise(online.revenue) + toPaise(manual.revenue)),
    investment: toRupees(toPaise(online.investment) + toPaise(manual.investment)),
  };
  const cards: [string, string, SalesFigures][] = [
    ["Online sales", "Orders placed on the website", online],
    ["Manual sales", "Sold in person", manual],
    ["Total sales", "Online + manual", total],
  ];
  return (
    <section aria-labelledby="summary-title" className="mt-5">
      <div className="flex items-center gap-2"><TrendingUp className="size-7 text-primary" /><h3 id="summary-title" className="font-hand text-3xl font-bold">Sales summary</h3></div>
      {!summary && <p className="mt-3 text-sm text-muted-foreground">Loading the figures…</p>}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {cards.map(([title, note, figures], index) => (
          <article key={title} aria-label={title} className={`min-w-0 rounded-md border-2 p-4 ${index === 2 ? "border-primary bg-card shadow-[4px_5px_0_var(--shadow-color)]" : "border-dashed border-primary/30 bg-card"}`}>
            <h4 className="font-hand text-xl font-bold">{title}</h4>
            <p className="text-xs text-muted-foreground">{note}</p>
            <p className="mt-2 [overflow-wrap:anywhere] font-display text-3xl font-extrabold text-primary">{money(figures.revenue)}</p>
            <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
              <dt>Sales</dt><dd className="text-right font-bold">{figures.count}</dd>
              <dt>Items sold</dt><dd className="text-right font-bold">{figures.items}</dd>
              <dt>Cost (MRP)</dt><dd className="text-right font-bold">{money(figures.investment)}</dd>
              <dt>Profit</dt><dd className="text-right font-bold text-primary">{signedMoney(profit(figures))}</dd>
            </dl>
          </article>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">All time. UPI orders count once you confirm their payment. Cancelled orders and undone manual sales don&apos;t count. Profit is the money received minus what the items cost (their MRP).</p>
    </section>
  );
}
