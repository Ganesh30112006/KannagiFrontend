// Server functions for the site admin's /admin page only (kept apart so no other page's code
// mentions them). The backend answers 404 to anyone without an admin session.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type {
  AdminOrder,
  AdminOverview,
  AdminUser,
  Investment,
  Profit,
  Result,
  SiteAdminSettings,
  User,
} from "./mart-types";

const server = () => import("./backend.server");
/** Orders per page on the Orders tab; "Show older orders" loads the next page. */
export const ORDER_PAGE = 100;

const text = (max: number) => z.string().trim().min(1).max(max);
const block = z.enum(["A", "B", "C"]);
const id = z.object({ id: z.number().int().positive() });

/** The signed-in site admin, or null (signed out, expired, or not an admin session). */
export const adminMe = createServerFn({ method: "POST" }).handler(
  async (): Promise<Result<User | null>> => {
    const { callBackend, hasSession } = await server();
    if (!hasSession()) return { ok: true, data: null };
    const result = await callBackend<User>("/auth/me");
    if (!result.ok && result.status === 401) return { ok: true, data: null };
    if (result.ok && !result.data.isAdmin) return { ok: true, data: null };
    return result;
  },
);

const mobile = z.string().trim().min(10).max(20);

/** Signs in to /admin with an admin's mobile number and password. The session lasts 12 hours. */
export const adminLogin = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z.object({ phone: mobile, password: z.string().min(1).max(128) }).parse(data),
  )
  .handler(async ({ data }): Promise<Result<User>> => {
    const { callBackend, startSession } = await server();
    const result = await callBackend<{ token: string; user: User }>(
      "/auth/admin-login",
      "POST",
      data,
    );
    if (!result.ok) return result;
    startSession(result.data.token);
    return { ok: true, data: result.data.user };
  });

const siteSettings = z.object({
  upiId: z.string().trim().min(3).max(130),
  upiName: text(60),
  // What the shop's uploaded UPI QR says (upi://pay?pa=...); null removes it. The API checks the rest.
  upiQr: z
    .string()
    .trim()
    .max(1000)
    .regex(/^upi:\/\/pay\?\S+$/i)
    .nullable()
    .optional(),
  shopPhone: mobile,
  helpPhone: mobile,
  pickupPoint: text(80),
  openHour: z.number().int().min(0).max(23),
  closeHour: z.number().int().min(0).max(23),
  upiEnabled: z.boolean(),
  cashEnabled: z.boolean(),
  pickupEnabled: z.boolean(),
  roomDeliveryEnabled: z.boolean(),
  deliveryFee: z.number().int().min(0).max(100),
  markup: z.number().int().min(0).max(100),
  signupsOpen: z.boolean(),
});
const userId = z.object({ userId: z.string().min(1).max(36) });
const search = z.string().trim().max(100);
const userPath = (id: string, action: string) =>
  `/site-admin/users/${encodeURIComponent(id)}/${action}`;

export const adminOverview = createServerFn({ method: "POST" }).handler(async () =>
  (await server()).callBackend<AdminOverview>("/site-admin/overview"),
);
/** New stock bought and taken off in a period, and the stock left now. */
export const adminInvestment = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z.object({ period: z.enum(["today", "week", "month", "last_month", "all"]) }).parse(data),
  )
  .handler(async ({ data }) =>
    (await server()).callBackend<Investment>(
      `/site-admin/investment?${new URLSearchParams({ period: data.period })}`,
    ),
  );
/** Profit in a period, day by day and item by item, and the profit in the stock left. */
export const adminProfit = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z.object({ period: z.enum(["today", "week", "month", "last_month", "all"]) }).parse(data),
  )
  .handler(async ({ data }) =>
    (await server()).callBackend<Profit>(
      `/site-admin/profit?${new URLSearchParams({ period: data.period })}`,
    ),
  );
export const adminSettings = createServerFn({ method: "POST" }).handler(async () =>
  (await server()).callBackend<SiteAdminSettings>("/site-admin/settings"),
);

export const saveAdminSettings = createServerFn({ method: "POST" })
  .validator((data: unknown) => siteSettings.parse(data))
  .handler(async ({ data }) =>
    (await server()).callBackend<SiteAdminSettings>("/site-admin/settings", "PUT", data),
  );

