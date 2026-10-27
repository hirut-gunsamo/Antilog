export type Role = 'OWNER' | 'SUPERVISOR' | 'SALES'

export type Branch = {
  id: string
  name: string
  isMainStock: boolean
  isActive: boolean
}

export type CurrentUser = {
  id: string
  name: string
  email: string
  phone?: string | null
  role: Role
  isActive: boolean
  branchId: string | null
  branch: Branch | null
  supervisor: { id: string; name: string; email: string } | null
}

export type CategoryTotals = Record<
  string,
  { quantity: number; revenue: number }
>

export type PeriodSummary = {
  revenue: number
  cashReceived: number
  transactions: number
  byCategory: CategoryTotals
}

export type TrendBucket = {
  key: string
  label: string
  revenue: number
  cashReceived: number
  transactions: number
  byCategory: CategoryTotals
}

export type BranchPerformance = {
  id: string
  name: string
  revenue: number
  transactions: number
}

/** Per-branch trading. "customers" counts completed purchases, not people. */

export type BranchActivity = {
  id: string
  name: string
  customers: number
  revenue: number
  units: number
  staff: number
}

export type StockBranch = {
  id: string
  name: string
  totalUnits: number
  stockValue: number
  byCategory: CategoryTotals
}

export type CashRow = {
  id: string
  name: string
  branch: string | null
  sold: number
  /** Cash this seller handed to their supervisor. */
  handedOver: number
  /** Cash this supervisor took in from their team. */
  collected: number
  banked: number
  inHand: number
}

/** One person in the branch and what they are still holding right now. */
export type TeamCashRow = {
  id: string
  name: string
  branch?: string | null
  inHand: number
}

export type Tile = {
  value: number
  changePct: number
}

export type DayBucket = {
  key: string
  label: string
  revenue: number
}

/** One row of the dashboard's activity feed. Facts only; the card words it. */
export type Activity = {
  id: string
  kind: 'SALE' | 'STOCK_IN' | 'TRANSFER' | 'REQUEST' | 'ADJUSTMENT' | 'LOSS' | 'OTHER'
  at: string
  branch: string | null
  by: string | null
  product?: string
  /** Signed for corrections: negative left the branch, positive arrived. */
  quantity?: number
  /** A sale's total. */
  amount?: number
  /** Units in a sale or a stock request. */
  units?: number
  /** A request's status, or the movement type for OTHER. */
  status?: string
  from?: string | null
  to?: string | null
  /** The person's own words: why stock was corrected or written off. */
  note?: string | null
  /** A correction's balance before and after. */
  before?: number
  after?: number
  /** A write-off's cause, or REVERSED when the write-off was rejected. */
  cause?: 'DAMAGED' | 'LOST' | 'REVERSED'
}

export type Dashboard = {
  today: PeriodSummary
  thisWeek: PeriodSummary
  thisMonth: PeriodSummary
  thisYear: PeriodSummary
  lastMonth: PeriodSummary

  tiles: {
    simCards: Tile
    phones: Tile
    vouchers: Tile
    cashReceived: Tile
  }

  last7Days: {
    buckets: DayBucket[]
    totalSales: number
    itemsSold: number
    transactions: number
  }

  inventoryByCategory: {
    SIM_CARD: number
    PHONE: number
    AIRTIME_VOUCHER: number
    total: number
  }

  recentActivity: Activity[]

  topProducts: {
    id: string
    sku: string
    name: string
    category: string
    price: number
    units: number
    revenue: number
    sharePct: number
  }[]
  topProductsWindow: 'today' | 'month'

  lowStock: {
    id: string
    sku: string
    name: string
    category: string
    branch: string
    quantity: number
    threshold: number
  }[]

  recentSales: {
    id: string
    status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'
    saleDate: string
    total: number
    salesperson: string
    branch: string
    units: number
    summary: string
    category: string
  }[]

  branchActivity: BranchActivity[]


  /** The same shape over four windows, for the branch table's range selector. */
  branchActivityByRange: {
    today: BranchActivity[]
    last7: BranchActivity[]
    month: BranchActivity[]
    year: BranchActivity[]
  }

  monthlyTrend: TrendBucket[]
  branchPerformance: BranchPerformance[]
  stock: {
    totals: { totalUnits: number; stockValue: number }
    branches: StockBranch[]
  }
  cashPosition: {
    salespeople: CashRow[]
    totals: {
      sold: number
      handedOver: number
      collected: number
      banked: number
      inHand: number
    }
  }
}

