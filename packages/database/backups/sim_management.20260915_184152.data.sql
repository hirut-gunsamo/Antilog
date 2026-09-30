--
-- PostgreSQL database dump
--

\restrict aWPxc3qNVY0LvSJ9DhpGjMAIVjys0XXOrXN0dB7v8jHNe5dfYsj3RLLlcYOmVMt

-- Dumped from database version 17.11 (Homebrew)
-- Dumped by pg_dump version 17.11 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: User; Type: TABLE DATA; Schema: public; Owner: mac
--

INSERT INTO public."User" (id, name, email, "passwordHash", role, "isActive", "createdAt", "updatedAt", "supervisorId") VALUES ('cmu24uc4o0000lmrxg88tlgsu', 'System Owner', 'owner@example.com', '$2b$12$x7VqOLL.UOfTG21r4vpvFelsN0FiCu1KKmwmmE1.gBk.QaII142i6', 'OWNER', true, '2026-09-15 03:49:06.409', '2026-09-15 03:49:06.409', NULL);
INSERT INTO public."User" (id, name, email, "passwordHash", role, "isActive", "createdAt", "updatedAt", "supervisorId") VALUES ('cmu261em80000m8rxh6dhnbav', 'Supervisor One', 'supervisor@example.com', '$2b$12$q4QEX4tzAnmS3OJu5W.2fOnEwpnPdJ7qmFFxAu1hRWWWUHAYOSNIe', 'SUPERVISOR', true, '2026-09-15 04:22:35.84', '2026-09-15 04:22:35.84', NULL);
INSERT INTO public."User" (id, name, email, "passwordHash", role, "isActive", "createdAt", "updatedAt", "supervisorId") VALUES ('cmu264ywa0001m8rxb2z4p3fb', 'Sales One', 'sales@example.com', '$2b$12$D75Eq16tk2Ky3I5R2ntehOGaic1KQuz5fUzUHoEkW3yiGeR1ZttaO', 'SALES', true, '2026-09-15 04:25:22.09', '2026-09-15 04:25:22.09', 'cmu261em80000m8rxh6dhnbav');


--
-- Data for Name: AuditLog; Type: TABLE DATA; Schema: public; Owner: mac
--



--
-- Data for Name: CashReport; Type: TABLE DATA; Schema: public; Owner: mac
--



--
-- Data for Name: BankReceipt; Type: TABLE DATA; Schema: public; Owner: mac
--



--
-- Data for Name: Product; Type: TABLE DATA; Schema: public; Owner: mac
--

INSERT INTO public."Product" (id, name, category, description, price, status, "createdAt", "updatedAt", sku) VALUES ('cmu24uc570002lmrxng3vhflx', '10 Airtime Voucher', 'AIRTIME_VOUCHER', NULL, 10.00, 'ACTIVE', '2026-09-15 03:49:06.427', '2026-09-15 03:49:06.427', 'VOUCHER-10');
INSERT INTO public."Product" (id, name, category, description, price, status, "createdAt", "updatedAt", sku) VALUES ('cmu24uc5i0004lmrxh8bhaq25', '15 Airtime Voucher', 'AIRTIME_VOUCHER', NULL, 15.00, 'ACTIVE', '2026-09-15 03:49:06.438', '2026-09-15 03:49:06.438', 'VOUCHER-15');
INSERT INTO public."Product" (id, name, category, description, price, status, "createdAt", "updatedAt", sku) VALUES ('cmu24uc5n0006lmrxohangvg2', '25 Airtime Voucher', 'AIRTIME_VOUCHER', NULL, 25.00, 'ACTIVE', '2026-09-15 03:49:06.443', '2026-09-15 03:49:06.443', 'VOUCHER-25');
INSERT INTO public."Product" (id, name, category, description, price, status, "createdAt", "updatedAt", sku) VALUES ('cmu24uc5s0008lmrxk8a53co7', '50 Airtime Voucher', 'AIRTIME_VOUCHER', NULL, 50.00, 'ACTIVE', '2026-09-15 03:49:06.448', '2026-09-15 03:49:06.448', 'VOUCHER-50');
INSERT INTO public."Product" (id, name, category, description, price, status, "createdAt", "updatedAt", sku) VALUES ('cmu24uc5x000almrxuwhaa0pj', '100 Airtime Voucher', 'AIRTIME_VOUCHER', NULL, 100.00, 'ACTIVE', '2026-09-15 03:49:06.454', '2026-09-15 03:49:06.454', 'VOUCHER-100');
INSERT INTO public."Product" (id, name, category, description, price, status, "createdAt", "updatedAt", sku) VALUES ('cmu26df7y0000ncrxfamihjyg', 'Standard SIM Card', 'SIM_CARD', NULL, 100.00, 'ACTIVE', '2026-09-15 04:31:56.494', '2026-09-15 04:31:56.494', 'SIM-ETH-001');
INSERT INTO public."Product" (id, name, category, description, price, status, "createdAt", "updatedAt", sku) VALUES ('cmu26eq090002ncrxqx9xdw1c', 'Samsung Galaxy A16', 'PHONE', NULL, 15000.00, 'ACTIVE', '2026-09-15 04:32:57.129', '2026-09-15 04:32:57.129', 'PHONE-SAMSUNG-A16');


