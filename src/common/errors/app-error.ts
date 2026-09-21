import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * Machine-readable error codes. Clients (web + Flutter) own the Arabic dictionary; the API never
 * returns translated prose. Codes deliberately reuse the old edge-function names where they existed.
 */
export type ErrorCode =
  | "invalid_credentials" | "account_pending" | "account_rejected" | "account_suspended" | "account_deleted"
  | "force_password_change" | "invalid_token" | "token_reused" | "forbidden" | "not_found"
  | "invalid_phone" | "weak_password" | "name_required" | "business_required" | "phone_taken" | "bundle_not_found"
  | "validation" | "cart_empty" | "store_missing" | "store_not_active" | "landmark_required" | "invalid_total"
  | "product_unknown" | "product_out_of_stock" | "wallet_insufficient" | "wallet_missing" | "credit_tx_not_pending"
  | "invalid_status_transition" | "return_not_allowed" | "already_rated" | "file_too_large" | "unsupported_file"
  | "rate_limited" | "conflict" | "internal";

const STATUS: Partial<Record<ErrorCode, HttpStatus>> = {
  invalid_credentials: HttpStatus.UNAUTHORIZED, invalid_token: HttpStatus.UNAUTHORIZED, token_reused: HttpStatus.UNAUTHORIZED,
  account_pending: HttpStatus.FORBIDDEN, account_rejected: HttpStatus.FORBIDDEN, account_suspended: HttpStatus.FORBIDDEN,
  account_deleted: HttpStatus.FORBIDDEN, force_password_change: HttpStatus.FORBIDDEN, forbidden: HttpStatus.FORBIDDEN,
  not_found: HttpStatus.NOT_FOUND, phone_taken: HttpStatus.CONFLICT, conflict: HttpStatus.CONFLICT, already_rated: HttpStatus.CONFLICT,
  product_unknown: HttpStatus.UNPROCESSABLE_ENTITY, product_out_of_stock: HttpStatus.UNPROCESSABLE_ENTITY,
  wallet_insufficient: HttpStatus.UNPROCESSABLE_ENTITY, credit_tx_not_pending: HttpStatus.UNPROCESSABLE_ENTITY,
  invalid_status_transition: HttpStatus.UNPROCESSABLE_ENTITY, return_not_allowed: HttpStatus.UNPROCESSABLE_ENTITY,
  file_too_large: HttpStatus.PAYLOAD_TOO_LARGE, unsupported_file: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  rate_limited: HttpStatus.TOO_MANY_REQUESTS, internal: HttpStatus.INTERNAL_SERVER_ERROR,
};

export class AppError extends HttpException {
  constructor(public readonly code: ErrorCode, public readonly details?: Record<string, unknown>, status?: HttpStatus) {
    super({ error: code, ...(details ? { details } : {}) }, status ?? STATUS[code] ?? HttpStatus.BAD_REQUEST);
  }
}