/* ---------------------------------------------------------------------------
   Inventory
   --------------------------------------------------------------------------- */

export type InventoryLocation = {
  id: string
  name: string
  isMainStock: boolean
  isActive: boolean
}

export type InventoryProduct = {
  id: string
  sku: string
  name: string
  category: string
  /** Prisma serialises Decimal as a string, so this is not a number. */
  price?: string | number
  status?: string
  /** The Owner's category, where the endpoint includes it. */
  categoryId?: string | null
  voucherDetails?: { denomination: string | number } | null
  /** The Owner's type; for a phone, its parent is the brand. */
  type?: {
    id: string
    name: string
    parentId: string | null
    parent: { id: string; name: string } | null
  } | null
}

/** One product's quantity at one branch. */
export type InventoryBalance = {
  id: string
  locationId: string
  productId: string
  /** Everything the branch answers for, including what salespeople hold. */
  quantity: number
  /** Issued to salespeople and not yet sold. */
  withSellers: number
  /** Left on the shelf to issue or send: quantity less withSellers. */
  onShelf: number
  /** A salesperson's own row: what they received, sold and handed back. */
  mine?: { received: number; sold: number; returned: number }
  updatedAt: string
  product: InventoryProduct
  location: InventoryLocation
}

/** A serialised unit as the loss picker lists it. */
export type ReportableUnit = {
  id: string
  iccid: string | null
  imei: string | null
  simNumber: string | null
  serialNumber: string | null
}

/* ---------------------------------------------------------------------------
   National ID printing — a service the branch performs, not stock it holds
   --------------------------------------------------------------------------- */

export type NationalIdRecord = {
  id: string
  date: string
  originalCount: number
  copyCount: number
  /** The rates in force when it was recorded, not today's. */
  originalRate: string
  copyRate: string
  revenue: string
  notes: string | null
  createdAt: string
  location: { id: string; name: string }
  recordedBy: {
    id: string
    name: string
    role: string
    branch: { id: string; name: string } | null
  }
}

/** Blank ID card stock at one branch. Remaining is derived, never stored. */
export type NationalIdBlankBalance = {
  locationId: string
  name: string
  originalReceived: number
  copyReceived: number
  originalPrinted: number
  copyPrinted: number
  originalRemaining: number
  copyRemaining: number
  /** False until the branch has logged its first arrival. */
  tracked: boolean
}

export type NationalIdBlankEntry = {
  id: string
  originalAdded: number
  copyAdded: number
  note: string | null
  createdAt: string
  location: { id: string; name: string }
  receivedBy: { id: string; name: string; role: string }
}

export type NationalIdTotals = {
  original: number
  copy: number
  total: number
  revenue: number
}

export type NationalIdSummary = {
  from: string
  to: string
  range: string
  totals: NationalIdTotals
  today: NationalIdTotals
  week: NationalIdTotals
  month: NationalIdTotals
  byBranch: (NationalIdTotals & { locationId: string; name: string })[]
  trend: { date: string; original: number; copy: number }[]
}

export type AssetCategory =
  | 'ELECTRONICS'
  | 'FURNITURE'
  | 'STATIONERY'
  | 'OTHER'

export type AssetStatus = 'IN_USE' | 'DAMAGED' | 'RETIRED'

/** One delivery of office equipment to a branch. Never sold, never issued. */
export type OfficeAsset = {
  id: string
  name: string
  category: AssetCategory
  status: AssetStatus
  quantity: number
  serialNumber: string | null
  /** Prisma serialises Decimal as a string; null when the cost is unknown. */
  cost: string | null
  receivedAt: string
  note: string | null
  createdAt: string
  location: { id: string; name: string }
  recordedBy: { id: string; name: string; role: string }
}

export type StockLossKind = 'DAMAGED' | 'LOST'
export type StockLossStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

