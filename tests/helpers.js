// Safe settings for tests, set before any project file reads them.
process.env.MONGODB_URI = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/nexthlon_test";
process.env.JWT_SECRET = "test-only-secret-that-is-long-enough-for-hs256-signing";
process.env.JWT_EXPIRES_IN = "1h";
process.env.NODE_ENV = "test";
