import { pgTable, foreignKey, uuid, text, boolean, integer, timestamp, jsonb, index, bigint, uniqueIndex, unique, check, numeric, doublePrecision, primaryKey, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const appRole = pgEnum("app_role", ['customer', 'merchant', 'super_admin', 'admin', 'operations', 'support', 'finance'])
export const creditStatus = pgEnum("credit_status", ['pending', 'approved', 'declined'])
export const creditTxStatus = pgEnum("credit_tx_status", ['pending', 'approved', 'rejected'])
export const creditTxType = pgEnum("credit_tx_type", ['charge', 'payment'])
export const customRequestStatus = pgEnum("custom_request_status", ['pending', 'quoted', 'accepted', 'rejected', 'converted'])
export const orderChannel = pgEnum("order_channel", ['online', 'in_store'])
export const orderStatus = pgEnum("order_status", ['sent', 'accepted', 'preparing', 'out_for_delivery', 'delivered', 'declined', 'cancelled'])
export const paymentMethod = pgEnum("payment_method", ['cash', 'credit', 'jeeb', 'jawali', 'hasab', 'onecash', 'wallet'])
export const returnStatus = pgEnum("return_status", ['none', 'requested', 'approved', 'rejected'])
export const storeStatus = pgEnum("store_status", ['pending', 'active', 'suspended', 'rejected'])
export const walletTxStatus = pgEnum("wallet_tx_status", ['pending', 'approved', 'rejected'])
export const walletTxType = pgEnum("wallet_tx_type", ['topup', 'payment', 'refund', 'adjustment'])


export const banners = pgTable("banners", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	title: text().notNull(),
	subtitle: text(),
	imageUrl: text("image_url"),
	link: text(),
	bgColor: text("bg_color").default('#0d9488'),
	storeId: uuid("store_id"),
	isActive: boolean("is_active").default(true).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [stores.id],
			name: "banners_store_id_fkey"
		}).onDelete("cascade"),
]);

export const appSettings = pgTable("app_settings", {
	key: text().primaryKey().notNull(),
	value: jsonb().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const appUsageLog = pgTable("app_usage_log", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	seq: bigint({ mode: "number" }).generatedAlwaysAsIdentity({ name: "app_usage_log_seq_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	userId: uuid("user_id").notNull(),
	userAgent: text("user_agent"),
	openedAt: timestamp("opened_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	lastPingAt: timestamp("last_ping_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	closedAt: timestamp("closed_at", { withTimezone: true, mode: 'date' }),
	closeType: text("close_type"),
}, (table) => [
	index("app_usage_log_user_idx").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.openedAt.desc().nullsFirst().op("timestamptz_ops")),
]);

export const auditLogs = pgTable("audit_logs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	seq: bigint({ mode: "number" }).generatedAlwaysAsIdentity({ name: "audit_logs_seq_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	userId: uuid("user_id"),
	userName: text("user_name"),
	userRole: text("user_role"),
	action: text().notNull(),
	tableName: text("table_name").notNull(),
	recordId: text("record_id"),
	recordLabel: text("record_label"),
	oldData: jsonb("old_data"),
	newData: jsonb("new_data"),
	changedFields: text("changed_fields").array(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("audit_logs_created_at_idx").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("audit_logs_table_name_idx").using("btree", table.tableName.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("audit_logs_user_id_idx").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
]);

export const authSessionsLog = pgTable("auth_sessions_log", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	seq: bigint({ mode: "number" }).generatedAlwaysAsIdentity({ name: "auth_sessions_log_seq_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	userId: uuid("user_id").notNull(),
	sessionId: text("session_id").notNull(),
	ip: text(),
	userAgent: text("user_agent"),
	loginAt: timestamp("login_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	logoutAt: timestamp("logout_at", { withTimezone: true, mode: 'date' }),
	logoutType: text("logout_type"),
	lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: 'date' }),
}, (table) => [
	index("auth_sessions_log_user_idx").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.loginAt.desc().nullsFirst().op("timestamptz_ops")),
]);

export const catalogCategories = pgTable("catalog_categories", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	icon: text(),
	usageCount: integer("usage_count").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	imageUrl: text("image_url"),
	mainSection: text("main_section"),
	parentCategory: text("parent_category"),
	sortOrder: integer("sort_order").default(0).notNull(),
}, (table) => [
	uniqueIndex("catalog_categories_name_uniq").using("btree", sql`lower(name)`),
]);

export const creditAccounts = pgTable("credit_accounts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	customerId: uuid("customer_id").notNull(),
	storeId: uuid("store_id").notNull(),
	balance: numeric({ precision: 10, scale:  2 }).default('0').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("credit_accounts_store_idx").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [users.id],
			name: "credit_accounts_customer_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [stores.id],
			name: "credit_accounts_store_id_fkey"
		}).onDelete("cascade"),
	unique("credit_accounts_customer_id_store_id_key").on(table.customerId, table.storeId),
	check("credit_accounts_balance_nonneg", sql`balance >= (0)::numeric`),
]);

