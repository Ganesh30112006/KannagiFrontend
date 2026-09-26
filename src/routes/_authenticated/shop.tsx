import { createFileRoute } from "@tanstack/react-router";

import { ShopPage } from "@/components/shop-page";
import type { User } from "@/lib/mart-types";

export const Route = createFileRoute("/_authenticated/shop")({
  head: () => ({
    meta: [
      { title: "Kannagi Night Mart | Hostel Snacks" },
      {
        name: "description",
        content:
          "Shop affordable late-night snacks at Kannagi Hostel with midnight offers, spin-and-win coupons and UPI payment.",
      },
      { property: "og:title", content: "Kannagi Night Mart | Hostel Snacks" },
      {
        property: "og:description",
        content:
          "Midnight cravings, affordable snacks, pickup and room delivery for Kannagi Hostel.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ShopRoute,
});

function ShopRoute() {
  // AuthGate (route.tsx) renders this only for a signed-in user.
  const { user } = Route.useRouteContext();
  return <ShopPage user={user as User} />;
}
