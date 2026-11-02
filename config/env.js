require("dotenv").config();

const DURATION = /^(\d{1,4})([smhd])$/;
const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

function durationToMs(value) {
  const [, count, unit] = value.match(DURATION);
  return Number(count) * UNIT_MS[unit];
}

function readConfig() {
  const isProduction = process.env.NODE_ENV === "production";

  const mongoUri = process.env.MONGODB_URI || "";
  if (!mongoUri) {
    throw new Error("MONGODB_URI is missing. Copy .env.example to .env and set it.");
  }

  const jwtSecret = process.env.JWT_SECRET || "";
  if (Buffer.byteLength(jwtSecret) < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters. See .env.example for how to make one.");
  }

  const jwtExpiresIn = process.env.JWT_EXPIRES_IN || "1d";
  if (!DURATION.test(jwtExpiresIn) || durationToMs(jwtExpiresIn) > 7 * UNIT_MS.d) {
    throw new Error("JWT_EXPIRES_IN must look like 30m, 12h or 1d, and be 7 days or less.");
  }

  return {
    isProduction,
    port: Number(process.env.PORT) || 3000,
    mongoUri,
    jwtSecret,
    jwtExpiresIn,
    jwtExpiresInMs: durationToMs(jwtExpiresIn),
    // Browsers only send Secure cookies over HTTPS, so this stays off for http://localhost.
    cookieSecure: isProduction || process.env.COOKIE_SECURE === "true"
  };
}

module.exports = readConfig();