--
-- Data for Name: StockLocation; Type: TABLE DATA; Schema: public; Owner: mac
--

INSERT INTO public."StockLocation" (id, name, type, "userId", "createdAt", "updatedAt") VALUES ('cmu27picl00013orxk59x2rpe', 'Balela', 'WAREHOUSE', NULL, '2026-09-15 05:09:20.037', '2026-09-15 05:09:20.037');
INSERT INTO public."StockLocation" (id, name, type, "userId", "createdAt", "updatedAt") VALUES ('cmu27picn00023orx76nrdr9q', 'Bensa Daye', 'WAREHOUSE', NULL, '2026-09-15 05:09:20.039', '2026-09-15 05:09:20.039');
INSERT INTO public."StockLocation" (id, name, type, "userId", "createdAt", "updatedAt") VALUES ('cmu27pico00033orxa580fn8l', 'Arroresa', 'WAREHOUSE', NULL, '2026-09-15 05:09:20.04', '2026-09-15 05:09:20.04');
INSERT INTO public."StockLocation" (id, name, type, "userId", "createdAt", "updatedAt") VALUES ('cmu24uc500001lmrxhazx2sy7', 'Hawassa Main', 'WAREHOUSE', 'cmu24uc4o0000lmrxg88tlgsu', '2026-09-15 03:49:06.42', '2026-09-15 07:23:43.034');


--
-- Data for Name: InventoryBalance; Type: TABLE DATA; Schema: public; Owner: mac
--

INSERT INTO public."InventoryBalance" (id, "locationId", "productId", quantity, "createdAt", "updatedAt") VALUES ('cmu278qek0000frrxjatrml91', 'cmu24uc500001lmrxhazx2sy7', 'cmu26df7y0000ncrxfamihjyg', 2, '2026-09-15 04:56:17.324', '2026-09-15 04:56:17.324');
INSERT INTO public."InventoryBalance" (id, "locationId", "productId", quantity, "createdAt", "updatedAt") VALUES ('cmu27co2e0004frrxobqbt48p', 'cmu24uc500001lmrxhazx2sy7', 'cmu24uc5x000almrxuwhaa0pj', 100, '2026-09-15 04:59:20.918', '2026-09-15 04:59:20.918');
INSERT INTO public."InventoryBalance" (id, "locationId", "productId", quantity, "createdAt", "updatedAt") VALUES ('cmu27d2h20006frrxftw2hxdf', 'cmu24uc500001lmrxhazx2sy7', 'cmu26eq090002ncrxqx9xdw1c', 2, '2026-09-15 04:59:39.59', '2026-09-15 04:59:39.59');


--
-- Data for Name: Sale; Type: TABLE DATA; Schema: public; Owner: mac
--



--
-- Data for Name: SaleItem; Type: TABLE DATA; Schema: public; Owner: mac
--



--
-- Data for Name: InventoryUnit; Type: TABLE DATA; Schema: public; Owner: mac
--

