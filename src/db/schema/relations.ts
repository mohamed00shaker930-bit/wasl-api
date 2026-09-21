import { relations } from "drizzle-orm/relations";
import { stores, banners, users, creditAccounts, categories, creditTransactions, orders, customProductRequests, catalogCategories, catalogItems, favorites, locations, customerRatings, notifications, orderItems, products, posIngestLog, productOffers, pendingCustomers, ratings, businessCategories, profiles, refreshTokens, userRoles, wallets, walletTransactions, permissionBundles, permissionBundleItems, permissionDefs, adminPermissions, deviceTokens } from "./tables";

export const bannersRelations = relations(banners, ({one}) => ({
	store: one(stores, {
		fields: [banners.storeId],
		references: [stores.id]
	}),
}));

export const storesRelations = relations(stores, ({one, many}) => ({
	banners: many(banners),
	creditAccounts: many(creditAccounts),
	categories: many(categories),
	customProductRequests: many(customProductRequests),
	customerRatings: many(customerRatings),
	orders: many(orders),
	posIngestLogs: many(posIngestLog),
	productOffers: many(productOffers),
	pendingCustomers: many(pendingCustomers),
	ratings: many(ratings),
	products: many(products),
	businessCategory: one(businessCategories, {
		fields: [stores.businessCategoryId],
		references: [businessCategories.id]
	}),
	user: one(users, {
		fields: [stores.ownerId],
		references: [users.id]
	}),
}));

export const creditAccountsRelations = relations(creditAccounts, ({one, many}) => ({
	user: one(users, {
		fields: [creditAccounts.customerId],
		references: [users.id]
	}),
	store: one(stores, {
		fields: [creditAccounts.storeId],
		references: [stores.id]
	}),
	creditTransactions: many(creditTransactions),
}));

export const usersRelations = relations(users, ({many}) => ({
	creditAccounts: many(creditAccounts),
	favorites: many(favorites),
	locations: many(locations),
	notifications: many(notifications),
	orders: many(orders),
	ratings: many(ratings),
	profiles: many(profiles),
	refreshTokens: many(refreshTokens),
	stores: many(stores),
	userRoles: many(userRoles),
	wallets: many(wallets),
	walletTransactions: many(walletTransactions),
	deviceTokens: many(deviceTokens),
}));

export const categoriesRelations = relations(categories, ({one, many}) => ({
	store: one(stores, {
		fields: [categories.storeId],
		references: [stores.id]
	}),
	products: many(products),
}));

export const creditTransactionsRelations = relations(creditTransactions, ({one}) => ({
	creditAccount: one(creditAccounts, {
		fields: [creditTransactions.accountId],
		references: [creditAccounts.id]
	}),
	order: one(orders, {
		fields: [creditTransactions.orderId],
		references: [orders.id]
	}),
}));

export const ordersRelations = relations(orders, ({one, many}) => ({
	creditTransactions: many(creditTransactions),
	customProductRequests: many(customProductRequests),
	customerRatings: many(customerRatings),
	orderItems: many(orderItems),
	user: one(users, {
		fields: [orders.customerId],
		references: [users.id]
	}),
	store: one(stores, {
		fields: [orders.storeId],
		references: [stores.id]
	}),
	ratings: many(ratings),
	walletTransactions: many(walletTransactions),
}));

export const customProductRequestsRelations = relations(customProductRequests, ({one}) => ({
	order: one(orders, {
		fields: [customProductRequests.orderId],
		references: [orders.id]
	}),
	store: one(stores, {
		fields: [customProductRequests.storeId],
		references: [stores.id]
	}),
}));

export const catalogItemsRelations = relations(catalogItems, ({one}) => ({
	catalogCategory: one(catalogCategories, {
		fields: [catalogItems.categoryId],
		references: [catalogCategories.id]
	}),
}));

export const catalogCategoriesRelations = relations(catalogCategories, ({many}) => ({
	catalogItems: many(catalogItems),
}));

export const favoritesRelations = relations(favorites, ({one}) => ({
	user: one(users, {
		fields: [favorites.userId],
		references: [users.id]
	}),
}));

export const locationsRelations = relations(locations, ({one}) => ({
	user: one(users, {
		fields: [locations.userId],
		references: [users.id]
	}),
}));

export const customerRatingsRelations = relations(customerRatings, ({one}) => ({
	order: one(orders, {
		fields: [customerRatings.orderId],
		references: [orders.id]
	}),
	store: one(stores, {
		fields: [customerRatings.storeId],
		references: [stores.id]
	}),
}));