export const businessCategories = pgTable("business_categories", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	slug: text().notNull(),
	nameAr: text("name_ar").notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	unique("business_categories_slug_key").on(table.slug),
]);

export const categories = pgTable("categories", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	name: text().notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [stores.id],
			name: "categories_store_id_fkey"
		}).onDelete("cascade"),
]);

export const creditTransactions = pgTable("credit_transactions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	accountId: uuid("account_id").notNull(),
	type: creditTxType().notNull(),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	note: text(),
	orderId: uuid("order_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	status: creditTxStatus().default('approved').notNull(),
}, (table) => [
	index("credit_transactions_account_created_idx").using("btree", table.accountId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [creditAccounts.id],
			name: "credit_transactions_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "credit_transactions_order_id_fkey"
		}).onDelete("set null"),
	check("credit_transactions_amount_check", sql`amount > (0)::numeric`),
]);

export const customProductRequests = pgTable("custom_product_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	customerId: uuid("customer_id").notNull(),
	storeId: uuid("store_id").notNull(),
	name: text().notNull(),
	description: text(),
	qty: integer().default(1).notNull(),
	imageUrl: text("image_url"),
	merchantPrice: numeric("merchant_price"),
	merchantNote: text("merchant_note"),
	status: customRequestStatus().default('pending').notNull(),
	orderId: uuid("order_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "custom_product_requests_order_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [stores.id],
			name: "custom_product_requests_store_id_fkey"
		}).onDelete("cascade"),
]);

export const catalogItems = pgTable("catalog_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	defaultPrice: numeric("default_price", { precision: 12, scale:  2 }).default('0').notNull(),
	imageUrl: text("image_url"),
	barcode: text(),
	categoryName: text("category_name"),
	usageCount: integer("usage_count").default(0).notNull(),
	source: text().default('merchant').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	categoryId: uuid("category_id"),
	categoryPath: text("category_path"),
	description: text().default('').notNull(),
	mainSection: text("main_section"),
	subcategory: text(),
	sortOrder: integer("sort_order").default(0).notNull(),
}, (table) => [
	index("catalog_items_category_id_idx").using("btree", table.categoryId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("catalog_items_dedup_uniq").using("btree", sql`lower(name)`, sql`COALESCE(barcode, ''::text)`),
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [catalogCategories.id],
			name: "catalog_items_category_id_fkey"
		}).onDelete("set null"),
	check("catalog_items_source_check", sql`source = ANY (ARRAY['seed'::text, 'merchant'::text, 'library_import'::text])`),
]);

export const favorites = pgTable("favorites", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	targetType: text("target_type").notNull(),
	targetId: uuid("target_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "favorites_user_id_fkey"
		}).onDelete("cascade"),
	unique("favorites_user_id_target_type_target_id_key").on(table.userId, table.targetType, table.targetId),
	check("favorites_target_type_check", sql`target_type = ANY (ARRAY['store'::text, 'product'::text])`),
]);

export const locations = pgTable("locations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	label: text().notNull(),
	lat: doublePrecision(),
	lng: doublePrecision(),
	landmarkText: text("landmark_text").notNull(),
	phone: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "locations_user_id_fkey"
		}).onDelete("cascade"),
]);

