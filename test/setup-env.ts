// Environment for e2e runs; everything else comes from .env.example semantics.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://wasl:wasl@127.0.0.1:55432/wasl_test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-test-refresh-secret";
process.env.STORAGE_DRIVER = "disk";
process.env.DISK_STORAGE_ROOT = "./.files-test";
process.env.CORS_ORIGINS = "";
