// Safe settings for tests, set before any project file reads them.
process.env.MONGODB_URI = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/nexthlon_test";
process.env.JWT_SECRET = "test-only-secret-that-is-long-enough-for-hs256-signing";
process.env.JWT_EXPIRES_IN = "1h";
process.env.NODE_ENV = "test";
// A fixed admin path, so a value in your own .env never changes the tests. A test file can pick
// another one by setting TEST_ADMIN_PATH before it loads this file.
process.env.ADMIN_PATH = process.env.TEST_ADMIN_PATH || "/admin";
// Fake test-mode Razorpay keys. The tests swap in a fake client, so nothing is ever sent to Razorpay.
process.env.RAZORPAY_KEY_ID = "rzp_test_dummykey";
process.env.RAZORPAY_KEY_SECRET = "test-key-secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "test-webhook-secret";