export const customerRatings = pgTable("customer_ratings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	customerId: uuid("customer_id").notNull(),
	storeId: uuid("store_id").notNull(),
	orderId: uuid("order_id"),
	stars: integer().notNull(),
	comment: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "customer_ratings_order_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [stores.id],
			name: "customer_ratings_store_id_fkey"
		}).onDelete("cascade"),
	unique("customer_ratings_store_id_order_id_key").on(table.storeId, table.orderId),
	check("customer_ratings_stars_check", sql`(stars >= 1) AND (stars <= 5)`),
]);

export const notifications = pgTable("notifications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	title: text().notNull(),
	body: text(),
	type: text().default('info').notNull(),
	link: text(),
	readAt: timestamp("read_at", { withTimezone: true, mode: 'date' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("idx_notifications_user_unread").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.readAt.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	index("notifications_user_created_idx").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "notifications_user_id_fkey"
		}).onDelete("cascade"),
]);

export const orderItems = pgTable("order_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orderId: uuid("order_id").notNull(),
	productId: uuid("product_id"),
	name: text().notNull(),
	price: numeric({ precision: 10, scale:  2 }).notNull(),
	qty: integer().notNull(),
	note: text(),
}, (table) => [
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "order_items_order_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "order_items_product_id_fkey"
		}).onDelete("set null"),
]);

export const orders = pgTable("orders", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	customerId: uuid("customer_id").notNull(),
	storeId: uuid("store_id").notNull(),
	total: numeric({ precision: 10, scale:  2 }).notNull(),
	paymentMethod: paymentMethod("payment_method").notNull(),
	creditStatus: creditStatus("credit_status"),
	status: orderStatus().default('sent').notNull(),
	note: text(),
	locationLabel: text("location_label"),
	locationLandmark: text("location_landmark"),
	locationPhone: text("location_phone"),
	locationLat: doublePrecision("location_lat"),
	locationLng: doublePrecision("location_lng"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	channel: orderChannel().default('online').notNull(),
	returnStatus: returnStatus("return_status").default('none').notNull(),
	returnReason: text("return_reason"),
	returnRequestedAt: timestamp("return_requested_at", { withTimezone: true, mode: 'date' }),
	returnRespondedAt: timestamp("return_responded_at", { withTimezone: true, mode: 'date' }),
	commissionPct: numeric("commission_pct", { precision: 5, scale:  2 }).default('0').notNull(),
	commissionAmount: numeric("commission_amount", { precision: 10, scale:  2 }).default('0').notNull(),
}, (table) => [
	index("orders_customer_created_idx").using("btree", table.customerId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	index("orders_store_created_idx").using("btree", table.storeId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("orders_store_status_created_idx").using("btree", table.storeId.asc().nullsLast().op("timestamptz_ops"), table.status.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [users.id],
			name: "orders_customer_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [stores.id],
			name: "orders_store_id_fkey"
		}).onDelete("cascade"),
]);

export const passwordResetRequests = pgTable("password_reset_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	phone: text().notNull(),
	userId: uuid("user_id"),
	userType: text("user_type"),
	applicantName: text("applicant_name"),
	reason: text(),
	status: text().default('pending').notNull(),
	requestedAt: timestamp("requested_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	decidedAt: timestamp("decided_at", { withTimezone: true, mode: 'date' }),
	decidedBy: uuid("decided_by"),
}, (table) => [
	index("password_reset_requests_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops"), table.requestedAt.desc().nullsFirst().op("text_ops")),
	check("password_reset_requests_status_check", sql`status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])`),
]);

export const permissionBundles = pgTable("permission_bundles", {
	bundle: text().primaryKey().notNull(),
	label: text().notNull(),
	sort: integer().default(0).notNull(),
});

export const posIngestLog = pgTable("pos_ingest_log", {
	clientOpId: uuid("client_op_id").primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	kind: text().notNull(),
	result: jsonb().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [stores.id],
			name: "pos_ingest_log_store_id_fkey"
		}).onDelete("cascade"),
	check("pos_ingest_log_kind_check", sql`kind = ANY (ARRAY['sale'::text, 'new_product'::text])`),
]);

