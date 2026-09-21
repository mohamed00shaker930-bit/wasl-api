/**
 * Permission catalog. The codes below are the ones the original admin UI checks
 * (`users.create`, `users.edit`, `users.suspend`, `users.notify`, `users.wallet_grant`, `stores.manage`, `oversight.view`)
 * plus one code per admin area so every endpoint can carry a @Perms() guard.
 * When the Phase 0 dump exists, `permission_defs` rows from it take precedence (this seed only upserts).
 */
export const PERMISSION_DEFS = [
  { grp: "users", grpLabel: "المستخدمون", perm: "users.view", label: "عرض المستخدمين", sort: 10, superOnly: false },
  { grp: "users", grpLabel: "المستخدمون", perm: "users.create", label: "إنشاء حسابات", sort: 11, superOnly: false },
  { grp: "users", grpLabel: "المستخدمون", perm: "users.edit", label: "تعديل الملفات", sort: 12, superOnly: false },
  { grp: "users", grpLabel: "المستخدمون", perm: "users.suspend", label: "إيقاف/تفعيل الحسابات", sort: 13, superOnly: false },
  { grp: "users", grpLabel: "المستخدمون", perm: "users.notify", label: "إرسال إشعارات", sort: 14, superOnly: false },
  { grp: "users", grpLabel: "المستخدمون", perm: "users.wallet_grant", label: "منح رصيد محفظة", sort: 15, superOnly: false },
  { grp: "requests", grpLabel: "الطلبات", perm: "requests.decide", label: "البت في طلبات التسجيل", sort: 20, superOnly: false },
  { grp: "requests", grpLabel: "الطلبات", perm: "resets.decide", label: "البت في طلبات استعادة كلمة المرور", sort: 21, superOnly: false },
  { grp: "stores", grpLabel: "المتاجر", perm: "stores.manage", label: "إدارة المتاجر والعمولات", sort: 30, superOnly: false },
  { grp: "orders", grpLabel: "الطلبات", perm: "orders.view", label: "عرض الطلبات", sort: 40, superOnly: false },
  { grp: "finance", grpLabel: "المالية", perm: "wallets.manage", label: "اعتماد شحن المحافظ", sort: 50, superOnly: false },
  { grp: "finance", grpLabel: "المالية", perm: "kpis.view", label: "مؤشرات الأداء والتحليلات", sort: 51, superOnly: false },
  { grp: "content", grpLabel: "المحتوى", perm: "library.manage", label: "إدارة مكتبة المنتجات", sort: 60, superOnly: false },
  { grp: "content", grpLabel: "المحتوى", perm: "content.manage", label: "البانرات وأنواع الأعمال", sort: 61, superOnly: false },
  { grp: "content", grpLabel: "المحتوى", perm: "broadcast.send", label: "إرسال تعميم", sort: 62, superOnly: false },
  { grp: "oversight", grpLabel: "الرقابة", perm: "oversight.view", label: "سجل التدقيق والجلسات", sort: 70, superOnly: false },
  { grp: "settings", grpLabel: "الإعدادات", perm: "settings.manage", label: "إعدادات التطبيق", sort: 80, superOnly: true },
  { grp: "team", grpLabel: "الفريق", perm: "team.manage", label: "فريق الإدارة والصلاحيات", sort: 90, superOnly: true },
] as const;

export const PERMISSION_BUNDLES: { bundle: string; label: string; sort: number; perms: string[] }[] = [
  { bundle: "operations", label: "العمليات", sort: 1, perms: ["users.view", "users.edit", "requests.decide", "stores.manage", "orders.view", "library.manage", "content.manage"] },
  { bundle: "support", label: "الدعم", sort: 2, perms: ["users.view", "users.notify", "resets.decide", "orders.view", "oversight.view"] },
  { bundle: "finance", label: "المالية", sort: 3, perms: ["users.view", "wallets.manage", "users.wallet_grant", "kpis.view", "orders.view"] },
];
