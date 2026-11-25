// Safe settings for tests, set before any project file reads them.
process.env.MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/nexthlon_test';
process.env.JWT_SECRET =
  'test-only-secret-that-is-long-enough-for-hs256-signing';
// Short access tokens, long refresh tokens: the same shape as production, just fixed values.
process.env.ACCESS_TOKEN_EXPIRES_IN = '15m';
process.env.REFRESH_TOKEN_EXPIRES_IN = '7d';
process.env.ADMIN_REFRESH_TOKEN_EXPIRES_IN = '1d';
process.env.NODE_ENV = 'test';
// A fixed admin path, so a value in your own .env never changes the tests. A test file can pick
// another one by setting TEST_ADMIN_PATH before it loads this file.
process.env.ADMIN_PATH = process.env.TEST_ADMIN_PATH || '/admin';
// Fake test-mode Razorpay keys. The tests swap in a fake client, so nothing is ever sent to Razorpay.
process.env.RAZORPAY_KEY_ID = 'rzp_test_dummykey';
process.env.RAZORPAY_KEY_SECRET = 'test-key-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test-webhook-secret';
// Photos go to the local disk, so a Cloudinary or bucket login in your own .env is never used by the tests.
// A test file that needs another driver sets it itself before loading the app.
process.env.STORAGE_DRIVER = 'local';

// Test links must use the test server, never the developer's .env origin.
process.env.SITE_URL = '';