/** A write-off: stock that left without being sold. */
export type StockLossReport = {
  id: string
  kind: StockLossKind
  status: StockLossStatus
  quantity: number
  reason: string
  rejectionReason: string | null
  reviewedAt: string | null
  createdAt: string
  product: InventoryProduct
  location: { id: string; name: string }
  reportedBy: {
    id: string
    name: string
    role: string
    branch: { id: string; name: string } | null
  }
  reviewedBy: { id: string; name: string; role: string } | null
  units: ReportableUnit[]
}

export type InventorySummary = {
  byCategory: { SIM_CARD: number; AIRTIME_VOUCHER: number; PHONE: number }
  /** On the shelf; what salespeople hold is in withSellers. */
  totalUnits: number
  withSellers: number
  items: InventoryBalance[]
}

/** A serialised SIM or phone: one physical thing with its own identifier. */
export type InventoryUnit = {
  id: string
  productId: string
  locationId: string
  status: string
  serialNumber: string | null
  simNumber: string | null
  iccid: string | null
  imei: string | null
  createdAt: string
  product: Pick<InventoryProduct, 'id' | 'sku' | 'name' | 'category'>
  location: InventoryLocation
}

export type StockMovement = {
  id: string
  productId: string
  quantity: number
  type: string
  notes: string | null
  createdAt: string
  product: Pick<InventoryProduct, 'id' | 'sku' | 'name' | 'category'>
  fromLocation: InventoryLocation | null
  toLocation: InventoryLocation | null
  createdBy: { id: string; name: string; role: string } | null
}

export type CatalogueProduct = InventoryProduct & {
  description: string | null
  price: string
  status: string
}

export type ProductStatus = 'ACTIVE' | 'INACTIVE'

/** A node in the catalogue's type tree: a brand, a model, a voucher type. */
export type TypeNode = {
  id: string
  category: string
  categoryId: string | null
  parentId: string | null
  name: string
  isActive: boolean
  children: TypeNode[]
}

/**
 * A catalogue entry as the Products page reads it: the shared fields, the one
 * detail block its category carries, and what every branch holds of it.
 *
 * Exactly one of the three detail blocks is filled; the others are null. The
 * database keeps them in separate tables because a voucher's denomination and
 * a phone's IMEI have nothing to say to each other.
 */
export type ProductRow = {
  id: string
  sku: string
  name: string
  category: string
  description: string | null
  /** Prisma serialises Decimal as a string. */
  price: string
  /** What the business pays for one. Sent to the Owner only. */
  costPrice?: string | null
  /** The Owner only: branches selling it at a price of their own. */
  branchPrices?: { branchId: string; name: string; price: string }[]
  status: ProductStatus
  createdAt: string
  simDetails: { network: string | null } | null
  voucherDetails: { denomination: string } | null
  phoneDetails: {
    brand: string
    model: string
    storage: string | null
    color: string | null
  } | null
  inventoryBalances: { quantity: number; locationId: string }[]
  /** The deepest type chosen when it was created — a model, a brand, a voucher kind. */
  type: { id: string; name: string; parentId: string | null } | null
  categoryId: string | null
  /** The Owner's category; `category` is its kind. */
  productCategory: { id: string; name: string; kind: CategoryKind } | null
}

/* ---------------------------------------------------------------------------
   Branches

   The model is still called StockLocation in the database; "branch" is the
   name it goes by everywhere else.
   --------------------------------------------------------------------------- */

export type BranchRow = {
  id: string
  name: string
  type: string
  /** Can act as a stock source for other branches. Several may be set. */
  isMainStock: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
  /** The one active SUPERVISOR for this branch, if it has one. */
  supervisor: { id: string; name: string; email: string } | null
  counts: { users: number; products: number; unitsSold: number }
}

/* ---------------------------------------------------------------------------
   Sales
   --------------------------------------------------------------------------- */

export type SaleStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'

export type SaleItem = {
  id: string
  quantity: number
  /** Decimal from Prisma, so a string. */
  unitPrice: string
  lineTotal: string
  product: { id: string; sku: string; name: string; category: string }
  inventoryUnits: {
    id: string
    iccid: string | null
    imei: string | null
    serialNumber: string | null
  }[]
}

