// Browser-side client for the site admin's /admin page (see admin.functions.ts).
import * as fn from "./admin.functions";
import { change, unwrap } from "./api";
import type {
  AdminOrderStatus,
  AdminUserRole,
  CustomerProfile,
  InvestmentPeriod,
  SiteSettings,
  StaffRole,
} from "./mart-types";

export { ORDER_PAGE } from "./admin.functions";

export const adminApi = {
  /** The signed-in site admin, or null. */
  me: () => unwrap(fn.adminMe()),
  login: (phone: string, password: string) => unwrap(fn.adminLogin({ data: { phone, password } })),
  overview: () => unwrap(fn.adminOverview()),
  investment: (period: InvestmentPeriod) => unwrap(fn.adminInvestment({ data: { period } })),
  profit: (period: InvestmentPeriod) => unwrap(fn.adminProfit({ data: { period } })),
  settings: () => unwrap(fn.adminSettings()),
  saveSettings: (settings: SiteSettings) => change(() => fn.saveAdminSettings({ data: settings })),
  addStaff: (phone: string, password: string, role: StaffRole) =>
    change(() => fn.createStaff({ data: { phone, password, role } })),
  changePassword: (current: string, next: string) =>
    unwrap(fn.changeAdminPassword({ data: { current, new: next } })),
  users: (role: AdminUserRole, q: string) => unwrap(fn.adminUsers({ data: { role, q } })),
  blockUser: (userId: string, blocked: boolean) =>
    change(() => fn.blockUser({ data: { userId, blocked } })),
  signOutUser: (userId: string) => change(() => fn.signOutUser({ data: { userId } })),
  setPassword: (userId: string, password: string) =>
    change(() => fn.setUserPassword({ data: { userId, password } })),
  dismissResetRequest: (userId: string) =>
    change(() => fn.dismissResetRequest({ data: { userId } })),
  editProfile: (userId: string, profile: CustomerProfile) =>
    change(() => fn.editUserProfile({ data: { userId, profile } })),
  deleteUser: (userId: string) => change(() => fn.deleteUser({ data: { userId } })),
  orders: (status: AdminOrderStatus, q: string, more: { before?: number; userId?: string } = {}) =>
    unwrap(fn.adminAllOrders({ data: { status, q, ...more } })),
  cancelOrder: (id: number) => change(() => fn.cancelOrder({ data: { id } })),
};
