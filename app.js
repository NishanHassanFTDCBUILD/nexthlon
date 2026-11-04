const path = require("path");
const express = require("express");
//. It sets various HTTP security headers to help protect our website against common browser-based attacks.
const helmet = require("helmet");
//Load the tool that reads cookies into req.cookies. We need it to read the JWT cookie.
const cookieParser = require("cookie-parser");
const config = require("./config/env");
const { viewLocals, navCategories } = require("./middleware/viewLocals");
const { attachUser } = require("./middleware/auth");
const { cartCount } = require("./middleware/cartCount");
const { originCheck } = require("./middleware/originCheck");
const { noCache } = require("./middleware/noCache");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const app = express();
//Hide the header that says "Express", so attackers learn less.
app.disable("x-powered-by");
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Security headers. The Content Security Policy only allows our own scripts and styles,
// Google Fonts, and product photos from Unsplash.
app.use(helmet({
  //enables CSP configuration
  contentSecurityPolicy: {
    //contains rules that control where different resources can come from.
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
      "font-src": ["'self'", "https://fonts.gstatic.com"],
      "img-src": ["'self'", "data:", "https://images.unsplash.com"],
      //Controls where JavaScript can connect to fetch data.
      "connect-src": ["'self'"],
      //Controls where HTML forms are allowed to submit data.
      "form-action": ["'self'"],
      //Controls whether another website can embed Nexthlon inside an iframe.
      "frame-ancestors": ["'none'"],
      //"Upgrade-insecure-requests is enabled only in production. It instructs the browser to upgrade insecure HTTP resource requests to HTTPS, improving transport security."
      "upgrade-insecure-requests": config.isProduction ? [] : null
    }
  }
}));

app.use(express.static(path.join(__dirname, "public"), { maxAge: config.isProduction ? "7d" : 0 }));
// Everything after the static files (API replies, EJS pages, error pages) is never cached.
// Static files are served above, so CSS, JS and images keep their normal caching.
app.use(noCache);
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(cookieParser());
app.use(viewLocals);
app.use(attachUser);
app.use(cartCount);
app.use(navCategories);

// JSON API
app.get("/api/health", (req, res) => res.json({ status: "ok", app: "Nexthlon API" }));
app.use("/api", originCheck);
app.use("/api", require("./routes/authRoutes"));
app.use("/api", require("./routes/productRoutes"));
app.use("/api/profile", require("./routes/profileRoutes"));
app.use("/api/addresses", require("./routes/addressRoutes"));
app.use("/api/cart", require("./routes/cartRoutes"));
app.use("/api/wishlist", require("./routes/wishlistRoutes"));
app.use("/api", require("./routes/orderRoutes"));
app.use("/api", require("./routes/contactRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));

// EJS pages
app.use("/", require("./routes/pageRoutes"));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