export const productOffers = pgTable("product_offers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	productId: uuid("product_id").notNull(),
	storeId: uuid("store_id").notNull(),
	discountPrice: numeric("discount_price").notNull(),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	endsAt: timestamp("ends_at", { withTimezone: true, mode: 'date' }),
	maxQty: integer("max_qty"),
	soldQty: integer("sold_qty").default(0).notNull(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("idx_product_offers_product").using("btree", table.productId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "product_offers_product_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [stores.id],
			name: "product_offers_store_id_fkey"
		}).onDelete("cascade"),
]);

export const pendingCustomers = pgTable("pending_customers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	name: text().notNull(),
	phone: text().notNull(),
	createdBy: uuid("created_by").notNull(),
	claimedByUserId: uuid("claimed_by_user_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("pending_customers_phone_idx").using("btree", table.phone.asc().nullsLast().op("text_ops")),
	index("pending_customers_store_idx").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [stores.id],
			name: "pending_customers_store_id_fkey"
		}).onDelete("cascade"),
]);

export const ratings = pgTable("ratings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	customerId: uuid("customer_id").notNull(),
	storeId: uuid("store_id").notNull(),
	orderId: uuid("order_id"),
	stars: integer().notNull(),
	comment: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [users.id],
			name: "ratings_customer_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "ratings_order_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [stores.id],
			name: "ratings_store_id_fkey"
		}).onDelete("cascade"),
	check("ratings_stars_check", sql`(stars >= 1) AND (stars <= 5)`),
]);

export const profiles = pgTable("profiles", {
	id: uuid().primaryKey().notNull(),
	phone: text().notNull(),
	name: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	accountStatus: text("account_status").default('pending').notNull(),
	userType: text("user_type"),
	businessName: text("business_name"),
	businessCategoryId: uuid("business_category_id"),
	city: text(),
	district: text(),
	address: text(),
	approvedAt: timestamp("approved_at", { withTimezone: true, mode: 'date' }),
	approvedBy: uuid("approved_by"),
	suspendedUntil: timestamp("suspended_until", { withTimezone: true, mode: 'date' }),
	statusReason: text("status_reason"),
}, (table) => [
	index("profiles_account_status_idx").using("btree", table.accountStatus.asc().nullsLast().op("text_ops")),
	index("profiles_phone_idx").using("btree", table.phone.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.businessCategoryId],
			foreignColumns: [businessCategories.id],
			name: "profiles_business_category_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.id],
			foreignColumns: [users.id],
			name: "profiles_id_fkey"
		}).onDelete("cascade"),
	check("profiles_account_status_check", sql`account_status = ANY (ARRAY['pending'::text, 'active'::text, 'rejected'::text, 'suspended'::text, 'deleted'::text])`),
]);

export const products = pgTable("products", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	categoryId: uuid("category_id"),
	name: text().notNull(),
	imageUrl: text("image_url"),
	price: numeric({ precision: 10, scale:  2 }).notNull(),
	inStock: boolean("in_stock").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	barcode: text(),
	libCategory: text("lib_category"),
	mainSection: text("main_section"),
	subcategory: text(),
}, (table) => [
	uniqueIndex("products_store_barcode_uniq").using("btree", table.storeId.asc().nullsLast().op("text_ops"), table.barcode.asc().nullsLast().op("text_ops")).where(sql`(barcode IS NOT NULL)`),
	index("products_store_idx").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [categories.id],
			name: "products_category_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [stores.id],
			name: "products_store_id_fkey"
		}).onDelete("cascade"),
]);

export const permissionDefs = pgTable("permission_defs", {
	perm: text().primaryKey().notNull(),
	grp: text().notNull(),
	grpLabel: text("grp_label").notNull(),
	label: text().notNull(),
	sort: integer().default(0).notNull(),
	superOnly: boolean("super_only").default(false).notNull(),
});

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	phone: text().notNull(),
	email: text(),
	passwordHash: text("password_hash").notNull(),
	passwordAlgo: text("password_algo").default('bcrypt').notNull(),
	forcePasswordChange: boolean("force_password_change").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: 'date' }),
	disabledAt: timestamp("disabled_at", { withTimezone: true, mode: 'date' }),
}, (table) => [
	unique("users_phone_key").on(table.phone),
	unique("users_email_key").on(table.email),
	check("users_password_algo_check", sql`password_algo = ANY (ARRAY['bcrypt'::text, 'argon2id'::text])`),
]);

