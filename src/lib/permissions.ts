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
