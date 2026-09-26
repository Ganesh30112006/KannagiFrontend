import { createFileRoute } from "@tanstack/react-router";

import { ShopPage } from "@/components/shop-page";
import type { User } from "@/lib/mart-types";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Shopkeeper Dashboard | Kannagi Night Mart" },
      {
        name: "description",
        content: "Manage Kannagi Night Mart orders, inventory, alerts and sales analytics.",
      },
      { property: "og:title", content: "Shopkeeper Dashboard | Kannagi Night Mart" },
      {
        property: "og:description",
        content: "Kannagi Night Mart shopkeeper operations dashboard.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  // AuthGate (route.tsx) renders this only for a signed-in user.
  const { user } = Route.useRouteContext();
  return <ShopPage user={user as User} initialMode="admin" />;
}