export type Sale = {
  id: string
  status: SaleStatus
  subtotal: string
  totalAmount: string
  cashReceived: string
  paymentMethod: 'CASH' | 'TRANSFER' | 'MIXED'
  bankName: string | null
  transferReceived: string
  notes: string | null
  rejectionReason?: string | null
  saleDate: string
  submittedAt: string | null
  approvedAt: string | null
  createdAt: string
  /** After its day, a sale can be changed only until this moment (Owner's leave). */
  editAllowedUntil?: string | null
  /** When it was last corrected. */
  editedAt?: string | null
  /** The salesperson asked the Owner to let them correct it. */
  editRequestedAt?: string | null
  salesperson: { id: string; name: string; role: string }
  approvedBy: { id: string; name: string; role: string } | null
  location: { id: string; name: string }
  items: SaleItem[]
  /** SIM transfers done in this sale, at the Owner's fixed price. */
  simTransfers?: { id: string; quantity: number; price: string }[]
  /** A payment correction waiting for the Owner. */
  payFixRequestedAt?: string | null
  payFixMethod?: 'CASH' | 'TRANSFER' | 'MIXED' | null
  payFixCash?: string | null
  payFixTransfer?: string | null
  payFixBank?: string | null
  /** Bills paid through the sale: WiFi, electricity, water... */
  billPayments?: { id: string; billType: string; account: string | null; amount: string }[]
}

/* ---------------------------------------------------------------------------
   Stock requests

   A supervisor asks the Owner to restock their branch. The Owner approves and
   names the branch the stock ships from, which creates a transfer.
   --------------------------------------------------------------------------- */

export type RequestStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'FULFILLED'
  | 'CANCELLED'

export type StockRequestKind = 'RESTOCK' | 'ISSUE' | 'RETURN'

/** What one salesperson took out today, sold, and is still answerable for. */
export type Holding = {
  id: string
  name: string
  branch: { id: string; name: string } | null
  items: {
    productId: string
    /** Null if the product left the catalogue after it was issued. */
    product: { id: string; sku: string; name: string; category: string } | null
    issuedToday: number
    soldToday: number
    remaining: number
  }[]
  totals: { issuedToday: number; soldToday: number; remaining: number }
}

export type StockRequest = {
  id: string
  kind: StockRequestKind
  status: RequestStatus
  notes: string | null
  leftOnHand: string | null
  rejectionReason: string | null
  submittedAt: string | null
  reviewedAt: string | null
  fulfilledAt: string | null
  /** A salesperson's issue: when they confirmed it was in their hands. */
  receivedAt?: string | null
  receivedBy?: { id: string; name: string } | null
  createdAt: string
  requestedBy: {
    id: string
    name: string
    role: string
    branch: { id: string; name: string } | null
  }
  requestedTo: { id: string; name: string; role: string; branch?: { id: string; name: string } | null } | null
  approvedBy: { id: string; name: string; role: string } | null
  items: {
    id: string
    /** Units asked for. */
    quantity: number
    /** Units the reviewer agreed to send (0..quantity); null until approved. */
    approvedQuantity: number | null
    /** A salesperson's issue: when they received this line. */
    receivedAt?: string | null
    /** SIM cards handed to a salesperson: the ICCID range given. */
    iccidFrom?: string | null
    iccidTo?: string | null
    product: {
      id: string
      sku: string
      name: string
      category: string
      /** The Owner's category; the request is decided one category at a time. */
      productCategory?: { id: string; name: string } | null
    }
  }[]
  transfer: {
    id: string
    status: string
    /** Named by the Owner on approval; null on transfers made before that. */
    driverName: string | null
    driverPhone: string | null
    vehiclePlate: string | null
    shippedAt: string | null
    receivedAt: string | null
    fromLocation: { id: string; name: string } | null
    toLocation: { id: string; name: string } | null
  } | null
}

/* ---------------------------------------------------------------------------
   Cash reports and bank receipts
   --------------------------------------------------------------------------- */

export type CashReport = {
  id: string
  status: string
  periodStart: string
  periodEnd: string
  expectedCash: string
  actualCash: string
  variance: string
  notes: string | null
  rejectionReason: string | null
  submittedAt: string | null
  approvedAt: string | null
  sentToOwnerAt: string | null
  createdAt: string
  salesperson: {
    id: string
    name: string
    branch: { id: string; name: string } | null
  }
  approvedBy: { id: string; name: string; role: string } | null
  sales: {
    id: string
    saleDate: string
    totalAmount: string
    cashReceived: string
    status: string
  }[]
}

