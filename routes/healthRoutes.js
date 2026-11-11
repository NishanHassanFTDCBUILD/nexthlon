// Two checks for hosting platforms, load balancers and uptime monitors. Neither needs a login, and
// neither says anything about the app beyond "up" or "down".
//   GET /healthz  "Is the process alive?"  Always 200 while the server runs. Never touches the
//                 database, so a database outage does not make the platform restart a healthy app.
//   GET /readyz   "Can it take visitors?"  200 when MongoDB answers, 503 when it does not or the
//                 server is shutting down, so the platform stops sending traffic to this copy.
const express = require("express");
const mongoose = require("mongoose");
const lifecycle = require("../utils/lifecycle");

const router = express.Router();
const PING_TIMEOUT_MS = 2000;

// Health answers are never cached, by a browser or a proxy.
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get("/healthz", (req, res) => {
  res.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) });
});

async function databaseUp() {
  if (mongoose.connection.readyState !== 1) return false;
  try {
    await Promise.race([
      mongoose.connection.db.admin().ping(),
      new Promise((resolve, reject) => setTimeout(() => reject(new Error("timeout")), PING_TIMEOUT_MS).unref())
    ]);
    return true;
  } catch {
    return false;
  }
}

router.get("/readyz", async (req, res) => {
  if (lifecycle.isShuttingDown()) return res.status(503).json({ status: "shutting_down" });
  const up = await databaseUp();
  res.status(up ? 200 : 503).json({ status: up ? "ready" : "not_ready", database: up ? "up" : "down" });
});

module.exports = router;