INSERT INTO public."InventoryUnit" (id, "productId", "locationId", status, "serialNumber", "simNumber", iccid, imei, "saleItemId", "createdAt", "updatedAt") VALUES ('cmu278qep0001frrxuevi3231', 'cmu26df7y0000ncrxfamihjyg', 'cmu24uc500001lmrxhazx2sy7', 'IN_STOCK', 'SIM-SN-0001', '251911000001', '8992510000000000001', NULL, NULL, '2026-09-15 04:56:17.329', '2026-09-15 04:56:17.329');
INSERT INTO public."InventoryUnit" (id, "productId", "locationId", status, "serialNumber", "simNumber", iccid, imei, "saleItemId", "createdAt", "updatedAt") VALUES ('cmu278qep0002frrx5fbnu1g3', 'cmu26df7y0000ncrxfamihjyg', 'cmu24uc500001lmrxhazx2sy7', 'IN_STOCK', 'SIM-SN-0002', '251911000002', '8992510000000000002', NULL, NULL, '2026-09-15 04:56:17.329', '2026-09-15 04:56:17.329');
INSERT INTO public."InventoryUnit" (id, "productId", "locationId", status, "serialNumber", "simNumber", iccid, imei, "saleItemId", "createdAt", "updatedAt") VALUES ('cmu27d2h40007frrxapgk3zbj', 'cmu26eq090002ncrxqx9xdw1c', 'cmu24uc500001lmrxhazx2sy7', 'IN_STOCK', 'A16-SN-001', NULL, NULL, '356789012345671', NULL, '2026-09-15 04:59:39.592', '2026-09-15 04:59:39.592');
INSERT INTO public."InventoryUnit" (id, "productId", "locationId", status, "serialNumber", "simNumber", iccid, imei, "saleItemId", "createdAt", "updatedAt") VALUES ('cmu27d2h40008frrxm3denrwx', 'cmu26eq090002ncrxqx9xdw1c', 'cmu24uc500001lmrxhazx2sy7', 'IN_STOCK', 'A16-SN-002', NULL, NULL, '356789012345689', NULL, '2026-09-15 04:59:39.592', '2026-09-15 04:59:39.592');


--
-- Data for Name: PhoneProduct; Type: TABLE DATA; Schema: public; Owner: mac
--

INSERT INTO public."PhoneProduct" (id, "productId", brand, model, storage, color, "createdAt", "updatedAt") VALUES ('cmu26eq0a0003ncrx9rkpqyz8', 'cmu26eq090002ncrxqx9xdw1c', 'Samsung', 'Galaxy A16', '128GB', 'Black', '2026-09-15 04:32:57.13', '2026-09-15 04:32:57.13');


--
-- Data for Name: SimProduct; Type: TABLE DATA; Schema: public; Owner: mac
--

INSERT INTO public."SimProduct" (id, "productId", network, "createdAt", "updatedAt") VALUES ('cmu26df810001ncrx8ddtrh80', 'cmu26df7y0000ncrxfamihjyg', 'Ethio Telecom', '2026-09-15 04:31:56.497', '2026-09-15 04:31:56.497');


--
-- Data for Name: StockMovement; Type: TABLE DATA; Schema: public; Owner: mac
--