export type BankReceipt = {
  /** Reopened by the Owner for 24 hours after it was checked. */
  editAllowedUntil?: string | null
  editRequestedAt?: string | null
  id: string
  bankName: string | null
  referenceNumber: string | null
  /** Null when the bankers credited the account with no slip. */
  fileUrl: string | null
  amount: string
  /** The branch's sales that day, and what was left uncredited after this. */
  daySales: string | null
  yadere: string | null
  location: { id: string; name: string } | null
  receiptDate: string
  status: 'PENDING' | 'VERIFIED' | 'REJECTED'
  notes: string | null
  createdAt: string
  uploadedBy: {
    id: string
    name: string
    role: string
    branch: { id: string; name: string } | null
  }
  verifiedBy: { id: string; name: string; role: string } | null
  cashReport: { id: string } | null
}

/* ---------------------------------------------------------------------------
   System users

   OWNER is org-wide and has no branch. SUPERVISOR and SALES always belong to
   exactly one branch, and Postgres enforces one active supervisor per branch.
   --------------------------------------------------------------------------- */

export type AppUser = {
  id: string
  name: string
  email: string
  /** Null for users created before the column existed. */
  phone: string | null
  role: Role
  isActive: boolean
  branchId: string | null
  createdAt: string
  updatedAt: string
  branch: { id: string; name: string } | null
  /** Derived for SALES: the active supervisor of the same branch. */
  supervisor: { id: string; name: string; email: string } | null
}

/* ---------------------------------------------------------------------------
   Reports
   --------------------------------------------------------------------------- */

export type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly'

export type CategoryFigures = Record<
  string,
  { quantity: number; revenue: number }
>

export type SalesBucket = {
  key: string
  label: string
  revenue: number
  cashReceived: number
  transactions: number
  byCategory: CategoryFigures
}

export type SalesReport = {
  period: ReportPeriod
  from: string | null
  to: string | null
  summary: {
    revenue: number
    cashReceived: number
    transactions: number
    byCategory: CategoryFigures
  }
  buckets: SalesBucket[]
  byBranch: {
    id: string
    name: string
    revenue: number
    cashReceived: number
    transactions: number
    byCategory: CategoryFigures
  }[]
  /** The same figures per salesperson, with their branch. */
  bySalesperson: {
    id: string
    name: string
    branch: string
    revenue: number
    cashReceived: number
    transactions: number
    byCategory: CategoryFigures
  }[]
  byItem: {
    id: string
    sku: string
    name: string
    category: string
    categoryName: string | null
    quantity: number
    revenue: number
    branches: Record<string, { quantity: number; revenue: number }>
  }[]
  /** Newest day first; each branch that sold that day, keyed by branch id. */
  dailyByBranch: {
    day: string
    branches: Record<string, { revenue: number; byCategory: CategoryFigures }>
  }[]
}

export type CashPositionReport = {
  from: string | null
  to: string | null
  salespeople: {
    id: string
    name: string
    branch: string
    /** Cash held from before the first day: yadere, brought forward. */
    opening: number
    sold: number
    /** National ID and Telebirr money taken in cash. */
    other: number
    handedOver: number
    collected: number
    banked: number
    /** Expenses paid from their cash. */
    expenses: number
    /** Money lost; also taken off their salary. */
    deductions: number
    /** Still held on the last day: keri, which opens the next day. */
    inHand: number
  }[]
  totals: {
    opening: number
    sold: number
    other: number
    handedOver: number
    collected: number
    banked: number
    expenses: number
    deductions: number
    inHand: number
  }
  /** One row per day; null unless both ends of the range were given. */
  days:
    | {
        date: string
        opening: number
        collected: number
        /** Expenses and deductions. */
        spent: number
        deposited: number
        closing: number
      }[]
    | null
}

/** Money credited to each bank, person by person. */
export type BankReport = {
  banks: {
    bank: string
    people: { id: string; name: string; branch: string | null; deposits: number; transfers: number; total: number }[]
    deposits: number
    transfers: number
    total: number
  }[]
  totals: { deposits: number; transfers: number; total: number }
}

export type InventoryReport = {
  branches: {
    id: string
    name: string
    byCategory: CategoryFigures
    totalUnits: number
    stockValue: number
    items: {
      sku: string
      name: string
      category: string
      categoryName: string | null
      quantity: number
      value: number
    }[]
  }[]
}