/** A new shopkeeper or admin, who signs in with this mobile number and password. */
export const createStaff = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        phone: mobile,
        password: z.string().trim().min(8).max(128),
        role: z.enum(["shopkeeper", "admin"]),
      })
      .parse(data),
  )
  .handler(async ({ data }) =>
    (await server()).callBackend<AdminUser>("/site-admin/staff", "POST", data),
  );

/** The signed-in admin's own password. Signs out their other sessions; this browser gets a new sign-in. */
export const changeAdminPassword = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z.object({ current: z.string().trim().min(1).max(128), new: z.string().trim().min(8).max(128) }).parse(data),
  )
  .handler(async ({ data }): Promise<Result<User>> => {
    const { callBackend, startSession } = await server();
    const result = await callBackend<{ token: string; user: User }>(
      "/site-admin/me/password",
      "PUT",
      data,
    );
    if (!result.ok) return result;
    startSession(result.data.token);
    return { ok: true, data: result.data.user };
  });

export const adminUsers = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        role: z.enum(["all", "customers", "shopkeepers", "admins", "blocked", "resets"]),
        q: search,
      })
      .parse(data),
  )
  .handler(async ({ data }) =>
    (await server()).callBackend<AdminUser[]>(
      `/site-admin/users?${new URLSearchParams({ role: data.role, q: data.q })}`,
    ),
  );

export const blockUser = createServerFn({ method: "POST" })
  .validator((data: unknown) => userId.extend({ blocked: z.boolean() }).parse(data))
  .handler(async ({ data }) =>
    (await server()).callBackend<AdminUser>(userPath(data.userId, "block"), "POST", {
      blocked: data.blocked,
    }),
  );

export const signOutUser = createServerFn({ method: "POST" })
  .validator((data: unknown) => userId.parse(data))
  .handler(async ({ data }) =>
    (await server()).callBackend<AdminUser>(userPath(data.userId, "sign-out"), "POST"),
  );

/** A new password for a customer who forgot hers, a shopkeeper or another admin; the admin tells them (the shop sends nothing). */
export const setUserPassword = createServerFn({ method: "POST" })
  .validator((data: unknown) => userId.extend({ password: z.string().trim().min(8).max(128) }).parse(data))
  .handler(async ({ data }) =>
    (await server()).callBackend<AdminUser>(userPath(data.userId, "password"), "PUT", {
      password: data.password,
    }),
  );

export const dismissResetRequest = createServerFn({ method: "POST" })
  .validator((data: unknown) => userId.parse(data))
  .handler(async ({ data }) =>
    (await server()).callBackend<null>(userPath(data.userId, "reset-request"), "DELETE"),
  );

export const editUserProfile = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    userId
      .extend({
        profile: z.object({ fullName: text(100), phone: text(20), block, roomNumber: text(20) }),
      })
      .parse(data),
  )
  .handler(async ({ data }) =>
    (await server()).callBackend<AdminUser>(userPath(data.userId, "profile"), "PUT", data.profile),
  );

/** Deletes a customer, shopkeeper or admin. Their past orders stay in Orders. */
export const deleteUser = createServerFn({ method: "POST" })
  .validator((data: unknown) => userId.parse(data))
  .handler(async ({ data }) =>
    (await server()).callBackend<null>(
      `/site-admin/users/${encodeURIComponent(data.userId)}`,
      "DELETE",
    ),
  );

/** Every order ever, newest first: `before` pages back to older orders, `userId` shows one account's. */
export const adminAllOrders = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        status: z.enum(["all", "open", "awaiting", "fulfilled", "cancelled"]),
        q: search,
        before: z.number().int().positive().optional(),
        userId: z.string().min(1).max(36).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const query = new URLSearchParams({
      status: data.status,
      q: data.q,
      limit: String(ORDER_PAGE),
    });
    if (data.before) query.set("before", String(data.before));
    if (data.userId) query.set("user", data.userId);
    return (await server()).callBackend<AdminOrder[]>(`/site-admin/orders?${query}`);
  });

export const cancelOrder = createServerFn({ method: "POST" })
  .validator((data: unknown) => id.parse(data))
  .handler(async ({ data }) =>
    (await server()).callBackend<AdminOrder>(`/site-admin/orders/${data.id}/cancel`, "POST"),
  );
