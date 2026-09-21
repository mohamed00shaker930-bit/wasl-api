/** Access-token payload. Everything authorization needs is here so no request does a DB round-trip for it. */
export type AppRole = "customer" | "merchant" | "super_admin" | "admin" | "operations" | "support" | "finance";

export interface Claims {
  sub: string;            // users.id
  phone: string;
  roles: AppRole[];
  perms: string[];        // admin_permissions.permission for staff
  super: boolean;         // super_admin
  staff: boolean;         // any non customer/merchant role
  store_id?: string;      // merchant's store (owner_id = sub), if any
  fpc: boolean;           // force_password_change
  iat?: number;
  exp?: number;
}