/* ---------------------------------------------------------------------------
   Organisation settings
   --------------------------------------------------------------------------- */

export type DateFormat = 'medium' | 'short' | 'iso' | 'long'
export type TimeFormat = '24h' | '12h'

export type AppSettings = {
  id: string
  systemName: string
  defaultLanguage: string
  currency: string
  dateFormat: DateFormat
  timeFormat: TimeFormat
  itemsPerPage: number
  /** Warn a seller to ask for more when their holding falls to these. */
  lowHoldingSim: number
  lowHoldingPhone: number
  lowHoldingVoucher: number
  /** Decimal strings: what a branch charges per National ID print. */
  nationalIdOriginalRate: string
  nationalIdCopyRate: string
  /** The fixed price of a SIM transfer. */
  simTransferPrice: string
  notifySales: boolean
  notifyRequests: boolean
  notifyApprovals: boolean
  notifyLowStock: boolean
  notifySystem: boolean
  updatedAt: string
  updatedById: string | null
  updatedBy: { id: string; name: string; role: string } | null
}

export type PermissionAbility = {
  action: string
  owner: boolean
  supervisor: boolean
  sales: boolean
  note?: string
}

export type PermissionModule = {
  module: string
  abilities: PermissionAbility[]
}

/* ---------------------------------------------------------------------------
   Notifications
   --------------------------------------------------------------------------- */

export type NotificationKind =
  | 'REQUESTS_TO_DECIDE'
  | 'MY_STOCK_LOW'
  | 'ITEMS_TO_ISSUE'
  | 'RETURNS_TO_CONFIRM'
  | 'SALES_TO_APPROVE'
  | 'REPORTS_TO_APPROVE'
  | 'RECEIPTS_TO_VERIFY'
  | 'LOSSES_TO_REVIEW'
  | 'EDITS_TO_ALLOW'
  | 'MY_DRAFTS'
  | 'MY_REJECTED'
  | 'MY_REQUEST_APPROVED'
  | 'MY_REQUEST_REJECTED'
  | 'DELIVERIES_TO_RECEIVE'
  | 'ISSUES_TO_RECEIVE'
  | 'TRANSFERS_DONE'
  | 'EXPENSES_ADDED'
  | 'NID_TO_FORWARD'
  | 'NID_TO_PRINT'
  | 'NID_RETURNED'
  | 'LOW_STOCK'
  | 'LOW_BLANKS'

export type Notification = {
  kind: NotificationKind
  count: number
  /** "action" needs a decision from this person; "warn" is a heads-up. */
  tone: 'action' | 'warn'
  href: string
  sample: string[]
  /** When the newest item of this kind arrived, and who sent it. */
  latest?: { at: string; by: string }
}

export type Notifications = {
  notifications: Notification[]
  actionCount: number
  total: number
}

/* ---------------------------------------------------------------------------
   Ibid (digital airtime held as a birr balance)
   --------------------------------------------------------------------------- */

export type IbidSummary = {
  values: number[]
  /** The chosen branch's live balance; for the Owner with none chosen, all of them. */
  balance: string
  /** Every branch's own balance. Owner only; empty for anyone else. */
  balances: { id: string; name: string; balance: number }[]
  loadedInPeriod: number
  printedInPeriod: number
  printedToday: number
  byBranch: {
    branchId: string
    name: string
    total: number
    cards: number
    values: Record<string, { amount: number; cards: number }>
  }[]
  entries: {
    id: string
    kind: 'LOAD' | 'PRINT'
    at: string
    amount: string
    denomination: number | null
    cards: number | null
    branch: { id: string; name: string } | null
    by: { id: string; name: string }
    note: string | null
  }[]
}

/* ---------------------------------------------------------------------------
   Payroll
   --------------------------------------------------------------------------- */

export type PayFigures = { units: number; sales: number; commission: number }

