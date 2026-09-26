import { createFileRoute } from "@tanstack/react-router";

import { AdminConsole, AdminSignIn } from "@/components/admin-console";
import { adminApi } from "@/lib/admin-api";
import type { User } from "@/lib/mart-types";

// The site admin's console. Nothing links here; without an admin session it shows only a password box.
export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({
    // The page title is set by the console itself, so the site's route list carries no wording of it.
    meta: [{ name: "robots", content: "noindex, nofollow" }],
  }),
  beforeLoad: async (): Promise<{ user: User | null }> => ({
    user: await adminApi.me().catch(() => null),
  }),
  component: AdminRoute,
});

function AdminRoute() {
  const { user } = Route.useRouteContext();
  return user ? <AdminConsole user={user} /> : <AdminSignIn />;
}
