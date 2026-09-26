import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { api } from "@/lib/api";
import type { User } from "@/lib/mart-types";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  // The session lives in an HttpOnly cookie; me() returns null when signed out or expired.
  beforeLoad: async (): Promise<{ user: User | null }> => ({ user: await api.me() }),
  component: AuthGate,
});

// Redirecting from beforeLoad runs during hydration and causes a hydration mismatch,
// so signed-out visitors get an empty first render and are sent to sign-in afterwards.
function AuthGate() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  useEffect(() => {
    if (!user) void navigate({ to: "/", replace: true });
  }, [navigate, user]);
  return user ? <Outlet /> : null;
}