export type PayrollMonth = {
  month: string
  rows: {
    employee: {
      id: string
      name: string
      role: string
      isActive: boolean
      branch: { id: string; name: string } | null
      monthlySalary: string | null
    }
    byCategory: Record<'AIRTIME_VOUCHER' | 'PHONE' | 'SIM_CARD', PayFigures>
    salary: number
    commission: number
    /** This month's total from the Deductions page, plus carriedIn. */
    deducted: number
    /** What the last salary could not cover, taken off this one. */
    carriedIn: number
    payment: {
      id: string
      bonus: number
      deduction: number
      net: number
      /** Deduction this pay could not cover; taken off the next salary. */
      carriedOver: number
      note: string | null
      paidAt: string
      paidBy: string
    } | null
  }[]
  totals: { salary: number; commission: number; paid: number; unpaid: number }
}

export type CommissionRate = {
  id: string
  category: 'AIRTIME_VOUCHER' | 'PHONE' | 'SIM_CARD'
  userId: string | null
  user: { id: string; name: string } | null
  kind: 'PERCENT' | 'PER_UNIT'
  value: string
}

export type CommissionPaymentRow = {
  id: string
  month: string
  total: string
  note: string | null
  paidAt: string
  paidBy: { name: string }
  user: {
    id: string
    name: string
    role: string
    branch: { id: string; name: string } | null
  }
  lines: {
    /** The first day paid for, and the day after the last. */
    periodStart?: string | null
    periodEnd?: string | null
    id: string
    category: 'AIRTIME_VOUCHER' | 'PHONE' | 'SIM_CARD' | 'OTHER'
    /** The Owner's category; null for National ID. */
    categoryId: string | null
    /** The name it was paid under: "SIM Cards", "Accessories", "National ID". */
    label: string | null
    amount: string
    quantity: number | null
    unitPrice: string | null
    percent: string | null
    product: { id: string; name: string; sku: string } | null
  }[]
}

/* ---------------------------------------------------------------------------
   Telebirr (a money balance sellers spend on cash-ins and airtime)
   --------------------------------------------------------------------------- */

export type TelebirrSplit = { cashIn: number; airtime: number; count: number }

export type TelebirrSummary = {
  /** The chosen branch's balance; for the Owner with none chosen, all of them. */
  balance: string
  /** Every branch's own balance. Owner only; empty for anyone else. */
  balances: { id: string; name: string; balance: number }[]
  loadedInPeriod: number
  period: TelebirrSplit
  today: TelebirrSplit
  byBranch: (TelebirrSplit & { id: string; name: string })[]
  bySeller: (TelebirrSplit & { id: string; name: string; branch: string })[]
  entries: {
    id: string
    kind: 'CASH_IN' | 'AIRTIME' | 'LOAD'
    at: string
    amount: string
    branch: { id: string; name: string } | null
    by: { id: string; name: string }
    customerPhone: string | null
    note: string | null
    /** Cash-ins and airtime only. */
    paymentMethod?: 'CASH' | 'TRANSFER' | 'MIXED'
    transferAmount?: string
    bankName?: string | null
    /** Whether the viewer may still correct it (a seller: today, or a day the Owner opened). */
    editable?: boolean
  }[]
}

/* ---------------------------------------------------------------------------
   Transfers (stock on the road between branches)
   --------------------------------------------------------------------------- */

export type TransferRow = {
  id: string
  /** Sent by the Owner unasked, from the Send to a branch page. */
  directSend?: boolean
  status: 'PENDING' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED'
  notes: string | null
  shippedAt: string | null
  receivedAt: string | null
  createdAt: string
  driverName: string | null
  driverPhone: string | null
  vehiclePlate: string | null
  fromLocation: { id: string; name: string; isMainStock: boolean }
  /** `_count.users`: active supervisors there; without one the Owner receives. */
  toLocation: { id: string; name: string; isMainStock: boolean; _count?: { users: number } }
  deliveredBy: { id: string; name: string } | null
  receivedBy: { id: string; name: string } | null
  request: { id: string; requestedBy: { id: string; name: string } } | null
  items: {
    id: string
    quantity: number
    product: { id: string; sku: string; name: string; category: string }
  }[]
}

/* ---------------------------------------------------------------------------
   Categories the Owner manages
   --------------------------------------------------------------------------- */

/** How a category's goods behave. Added categories are OTHER. */
export type CategoryKind = 'SIM_CARD' | 'PHONE' | 'AIRTIME_VOUCHER' | 'OTHER'

export type CategoryRow = {
  id: string
  name: string
  kind: CategoryKind
  isActive: boolean
  _count?: { products: number; types: number }
}