INSERT INTO public."StockMovement" (id, "productId", "fromLocationId", "toLocationId", quantity, type, "referenceType", "referenceId", "createdById", notes, "createdAt") VALUES ('cmu278qes0003frrxpwqsk7sy', 'cmu26df7y0000ncrxfamihjyg', NULL, 'cmu24uc500001lmrxhazx2sy7', 2, 'STOCK_IN', NULL, NULL, 'cmu24uc4o0000lmrxg88tlgsu', 'Initial SIM stock', '2026-09-15 04:56:17.332');
INSERT INTO public."StockMovement" (id, "productId", "fromLocationId", "toLocationId", quantity, type, "referenceType", "referenceId", "createdById", notes, "createdAt") VALUES ('cmu27co2f0005frrx8ltxozzc', 'cmu24uc5x000almrxuwhaa0pj', NULL, 'cmu24uc500001lmrxhazx2sy7', 100, 'STOCK_IN', NULL, NULL, 'cmu24uc4o0000lmrxg88tlgsu', 'Initial 100 ETB voucher stock', '2026-09-15 04:59:20.919');
INSERT INTO public."StockMovement" (id, "productId", "fromLocationId", "toLocationId", quantity, type, "referenceType", "referenceId", "createdById", notes, "createdAt") VALUES ('cmu27d2h50009frrxee4ydly4', 'cmu26eq090002ncrxqx9xdw1c', NULL, 'cmu24uc500001lmrxhazx2sy7', 2, 'STOCK_IN', NULL, NULL, 'cmu24uc4o0000lmrxg88tlgsu', 'Initial Samsung A16 stock', '2026-09-15 04:59:39.593');


--
-- Data for Name: StockRequest; Type: TABLE DATA; Schema: public; Owner: mac
--



--
-- Data for Name: StockRequestItem; Type: TABLE DATA; Schema: public; Owner: mac
--



--
-- Data for Name: StockTransfer; Type: TABLE DATA; Schema: public; Owner: mac
--



--
-- Data for Name: StockTransferItem; Type: TABLE DATA; Schema: public; Owner: mac
--



--
-- Data for Name: SyncRecord; Type: TABLE DATA; Schema: public; Owner: mac
--



--
-- Data for Name: VoucherProduct; Type: TABLE DATA; Schema: public; Owner: mac
--

INSERT INTO public."VoucherProduct" (id, "productId", denomination, "createdAt", "updatedAt") VALUES ('cmu24uc5d0003lmrxs6im7uy4', 'cmu24uc570002lmrxng3vhflx', 10, '2026-09-15 03:49:06.433', '2026-09-15 03:49:06.433');
INSERT INTO public."VoucherProduct" (id, "productId", denomination, "createdAt", "updatedAt") VALUES ('cmu24uc5k0005lmrxze4jxvsm', 'cmu24uc5i0004lmrxh8bhaq25', 15, '2026-09-15 03:49:06.44', '2026-09-15 03:49:06.44');
INSERT INTO public."VoucherProduct" (id, "productId", denomination, "createdAt", "updatedAt") VALUES ('cmu24uc5p0007lmrx54l7j533', 'cmu24uc5n0006lmrxohangvg2', 25, '2026-09-15 03:49:06.445', '2026-09-15 03:49:06.445');
INSERT INTO public."VoucherProduct" (id, "productId", denomination, "createdAt", "updatedAt") VALUES ('cmu24uc5v0009lmrxhnonko7u', 'cmu24uc5s0008lmrxk8a53co7', 50, '2026-09-15 03:49:06.451', '2026-09-15 03:49:06.451');
INSERT INTO public."VoucherProduct" (id, "productId", denomination, "createdAt", "updatedAt") VALUES ('cmu24uc60000blmrxilz28vp7', 'cmu24uc5x000almrxuwhaa0pj', 100, '2026-09-15 03:49:06.456', '2026-09-15 03:49:06.456');


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: mac
--

INSERT INTO public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES ('e06d4898-a983-451a-a842-47f8557b89f3', '10513a5fc64ccb7803c88a65e829cbf120e5206b8424bc63f28ef65eb1a16fc8', '2026-09-14 23:46:16.39581+03', '20260914204616_init', NULL, NULL, '2026-09-14 23:46:16.3812+03', 1);
INSERT INTO public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES ('3052e8a5-3625-4a95-8a26-e4ef9683672c', '0c4186c2932812d495d5748c91d7779ade2e87d3756bfc9497ccfac3136eeba9', '2026-09-15 06:41:51.603482+03', '20260915034151_full_inventory_sales_schema', NULL, NULL, '2026-09-15 06:41:51.494392+03', 1);


--
-- PostgreSQL database dump complete
--

\unrestrict aWPxc3qNVY0LvSJ9DhpGjMAIVjys0XXOrXN0dB7v8jHNe5dfYsj3RLLlcYOmVMt

