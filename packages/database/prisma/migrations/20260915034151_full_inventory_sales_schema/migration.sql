/*
  Warnings:

  - You are about to drop the column `brand` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `model` on the `Product` table. All the data in the column will be lost.
  - You are about to alter the column `price` on the `Product` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `Decimal(12,2)`.
  - You are about to drop the `InventoryItem` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[sku]` on the table `Product` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `sku` to the `Product` table without a default value. This is not possible if the table is not empty.
  - Made the column `price` on table `Product` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "InventoryUnitStatus" AS ENUM ('IN_STOCK', 'RESERVED', 'SOLD', 'DAMAGED', 'LOST');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('WAREHOUSE', 'SUPERVISOR', 'SALES');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SENT_TO_OWNER');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('STOCK_IN', 'STOCK_OUT', 'TRANSFER', 'SALE', 'RETURN', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "SyncOperation" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- DropForeignKey
ALTER TABLE "InventoryItem" DROP CONSTRAINT "InventoryItem_productId_fkey";

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "brand",
DROP COLUMN "model",
ADD COLUMN     "sku" TEXT NOT NULL,
ALTER COLUMN "price" SET NOT NULL,
ALTER COLUMN "price" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "supervisorId" TEXT;

-- DropTable
DROP TABLE "InventoryItem";

-- CreateTable
CREATE TABLE "SimProduct" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherProduct" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "denomination" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoucherProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhoneProduct" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "storage" TEXT,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhoneProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLocation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LocationType" NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryBalance" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryUnit" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" "InventoryUnitStatus" NOT NULL DEFAULT 'IN_STOCK',
    "serialNumber" TEXT,
    "simNumber" TEXT,
    "iccid" TEXT,
    "imei" TEXT,
    "saleItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockRequest" (
    "id" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedToId" TEXT NOT NULL,
    "approvedById" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockRequestItem" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "deliveredById" TEXT,
    "receivedById" TEXT,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "shippedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferItem" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransferItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "salespersonId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "cashReportId" TEXT,
    "approvedById" TEXT,
    "status" "SaleStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "cashReceived" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "saleDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleItem" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashReport" (
    "id" TEXT NOT NULL,
    "salespersonId" TEXT NOT NULL,
    "approvedById" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "expectedCash" DECIMAL(12,2) NOT NULL,
    "actualCash" DECIMAL(12,2) NOT NULL,
    "variance" DECIMAL(12,2) NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "sentToOwnerAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankReceipt" (
    "id" TEXT NOT NULL,
    "cashReportId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "verifiedById" TEXT,
    "bankName" TEXT,
    "referenceNumber" TEXT,
    "fileUrl" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "receiptDate" TIMESTAMP(3) NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "quantity" INTEGER NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "createdById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "oldData" JSONB,
    "newData" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRecord" (
    "id" TEXT NOT NULL,
    "clientMutationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "operation" "SyncOperation" NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB,
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SimProduct_productId_key" ON "SimProduct"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherProduct_productId_key" ON "VoucherProduct"("productId");

-- CreateIndex
CREATE INDEX "VoucherProduct_denomination_idx" ON "VoucherProduct"("denomination");

-- CreateIndex
CREATE UNIQUE INDEX "PhoneProduct_productId_key" ON "PhoneProduct"("productId");

-- CreateIndex
CREATE INDEX "PhoneProduct_brand_idx" ON "PhoneProduct"("brand");

-- CreateIndex
CREATE INDEX "PhoneProduct_model_idx" ON "PhoneProduct"("model");

-- CreateIndex
CREATE UNIQUE INDEX "StockLocation_userId_key" ON "StockLocation"("userId");

-- CreateIndex
CREATE INDEX "StockLocation_type_idx" ON "StockLocation"("type");

-- CreateIndex
CREATE INDEX "InventoryBalance_productId_idx" ON "InventoryBalance"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBalance_locationId_productId_key" ON "InventoryBalance"("locationId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryUnit_serialNumber_key" ON "InventoryUnit"("serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryUnit_simNumber_key" ON "InventoryUnit"("simNumber");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryUnit_iccid_key" ON "InventoryUnit"("iccid");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryUnit_imei_key" ON "InventoryUnit"("imei");

-- CreateIndex
CREATE INDEX "InventoryUnit_productId_idx" ON "InventoryUnit"("productId");

-- CreateIndex
CREATE INDEX "InventoryUnit_locationId_idx" ON "InventoryUnit"("locationId");

-- CreateIndex
CREATE INDEX "InventoryUnit_status_idx" ON "InventoryUnit"("status");

-- CreateIndex
CREATE INDEX "StockRequest_requestedById_idx" ON "StockRequest"("requestedById");

-- CreateIndex
CREATE INDEX "StockRequest_requestedToId_idx" ON "StockRequest"("requestedToId");

-- CreateIndex
CREATE INDEX "StockRequest_status_idx" ON "StockRequest"("status");

-- CreateIndex
CREATE INDEX "StockRequestItem_requestId_idx" ON "StockRequestItem"("requestId");

-- CreateIndex
CREATE INDEX "StockRequestItem_productId_idx" ON "StockRequestItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_requestId_key" ON "StockTransfer"("requestId");

-- CreateIndex
CREATE INDEX "StockTransfer_fromLocationId_idx" ON "StockTransfer"("fromLocationId");

-- CreateIndex
CREATE INDEX "StockTransfer_toLocationId_idx" ON "StockTransfer"("toLocationId");

-- CreateIndex
CREATE INDEX "StockTransfer_status_idx" ON "StockTransfer"("status");

-- CreateIndex
CREATE INDEX "StockTransferItem_transferId_idx" ON "StockTransferItem"("transferId");

-- CreateIndex
CREATE INDEX "StockTransferItem_productId_idx" ON "StockTransferItem"("productId");

-- CreateIndex
CREATE INDEX "Sale_salespersonId_idx" ON "Sale"("salespersonId");

-- CreateIndex
CREATE INDEX "Sale_saleDate_idx" ON "Sale"("saleDate");

-- CreateIndex
CREATE INDEX "Sale_status_idx" ON "Sale"("status");

-- CreateIndex
CREATE INDEX "Sale_cashReportId_idx" ON "Sale"("cashReportId");

-- CreateIndex
CREATE INDEX "SaleItem_saleId_idx" ON "SaleItem"("saleId");

-- CreateIndex
CREATE INDEX "SaleItem_productId_idx" ON "SaleItem"("productId");

-- CreateIndex
CREATE INDEX "CashReport_salespersonId_idx" ON "CashReport"("salespersonId");

-- CreateIndex
CREATE INDEX "CashReport_periodStart_periodEnd_idx" ON "CashReport"("periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "CashReport_status_idx" ON "CashReport"("status");

-- CreateIndex
CREATE INDEX "BankReceipt_cashReportId_idx" ON "BankReceipt"("cashReportId");

-- CreateIndex
CREATE INDEX "BankReceipt_receiptDate_idx" ON "BankReceipt"("receiptDate");

-- CreateIndex
CREATE INDEX "BankReceipt_status_idx" ON "BankReceipt"("status");

-- CreateIndex
CREATE INDEX "StockMovement_productId_idx" ON "StockMovement"("productId");

-- CreateIndex
CREATE INDEX "StockMovement_fromLocationId_idx" ON "StockMovement"("fromLocationId");

-- CreateIndex
CREATE INDEX "StockMovement_toLocationId_idx" ON "StockMovement"("toLocationId");

-- CreateIndex
CREATE INDEX "StockMovement_type_idx" ON "StockMovement"("type");

-- CreateIndex
CREATE INDEX "StockMovement_createdAt_idx" ON "StockMovement"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_idx" ON "AuditLog"("entityType");

-- CreateIndex
CREATE INDEX "AuditLog_entityId_idx" ON "AuditLog"("entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SyncRecord_clientMutationId_key" ON "SyncRecord"("clientMutationId");

-- CreateIndex
CREATE INDEX "SyncRecord_deviceId_idx" ON "SyncRecord"("deviceId");

-- CreateIndex
CREATE INDEX "SyncRecord_status_idx" ON "SyncRecord"("status");

-- CreateIndex
CREATE INDEX "SyncRecord_createdAt_idx" ON "SyncRecord"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");

-- CreateIndex
CREATE INDEX "Product_status_idx" ON "Product"("status");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_supervisorId_idx" ON "User"("supervisorId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimProduct" ADD CONSTRAINT "SimProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherProduct" ADD CONSTRAINT "VoucherProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhoneProduct" ADD CONSTRAINT "PhoneProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLocation" ADD CONSTRAINT "StockLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryUnit" ADD CONSTRAINT "InventoryUnit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryUnit" ADD CONSTRAINT "InventoryUnit_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryUnit" ADD CONSTRAINT "InventoryUnit_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_requestedToId_fkey" FOREIGN KEY ("requestedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequestItem" ADD CONSTRAINT "StockRequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "StockRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequestItem" ADD CONSTRAINT "StockRequestItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "StockRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_deliveredById_fkey" FOREIGN KEY ("deliveredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_cashReportId_fkey" FOREIGN KEY ("cashReportId") REFERENCES "CashReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashReport" ADD CONSTRAINT "CashReport_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashReport" ADD CONSTRAINT "CashReport_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReceipt" ADD CONSTRAINT "BankReceipt_cashReportId_fkey" FOREIGN KEY ("cashReportId") REFERENCES "CashReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReceipt" ADD CONSTRAINT "BankReceipt_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReceipt" ADD CONSTRAINT "BankReceipt_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
