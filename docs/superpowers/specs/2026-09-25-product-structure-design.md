# Product structure and serial capture

**Status:** awaiting approval · **Date:** 2026-09-25

## Why this change

Two problems, both from the same root: the catalogue was designed before anyone
described how the business actually sells.

**The catalogue is flat.** Every product sits in one list under one of three
categories. There is nowhere to say that an iPhone 15 Pro Max is an *iPhone*,
or that a 25-birr voucher is an *Ibid*. As the owner adds variants the list
becomes unusable, and nothing stops the same brand being typed three different
ways.

**Serials are collected at the wrong moment.** Today, taking 50 phones into
stock means pasting 50 IMEIs. That is not how the branches work: the owner
ships a count, and the IMEI only becomes known when a salesperson hands a
specific handset to a customer. The same is true of SIM cards and their ICCIDs.

## What changes for the people using it

**Owner adding a product**
Pick the category, pick the type from a list they control, fill two or three
fields, set the price. The name and the product code write themselves.

**Owner taking stock into a branch**
Pick category, product, branch, quantity. No serial numbers, for any category.

**Salesperson selling**
Pick the product and the quantity. For a SIM card or a phone, type one ICCID or
one IMEI per unit sold. For vouchers, nothing extra.

## Structure

```
Category        fixed: SIM_CARD · PHONE · AIRTIME_VOUCHER
  └── Type      a tree the owner manages
        └── Product        what is priced, stocked and sold
              └── Unit     one row per serial, created when sold
```

The **Type** tree, as it will be seeded:

| category | tree |
|---|---|
| SIM_CARD | Standard · eSIM |
| AIRTIME_VOUCHER | Ibid · Voucher · Wereket |
| PHONE | iPhone ▸ 15 Pro Max · Samsung ▸ Galaxy A16 · Tecno ▸ Spark 20 |

One table holds all of it. Each row has a category, a name, and an optional
parent. SIM and voucher types sit one level deep; phones go two — brand, then
model. Nothing stops a third level later if some brand needs it.

Registering the phone model as a tree node rather than typing it on each
product is deliberate: it is what keeps `15 Pro Max` from being entered as
`15 pro max` next month, and it is what makes the Products page able to group
by brand.

## Data model

**New table `ProductType`**

| column | type | notes |
|---|---|---|
| id | cuid | |
| category | ProductCategory | which of the three it belongs to |
| parentId | string? | null for a top-level type |
| name | string | |
| isActive | boolean | retire a type without deleting it |
| createdAt | datetime | |

Unique on `(category, parentId, name)` — the same brand cannot be added twice,
but `Galaxy A16` may exist under Samsung and under another brand.

**Changed table `Product`**

- new `typeId` → `ProductType`, required
- `sku` stays, generated rather than typed
- `name` stays, generated but editable

**Changed table `SimProduct`**

- `network` becomes nullable and is no longer asked for or written. The column
  stays rather than being dropped, so existing rows keep their value and the
  query chain that includes this table is untouched.

**Unchanged: `PhoneProduct`, `VoucherProduct`, `InventoryUnit`, `InventoryBalance`.**

`PhoneProduct.brand` and `.model` keep being written, copied from the chosen
type path at save time. They are redundant with the type tree, but sixteen
files in the web app read them for display. Writing both keeps the change
small and lets those files migrate later, or never.

## Generated name and code

Built from the parts, both editable, the code hidden from the form:

| | name | code |
|---|---|---|
| SIM | Standard SIM card | `SIM-STD` |
| Phone | iPhone 15 Pro Max 256GB Black | `PH-IPH-15PM-256-BLK` |
| Voucher | Ibid 25 | `AV-IBID-25` |

The code is required by the database and is genuinely useful in exports and for
catching duplicates, but there is no reason for a person to invent one. If a
generated code collides, a numeric suffix is added.

A voucher's price is filled from its denomination and the separate price box is
removed — Ibid 25 sells for 25.

## Serial capture

**Stock-in stops creating units.** `recordStockIn` currently writes one
`InventoryUnit` per serial for SIM cards and phones. It will only move the
balance, for every category.

**Sale creates them.** When a sale includes a SIM card or a phone, the request
must carry exactly `quantity` serials for that line. Each becomes an
`InventoryUnit` with `status = SOLD`, the seller's branch, the ICCID or IMEI
filled, and `saleItemId` pointing at the line.

The unique index on `iccid` and `imei` then means **the same serial cannot be
sold twice**, which is the one integrity check this design keeps.

### What is lost, stated plainly

The system will know how many phones a branch holds and every IMEI it has sold.
It will not know which IMEIs are on the shelf, and it cannot verify that a sold
IMEI was ever stocked. That is inherent in counting phones by quantity, and it
matches how the branches work.

## Modules affected

| module | change |
|---|---|
| `products` | create takes `typeId`; generates name and code; new type CRUD |
| `inventory` | `recordStockIn` no longer creates units (line ~142) |
| `sales` | sale input carries serials; creates sold units instead of retiring stock units (lines ~166, ~422) |
| `transfers` | stops moving units (line ~245); balances only |
| `stock-loss` | stops retiring units; balance-only write-off |
| `branches` | unit count per branch becomes a sold-unit count |
| `settings` | add `productType` to the `TABLES` list so the new table is covered wherever that list is used |

Web: Products page (tabs from the type tree, + Add type), ProductDialog,
StockInDialog (serial box removed), the sale form (serial boxes added),
UnitDetails (now shows sold units only).

**Not affected:** National ID — it does not touch units or ICCIDs. Reports,
low-stock settings and the dashboard keep their existing three category lines.

## Migration

**Production is empty** — no products, no stock, no units. The migration seeds
the type tree and nothing else has to be converted.

**Locally** there are 8 products, balances and units from testing. A one-off
script will attach each product to a seeded type and delete the in-stock units,
since under the new rules they should not exist. This runs only on the
development database.

Two migrations: one creating `ProductType` and adding `Product.typeId`, one
making `SimProduct.network` nullable. Both additive; neither drops data.

## Testing

No test framework exists in this repo, so verification is by driving the real
API and the real browser, as with the Products page:

1. Add a type at each depth — a brand, a model under it, a voucher type.
2. Create a product in each category; check the generated name and code.
3. Confirm a duplicate type name is refused, and a duplicate code is suffixed.
4. Take stock in for a phone by quantity; confirm no units are created and the
   balance moves.
5. Sell 2 phones with 2 IMEIs; confirm two sold units exist, linked to the sale.
6. Sell the same IMEI again; confirm it is refused.
7. Sell a voucher; confirm no serials are asked for.
8. Transfer stock between branches; confirm balances move and nothing breaks.
9. Check the Products page tabs and the Add Inventory picker still filter.
10. Check both languages for untranslated keys.
11. Delete every test row and confirm the database matches its starting state.

## Out of scope

- A fourth category. The three stay fixed.
- Per-category lines in reports, or per-type low-stock levels.
- Removing `PhoneProduct.brand`/`.model` in favour of the type tree.
- Retro-filling IMEIs for stock already on a shelf.

## Open question

Storage and colour stay optional fields on a phone product. If two variants
differ only by storage they become two products, which is correct — they have
different prices. Confirm that is what you want rather than storage being part
of the type tree.
