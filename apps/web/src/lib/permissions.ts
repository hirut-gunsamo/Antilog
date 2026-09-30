import type { TranslationKey } from './i18n'

/**
 * The permission grid is generated on the server from the same source as the
 * route guards, so its labels arrive as English sentences rather than keys.
 * Rather than teach the API about languages — which would make a security
 * table depend on a display concern — the client looks each label up here.
 *
 * A miss falls back to the server's own wording, so a new ability shows up
 * untranslated instead of blank.
 */
const TEXT: Record<string, TranslationKey> = {
  // Modules
  Inventory: 'perm.modInventory',
  Sales: 'perm.modSales',
  'Stock requests': 'perm.modStockRequests',
  'Cash reports': 'perm.modCashReports',
  'Bank receipts': 'perm.modBankReceipts',
  Branches: 'perm.modBranches',
  Users: 'perm.modUsers',
  'Reports and settings': 'perm.modReportsSettings',

  // Abilities
  'View stock': 'perm.aViewStock',
  'Add stock': 'perm.aAddStock',
  'Correct a balance': 'perm.aCorrectBalance',
  'Delete a stock row': 'perm.aDeleteStockRow',
  'View sales': 'perm.aViewSales',
  'Record a sale': 'perm.aRecordSale',
  'Submit for approval': 'perm.aSubmitApproval',
  'Approve or reject': 'perm.aApproveReject',
  'View requests': 'perm.aViewRequests',
  'Raise a request': 'perm.aRaiseRequest',
  'Cancel a pending request': 'perm.aCancelPending',
  'View reports': 'perm.aViewReports',
  'Reconcile a period': 'perm.aReconcile',
  'Send to the Owner': 'perm.aSendToOwner',
  'View receipts': 'perm.aViewReceipts',
  'Upload a slip': 'perm.aUploadSlip',
  'Verify or reject': 'perm.aVerifyReject',
  'View branches': 'perm.aViewBranches',
  'Create or rename': 'perm.aCreateRename',
  'Open, close or delete': 'perm.aOpenCloseDelete',
  'Set the stock source': 'perm.aSetStockSource',
  'View staff': 'perm.aViewStaff',
  'Add or edit a user': 'perm.aAddEditUser',
  'Move between branches': 'perm.aMoveBranches',
  'Edit own profile and password': 'perm.aEditOwnProfile',
  'Read settings': 'perm.aReadSettings',
  'Change settings': 'perm.aChangeSettings',
  'Back up or restore': 'perm.aBackupRestore',

  // Notes
  'Non-owners see only their own branch': 'perm.nOwnBranchOnly',
  'Sales see their own, Supervisors their branch': 'perm.nSalesSeeOwn',
  'Approving names the source branch and creates the transfer':
    'perm.nApprovingNames',
  'Role, branch and active status are ignored, so nobody can promote themselves':
    'perm.nSelfEditIgnores',
}

/** Translate one label from the permission endpoint, or pass it through. */
export function permissionText(
  t: (key: TranslationKey) => string,
  label: string,
) {
  const key = TEXT[label]
  return key ? t(key) : label
}