/* ---------------------------------------------------------------------------
   Expenses (money a branch paid out)
   --------------------------------------------------------------------------- */

/** One day's deduction from someone's pay: the items short or lost. */
export type Deduction = {
  id: string
  day: string
  total: string
  note: string | null
  createdAt: string
  user: { id: string; name: string; role: string; branch: { id: string; name: string } | null }
  recordedBy: { id: string; name: string }
  lines: {
    id: string
    productId: string | null
    label: string
    quantity: number
    unitPrice: string
    amount: string
  }[]
}

export type ExpenseReport = {
  total: number
  byBranch: { id: string; name: string; total: number; count: number }[]
  byReason: { reason: string; total: number; count: number }[]
  expenses: {
    id: string
    amount: string
    reason: string
    note: string | null
    expenseDate: string
    createdAt: string
    branch: { id: string; name: string }
    recordedBy: { id: string; name: string }
    /** Whose cash paid it; null on older expenses. */
    spentBy: { id: string; name: string } | null
  }[]
}

/* ---------------------------------------------------------------------------
   National ID prints and copies for customers
   --------------------------------------------------------------------------- */

export type NidKind = 'ORIGINAL' | 'COPY'

export type NidOrder = {
  id: string
  kind: NidKind
  fullName: string
  price: string
  status: 'REGISTERED' | 'REQUESTED' | 'AT_OWNER' | 'APPROVED' | 'DONE' | 'LEFTOVER'
  /** The request it was sent in, while it is in one. */
  requestId: string | null
  createdAt: string
  doneAt: string | null
  location: { id: string; name: string }
  recordedBy: { id: string; name: string }
  paymentMethod?: 'CASH' | 'TRANSFER' | 'MIXED'
  transferAmount?: string
  bankName?: string | null
  /** Whether the viewer may still correct it (a seller: today, or a day the Owner opened). */
  editable?: boolean
}

export type NidRequest = {
  id: string
  kind: NidKind
  status: 'WITH_SUPERVISOR' | 'WITH_OWNER' | 'APPROVED' | 'RETURNED' | 'RECEIVED'
  total: number
  doneCount: number | null
  leftoverCount: number | null
  note: string | null
  createdAt: string
  forwardedAt: string | null
  returnedAt: string | null
  location: { id: string; name: string }
  requestedBy: { id: string; name: string }
  forwardedBy: { name: string } | null
  returnedBy: { name: string } | null
  /** The names still in it, oldest first. */
  orders: { id: string; fullName: string; status: NidOrder['status']; createdAt: string }[]
}

export type NidOverview = {
  prices: Record<NidKind, number>
  totals: { waiting: number; withSupervisor: number; withOwner: number; done: number; leftover: number; money: number }
  orders: NidOrder[]
  requests: NidRequest[]
  /** The Owner only: branches charging prices of their own. */
  branchPrices?: { branchId: string; name: string; ORIGINAL: number; COPY: number }[]
}

/** One set of profit and loss figures: a branch, or a day. */
export type ProfitFigures = {
  sales: number
  nationalId: number
  goods: number
  expenses: number
  payroll: number
  commission: number
  losses: number
  equipment: number
  income: number
  costs: number
  profit: number
}

/** Profit and loss for the Owner, from /api/reports/profit. */
export type ProfitReport = {
  from: string
  to: string
  income: {
    sales: number
    salesByCategory: { kind: string; name: string | null; amount: number; cost: number }[]
    /** Every branch, even one that sold nothing, with its sales by category. */
    salesByBranch: {
      id: string
      name: string
      amount: number
      byCategory: { kind: string; name: string | null; amount: number }[]
    }[]
    nationalId: number
    total: number
  }
  costs: {
    goods: number
    expenses: number
    payroll: { net: number; salary: number; commission: number; bonus: number; deduction: number }
    commission: number
    losses: number
    equipment: number
    total: number
  }
  grossProfit: number
  profit: number
  uncosted: { quantity: number; revenue: number }
  byBranch: ({ id: string; name: string } & ProfitFigures)[]
  /** Newest day first. */
  byDay: ({ date: string } & ProfitFigures)[]
  /** Each branch's item sales, day by day. */
  dailySales: {
    branches: { id: string; name: string }[]
    days: { date: string; byBranch: Record<string, number>; total: number }[]
  }
}