export const refreshTokens = pgTable("refresh_tokens", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	tokenHash: text("token_hash").notNull(),
	family: uuid().notNull(),
	client: text().default('web').notNull(),
	userAgent: text("user_agent"),
	ip: text(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'date' }).notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'date' }),
	replacedBy: uuid("replaced_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("refresh_tokens_family_idx").using("btree", table.family.asc().nullsLast().op("uuid_ops")),
	index("refresh_tokens_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "refresh_tokens_user_id_fkey"
		}).onDelete("cascade"),
	unique("refresh_tokens_token_hash_key").on(table.tokenHash),
	check("refresh_tokens_client_check", sql`client = ANY (ARRAY['web'::text, 'mobile'::text])`),
]);

export const stores = pgTable("stores", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ownerId: uuid("owner_id").notNull(),
	name: text().notNull(),
	area: text(),
	lat: doublePrecision(),
	lng: doublePrecision(),
	isOpen: boolean("is_open").default(true).notNull(),
	rating: numeric({ precision: 3, scale:  2 }).default('0').notNull(),
	ratingCount: integer("rating_count").default(0).notNull(),
	deliveryInfo: text("delivery_info"),
	phone: text(),
	imageUrl: text("image_url"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	status: storeStatus().default('pending').notNull(),
	commissionPct: numeric("commission_pct", { precision: 5, scale:  2 }),
	businessCategoryId: uuid("business_category_id"),
}, (table) => [
	index("idx_stores_latlng").using("btree", table.lat.asc().nullsLast().op("float8_ops"), table.lng.asc().nullsLast().op("float8_ops")),
	foreignKey({
			columns: [table.businessCategoryId],
			foreignColumns: [businessCategories.id],
			name: "stores_business_category_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [users.id],
			name: "stores_owner_id_fkey"
		}).onDelete("cascade"),
]);

export const userRoles = pgTable("user_roles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	role: appRole().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_roles_user_id_fkey"
		}).onDelete("cascade"),
	unique("user_roles_user_id_role_key").on(table.userId, table.role),
]);

export const wallets = pgTable("wallets", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	balance: numeric().default('0').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "wallets_user_id_fkey"
		}).onDelete("cascade"),
	unique("wallets_user_id_key").on(table.userId),
	check("wallets_balance_nonneg", sql`balance >= (0)::numeric`),
]);

export const walletTransactions = pgTable("wallet_transactions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	walletId: uuid("wallet_id").notNull(),
	userId: uuid("user_id").notNull(),
	type: walletTxType().notNull(),
	status: walletTxStatus().default('pending').notNull(),
	amount: numeric().notNull(),
	method: text(),
	reference: text(),
	note: text(),
	orderId: uuid("order_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	index("wallet_transactions_user_created_idx").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "wallet_transactions_order_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "wallet_transactions_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.walletId],
			foreignColumns: [wallets.id],
			name: "wallet_transactions_wallet_id_fkey"
		}).onDelete("cascade"),
]);

export const permissionBundleItems = pgTable("permission_bundle_items", {
	bundle: text().notNull(),
	permission: text().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.bundle],
			foreignColumns: [permissionBundles.bundle],
			name: "permission_bundle_items_bundle_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.permission],
			foreignColumns: [permissionDefs.perm],
			name: "permission_bundle_items_permission_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.bundle, table.permission], name: "permission_bundle_items_pkey"}),
]);

export const adminPermissions = pgTable("admin_permissions", {
	userId: uuid("user_id").notNull(),
	permission: text().notNull(),
	grantedBy: uuid("granted_by"),
	grantedAt: timestamp("granted_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.permission],
			foreignColumns: [permissionDefs.perm],
			name: "admin_permissions_permission_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "admin_permissions_user_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.userId, table.permission], name: "admin_permissions_pkey"}),
]);

export const deviceTokens = pgTable("device_tokens", {
	userId: uuid("user_id").notNull(),
	token: text().notNull(),
	platform: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
	lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "device_tokens_user_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.userId, table.token], name: "device_tokens_pkey"}),
	check("device_tokens_platform_check", sql`platform = ANY (ARRAY['android'::text, 'ios'::text, 'web'::text])`),
]);