export const notificationsRelations = relations(notifications, ({one}) => ({
	user: one(users, {
		fields: [notifications.userId],
		references: [users.id]
	}),
}));

export const orderItemsRelations = relations(orderItems, ({one}) => ({
	order: one(orders, {
		fields: [orderItems.orderId],
		references: [orders.id]
	}),
	product: one(products, {
		fields: [orderItems.productId],
		references: [products.id]
	}),
}));

export const productsRelations = relations(products, ({one, many}) => ({
	orderItems: many(orderItems),
	productOffers: many(productOffers),
	category: one(categories, {
		fields: [products.categoryId],
		references: [categories.id]
	}),
	store: one(stores, {
		fields: [products.storeId],
		references: [stores.id]
	}),
}));

export const posIngestLogRelations = relations(posIngestLog, ({one}) => ({
	store: one(stores, {
		fields: [posIngestLog.storeId],
		references: [stores.id]
	}),
}));

export const productOffersRelations = relations(productOffers, ({one}) => ({
	product: one(products, {
		fields: [productOffers.productId],
		references: [products.id]
	}),
	store: one(stores, {
		fields: [productOffers.storeId],
		references: [stores.id]
	}),
}));

export const pendingCustomersRelations = relations(pendingCustomers, ({one}) => ({
	store: one(stores, {
		fields: [pendingCustomers.storeId],
		references: [stores.id]
	}),
}));

export const ratingsRelations = relations(ratings, ({one}) => ({
	user: one(users, {
		fields: [ratings.customerId],
		references: [users.id]
	}),
	order: one(orders, {
		fields: [ratings.orderId],
		references: [orders.id]
	}),
	store: one(stores, {
		fields: [ratings.storeId],
		references: [stores.id]
	}),
}));

export const profilesRelations = relations(profiles, ({one, many}) => ({
	businessCategory: one(businessCategories, {
		fields: [profiles.businessCategoryId],
		references: [businessCategories.id]
	}),
	user: one(users, {
		fields: [profiles.id],
		references: [users.id]
	}),
	adminPermissions: many(adminPermissions),
}));

export const businessCategoriesRelations = relations(businessCategories, ({many}) => ({
	profiles: many(profiles),
	stores: many(stores),
}));

export const refreshTokensRelations = relations(refreshTokens, ({one}) => ({
	user: one(users, {
		fields: [refreshTokens.userId],
		references: [users.id]
	}),
}));

export const userRolesRelations = relations(userRoles, ({one}) => ({
	user: one(users, {
		fields: [userRoles.userId],
		references: [users.id]
	}),
}));

export const walletsRelations = relations(wallets, ({one, many}) => ({
	user: one(users, {
		fields: [wallets.userId],
		references: [users.id]
	}),
	walletTransactions: many(walletTransactions),
}));

export const walletTransactionsRelations = relations(walletTransactions, ({one}) => ({
	order: one(orders, {
		fields: [walletTransactions.orderId],
		references: [orders.id]
	}),
	user: one(users, {
		fields: [walletTransactions.userId],
		references: [users.id]
	}),
	wallet: one(wallets, {
		fields: [walletTransactions.walletId],
		references: [wallets.id]
	}),
}));

export const permissionBundleItemsRelations = relations(permissionBundleItems, ({one}) => ({
	permissionBundle: one(permissionBundles, {
		fields: [permissionBundleItems.bundle],
		references: [permissionBundles.bundle]
	}),
	permissionDef: one(permissionDefs, {
		fields: [permissionBundleItems.permission],
		references: [permissionDefs.perm]
	}),
}));

export const permissionBundlesRelations = relations(permissionBundles, ({many}) => ({
	permissionBundleItems: many(permissionBundleItems),
}));

export const permissionDefsRelations = relations(permissionDefs, ({many}) => ({
	permissionBundleItems: many(permissionBundleItems),
	adminPermissions: many(adminPermissions),
}));

export const adminPermissionsRelations = relations(adminPermissions, ({one}) => ({
	permissionDef: one(permissionDefs, {
		fields: [adminPermissions.permission],
		references: [permissionDefs.perm]
	}),
	profile: one(profiles, {
		fields: [adminPermissions.userId],
		references: [profiles.id]
	}),
}));

export const deviceTokensRelations = relations(deviceTokens, ({one}) => ({
	user: one(users, {
		fields: [deviceTokens.userId],
		references: [users.id]
	}),
}));