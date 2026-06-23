// PRD §3.1 permission matrix. Pure + framework-free so it can gate both server actions and UI.
export type Role = "superadmin" | "admin" | "user";

export type Capability =
  | "manageUsers"
  | "manageSettings"
  | "manageBackups"
  | "downloadBackups"
  | "createBookings"
  | "deleteBookings"
  | "createExpenses"
  | "deleteExpenses"
  | "reimburseExpenses"
  | "managePartnersCash"
  | "maintenanceTasks"
  | "viewTotals"
  | "viewOwnCommission"
  | "viewNetResults"
  | "viewPartnerStatements"
  | "exportData"
  | "viewAuditLog";

const ALL: Role[] = ["superadmin", "admin", "user"];
const ADMINS: Role[] = ["superadmin", "admin"];
const SUPER: Role[] = ["superadmin"];

const MATRIX: Record<Capability, Role[]> = {
  manageUsers: SUPER,
  manageSettings: SUPER, // admin has "limited" settings in the PRD; model that distinction if/when needed
  manageBackups: SUPER,
  downloadBackups: ADMINS,
  createBookings: ALL,
  deleteBookings: ADMINS,
  createExpenses: ALL,
  deleteExpenses: ADMINS,
  reimburseExpenses: ADMINS, // EX-9: admin reimburses a co-host's out-of-pocket expense
  managePartnersCash: ADMINS,
  maintenanceTasks: ALL,
  viewTotals: ALL,
  viewOwnCommission: ALL,
  viewNetResults: ADMINS, // co-host (user) is hidden from net owner results
  viewPartnerStatements: ADMINS,
  exportData: ALL, // co-host export is "limited" — scope the data in the export feature, not here
  viewAuditLog: ADMINS,
};

export const can = (role: Role, capability: Capability) => MATRIX[capability].includes(role);

/**
 * Starting currency for a new booking/expense, by who's entering. The local manager (admin)
 * works in pesos so they default to ARS; the owner abroad and the co-host default to EUR.
 * Only the *initial* field value — the stored money is unchanged (EUR derives from the FX snapshot).
 */
export const defaultEntryCurrency = (role: Role): "ARS" | "EUR" =>
  role === "admin" ? "ARS" : "EUR";

/**
 * EX-9: may this actor reimburse a co-host's out-of-pocket expense? The authoritative actor-side
 * rule, previously split — the capability lived in the route's RPC gate, the owner (partner-mapping)
 * check in `markExpenseReimbursed`. Unifying them here keeps the UI button, the RPC gate and the db
 * guard reading one truth. The expense-side ("is it a pending co-host expense?") stays in
 * `reimbursementStatus`; both must hold for a reimbursement to go through.
 */
export const mayReimburse = (actor: { role: Role; partnerId: number | null }): boolean =>
  can(actor.role, "reimburseExpenses") && actor.partnerId != null;

/**
 * Guard for editing a user's role/status. Returns a reason to reject, or null if allowed.
 * Prevents an admin from locking themselves/everyone out:
 *  - no editing your own role/status (anti self-lockout)
 *  - never demote or disable the last active superadmin
 */
export function userEditError(
  me: { id: number; role: Role },
  target: { id: number; role: Role },
  next: { role: Role; status: "active" | "disabled" },
  activeSuperadmins: number,
): "self" | "last_superadmin" | null {
  if (target.id === me.id) return "self";
  const removesSuperadmin =
    target.role === "superadmin" && (next.role !== "superadmin" || next.status !== "active");
  if (removesSuperadmin && activeSuperadmins <= 1) return "last_superadmin";
  return null;
}
