/**
 * What each role may do, per module.
 *
 * This is documentation of the guards that are actually in place, kept beside
 * them so the Settings page cannot drift into describing a system that does
 * not exist. It is deliberately READ-ONLY: the routes enforce access with
 * `authorize(...)` at the module level, so making this editable would mean
 * every guard consulting the database on every request. That is a
 * security-critical change and needs its own design pass, not a checkbox.
 */

export type Ability = {
  action: string;
  owner: boolean;
  supervisor: boolean;
  sales: boolean;
  /** Anything the role check alone does not tell you. */
  note?: string;
};

export type PermissionModule = {
  module: string;
  abilities: Ability[];
};

export const PERMISSION_MATRIX: PermissionModule[] = [
  {
    module: "Inventory",
    abilities: [
      {
        action: "View stock",
        owner: true,
        supervisor: true,
        sales: true,
        note: "Non-owners see only their own branch",
      },
      { action: "Add stock", owner: true, supervisor: false, sales: false },
      { action: "Correct a balance", owner: true, supervisor: false, sales: false },
      { action: "Delete a stock row", owner: true, supervisor: false, sales: false },
    ],
  },
  {
    module: "Sales",
    abilities: [
      {
        action: "View sales",
        owner: true,
        supervisor: true,
        sales: true,
        note: "Sales see their own, Supervisors their branch",
      },
      { action: "Record a sale", owner: false, supervisor: false, sales: true },
      { action: "Submit for approval", owner: false, supervisor: false, sales: true },
      { action: "Approve or reject", owner: true, supervisor: true, sales: false },
    ],
  },
  {
    module: "Stock requests",
    abilities: [
      { action: "View requests", owner: true, supervisor: true, sales: false },
      { action: "Raise a request", owner: false, supervisor: true, sales: false },
      {
        action: "Approve or reject",
        owner: true,
        supervisor: false,
        sales: false,
        note: "Approving names the source branch and creates the transfer",
      },
      { action: "Cancel a pending request", owner: true, supervisor: true, sales: false },
    ],
  },
  {
    module: "Cash reports",
    abilities: [
      { action: "View reports", owner: true, supervisor: true, sales: true },
      { action: "Reconcile a period", owner: false, supervisor: false, sales: true },
      { action: "Approve or reject", owner: true, supervisor: true, sales: false },
      { action: "Send to the Owner", owner: false, supervisor: true, sales: false },
    ],
  },
  {
    module: "Bank receipts",
    abilities: [
      { action: "View receipts", owner: true, supervisor: true, sales: true },
      { action: "Upload a slip", owner: false, supervisor: true, sales: true },
      { action: "Verify or reject", owner: true, supervisor: true, sales: false },
    ],
  },
  {
    module: "Branches",
    abilities: [
      { action: "View branches", owner: true, supervisor: true, sales: true },
      { action: "Create or rename", owner: true, supervisor: false, sales: false },
      { action: "Open, close or delete", owner: true, supervisor: false, sales: false },
      { action: "Set the stock source", owner: true, supervisor: false, sales: false },
    ],
  },
  {
    module: "Users",
    abilities: [
      { action: "View staff", owner: true, supervisor: true, sales: false },
      { action: "Add or edit a user", owner: true, supervisor: false, sales: false },
      { action: "Move between branches", owner: true, supervisor: false, sales: false },
      {
        action: "Edit own profile and password",
        owner: true,
        supervisor: true,
        sales: true,
        note: "Role, branch and active status are ignored, so nobody can promote themselves",
      },
    ],
  },
  {
    module: "Reports and settings",
    abilities: [
      { action: "View reports", owner: true, supervisor: true, sales: true },
      { action: "Read settings", owner: true, supervisor: true, sales: true },
      { action: "Change settings", owner: true, supervisor: false, sales: false },
      { action: "Back up or restore", owner: true, supervisor: false, sales: false },
    ],
  },
];
