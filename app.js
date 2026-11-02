const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const config = require("./config/env");
const { viewLocals } = require("./middleware/viewLocals");
const { attachUser } = require("./middleware/auth");
const { originCheck } = require("./middleware/originCheck");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const app = express();
app.disable("x-powered-by");
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Security headers. The Content Security Policy only allows our own scripts and styles,
// Google Fonts, and product photos from Unsplash.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
      "font-src": ["'self'", "https://fonts.gstatic.com"],
      "img-src": ["'self'", "data:", "https://images.unsplash.com"],
      "connect-src": ["'self'"],
      "form-action": ["'self'"],
      "frame-ancestors": ["'none'"],
      "upgrade-insecure-requests": config.isProduction ? [] : null
    }
  }
}));

app.use(express.static(path.join(__dirname, "public"), { maxAge: config.isProduction ? "7d" : 0 }));
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(cookieParser());
app.use(viewLocals);
app.use(attachUser);

// JSON API
app.get("/api/health", (req, res) => res.json({ status: "ok", app: "Nexthlon API" }));
app.use("/api", originCheck);
app.use("/api", require("./routes/authRoutes"));
app.use("/api", require("./routes/productRoutes"));
app.use("/api/profile", require("./routes/profileRoutes"));
app.use("/api/addresses", require("./routes/addressRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));

// EJS pages
app.use("/", require("./routes/pageRoutes"));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
