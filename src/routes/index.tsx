import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Heart, KeyRound, LayoutDashboard, LockKeyhole, LogIn, LogOut, ShoppingBag, Store } from "lucide-react";
import { toast, Toaster } from "sonner";

import cozySnackGirl from "@/assets/cozy-snack-girl.webp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { User } from "@/lib/mart-types";
import { ROLE_KEY } from "@/lib/login-role";
import { formatMobile, isMobile } from "@/lib/phone";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Sign in | Kannagi Night Mart" },
    { name: "description", content: "Sign in to order midnight snacks and view your Kannagi Night Mart order history." },
    { property: "og:title", content: "Sign in | Kannagi Night Mart" },
    { property: "og:description", content: "Your midnight snack account for Kannagi Hostel." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: AuthPage,
});

type Role = "customer" | "shopkeeper";
function savedRole(): Role {
  try { return localStorage.getItem(ROLE_KEY) === "shopkeeper" ? "shopkeeper" : "customer"; } catch { return "customer"; }
}

function AuthPage() {
  const navigate = useNavigate();
  const [role, setRole] = useState<Role>("customer");
  const [password, setPassword] = useState("");
  const [mobile, setMobile] = useState("");
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const signup = mode === "signup";
  const keeper = role === "shopkeeper";
  const [busy, setBusy] = useState(false);
  // Who is already signed in on this device. Never opened automatically: the page says who it is
  // and lets them continue or sign out. The form stays disabled until this check finishes.
  const [session, setSession] = useState<User | null | "checking">("checking");
  useEffect(() => {
    setRole(savedRole());
    api.me().then(setSession, () => setSession(null));
  }, []);

  async function signOut() {
    setBusy(true);
    try { await api.logout(); } catch { /* the session cookie is cleared either way */ }
    setSession(null);
    setBusy(false);
  }

  function chooseRole(next: Role) {
    setRole(next);
    if (next === "shopkeeper") setMode("signin");
    try { localStorage.setItem(ROLE_KEY, next); } catch { /* private window: just don't remember */ }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Everyone signs in with a mobile number.
    if (!isMobile(mobile)) { toast.error("Enter your 10-digit mobile number."); return; }
    setBusy(true);
    try {
      if (mode === "forgot") {
        toast.success((await api.forgotPassword(mobile)).message, { duration: 8000 });
        setMode("signin");
        return;
      }
      if (keeper) {
        await api.shopkeeperLogin(mobile, password);
        await navigate({ to: "/dashboard", replace: true });
        return;
      }
      await (signup ? api.signup(mobile, password) : api.login(mobile, password));
      await navigate({ to: "/shop", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  const tab = (value: Role, label: string, Icon: typeof Store) => <Button type="button" variant={role === value ? "default" : "ghost"} aria-pressed={role === value} onClick={() => chooseRole(value)} className="h-auto min-h-10 min-w-0 whitespace-normal px-2 [&_svg]:hidden sm:[&_svg]:block"><Icon />{label}</Button>;

  return <main className="night-sky grid min-h-screen place-items-center p-4 text-foreground">
    <section className="grid w-full max-w-4xl overflow-hidden rounded-lg border-4 border-primary bg-card shadow-[9px_10px_0_var(--shadow-color)] md:grid-cols-[.9fr_1.1fr]">
      <div className="hidden bg-banner p-6 md:block"><img src={cozySnackGirl} alt="Girl enjoying snacks during a cozy hostel night" width={800} height={800} loading="lazy" decoding="async" className="h-full w-full rounded-md object-cover" /></div>
      <div className="min-w-0 p-4 sm:p-10"><Heart className="size-9 fill-secondary text-secondary" /><p className="mt-3 font-hand text-xl font-bold text-primary">By Girls ♡ For Girls</p><h1 className="font-display text-4xl font-extrabold">Kannagi Night Mart</h1><p className="mt-2 text-sm text-muted-foreground">{session !== "checking" && session !== null ? "Welcome back!" : keeper ?"Shopkeeper sign in: manage orders, stock and offers." : "Sign in to order and keep every receipt safely in your account."}</p>
        {session !== "checking" && session !== null ? <div className="mt-5 space-y-3" role="status">
          <p className="rounded-md border border-border bg-background p-3 text-sm">You&apos;re signed in as <b className="break-all">{session.phone ? formatMobile(session.phone) : session.mobile ? formatMobile(session.mobile) : (session.email ?? "your account")}</b>{session.isShopkeeper ? " (shopkeeper)" : ""}.</p>
          {session.isShopkeeper && <Button className="h-auto min-h-12 w-full whitespace-normal" onClick={() => void navigate({ to: "/dashboard" })}><LayoutDashboard />Open dashboard</Button>}
          {!session.isShopkeeper && <Button className="h-auto min-h-12 w-full whitespace-normal" onClick={() => void navigate({ to: "/shop" })}><ShoppingBag />Go to the shop</Button>}
          <Button variant="ghost" disabled={busy} className="h-auto min-h-10 w-full whitespace-normal" onClick={() => void signOut()}><LogOut />Sign out to use another account</Button>
        </div> : <fieldset disabled={session === "checking"} aria-busy={session === "checking"} className="min-w-0 disabled:opacity-60">
        <div role="group" aria-label="Sign in as" className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-1 rounded-md border border-border bg-background p-1">{tab("customer", "Customer", ShoppingBag)}{tab("shopkeeper", "Shopkeeper", Store)}</div>
        {keeper ? <form onSubmit={submit} className="mt-4 space-y-3">
          <Input type="tel" inputMode="tel" autoComplete="tel-national" required maxLength={20} placeholder="Mobile number" aria-label="Mobile number" value={mobile} onChange={(e) => setMobile(e.target.value)} />
          <Input type="password" autoComplete="current-password" required maxLength={128} placeholder="Password" aria-label="Shopkeeper password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="text-xs text-muted-foreground">Sign in with your mobile number and the password the admin gave you.</p>
          <Button disabled={busy} className="h-auto min-h-12 w-full whitespace-normal"><LayoutDashboard />{busy ? "Please wait…" : "Open dashboard"}</Button>
        </form> : <>
          <form onSubmit={submit} className="mt-4 space-y-3">
            <Input type="tel" inputMode="tel" autoComplete="tel-national" required maxLength={20} placeholder="Mobile number" aria-label="Mobile number" value={mobile} onChange={(e) => setMobile(e.target.value)} />
            {mode === "forgot" ? <p className="text-sm text-muted-foreground">Forgot your password? Send a request to the shop. They&apos;ll set a new password for you and send it to this mobile number.</p> : <Input type="password" autoComplete={signup ? "new-password" : "current-password"} minLength={8} maxLength={128} required placeholder={signup ? "Choose a password" : "Password"} aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} />}
            {signup && <p className="text-xs text-muted-foreground">Use 8 or more characters. You sign in with your mobile number and this password. The shop also uses your number to reach you, for example with a new password if you forget yours. We never send messages or codes.</p>}
            <Button disabled={busy} className="h-auto min-h-12 w-full whitespace-normal">{mode === "forgot" ? <KeyRound /> : <LogIn />}{busy ? "Please wait…" : mode === "forgot" ? "Send request to the shop" : signup ? "Create account" : "Sign in"}</Button>
          </form>
          {mode === "signin" && <Button variant="link" onClick={() => setMode("forgot")} className="mt-1 h-auto min-h-10 w-full whitespace-normal text-muted-foreground">Forgot password?</Button>}
          <Button variant="ghost" onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="mt-2 h-auto min-h-10 w-full whitespace-normal"><LockKeyhole />{mode === "signin" ? "New customer? Create account" : "Back to sign in"}</Button>
        </>}
        </fieldset>}
      </div>
    </section><Toaster position="top-center" richColors />
  </main>;
}
