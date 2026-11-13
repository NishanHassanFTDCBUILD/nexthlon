const config = require("../config/env");
const dashboardService = require("../services/dashboardService");
const analyticsService = require("../services/analyticsService");
const productService = require("../services/productService");
const profileService = require("../services/profileService");
const adminService = require("../services/adminService");
const adminProductService = require("../services/adminProductService");
const cartService = require("../services/cartService");
const homeService = require("../services/homeService");
const checkoutService = require("../services/checkoutService");
const orderService = require("../services/orderService");
const invoiceService = require("../services/invoiceService");
const razorpayService = require("../services/razorpayService");
const walletService = require("../services/walletService");
const referralService = require("../services/referralService");
const settingsService = require("../services/settingsService");
const twoFactorService = require("../services/twoFactorService");
const accountService = require("../services/accountService");
const reviewService = require("../services/reviewService");
const recommendationService = require("../services/recommendationService");
const searchInsightService = require("../services/searchInsightService");
const orderRules = require("../utils/orderRules");
const Category = require("../models/Category");
const Address = require("../models/Address");
const { readGuestCart } = require("../middleware/guestCart");
const { CONTACT_TOPICS, STORE } = require("../config/store");
const { INDIAN_STATES, LOW_STOCK_LIMIT, MAX_ADDRESSES } = require("../config/catalog");
const { HttpError, asyncHandler, safeNextPath } = require("../utils/http");
const { linkBuilder } = require("../utils/queryString");

// ---------- Store pages ----------

const home = asyncHandler(async (req, res) => {
  const data = await homeService.getHomePage();
  res.render("pages/home", { title: "Nexthlon | Your Next Move Starts Here", ...data });
});

// ---------- Store information and policy pages ----------

const INFO_PAGES = {
  about: { view: "pages/about", title: "About us" },
  contact: { view: "pages/contact", title: "Contact us" },
  privacy: { view: "pages/privacy", title: "Privacy policy" },
  terms: { view: "pages/terms", title: "Terms and conditions" },
  refund: { view: "pages/refund-policy", title: "Cancellation and refund policy" },
  shipping: { view: "pages/shipping-policy", title: "Shipping and delivery policy" }
};

// One handler per page, e.g. infoPage("privacy").
function infoPage(key) {
  const page = INFO_PAGES[key];
  return function renderInfoPage(req, res) {
    res.render(page.view, { title: `${page.title} | Nexthlon`, pageKey: key, topics: CONTACT_TOPICS });
  };
}

const rupeeText = value => `₹${Number(value).toLocaleString("en-IN")}`;

const products = asyncHandler(async (req, res) => {
  const result = await productService.listProducts(req.query);
  const categories = await productService.getCategorySummaries();
  const { q, brands, sizes, colours, min, max, discount, rating, inStock, sort, view } = result.filters;
  const category = result.category;
  // A misspelt search that found nothing as typed shows the corrected words ("Results for \"shoes\"")
  // with a note about what was typed.
  const corrected = result.correctedQuery;
  // Counted for "Trending searches" (words and result count only, never who searched); first page only.
  if (q && result.pagination.page === 1) searchInsightService.record(q, result.pagination.total);
  const heading = q ? `Results for "${corrected || q}"` : category ? category.name : "All sports gear";
  // Every filter lives in the URL, so a filtered page can be bookmarked, shared or reloaded.
  const link = linkBuilder("/products", {
    q,
    category: category ? category.slug : "",
    brand: brands,
    size: sizes,
    colour: colours,
    min,
    max,
    discount: discount || "",
    rating: rating || "",
    inStock: inStock ? "1" : "",
    sort: sort === "relevance" ? "" : sort,
    view: view === "list" ? "list" : ""
  });

  // Removable chips for each active filter.
  const chips = [];
  if (q) chips.push({ label: `"${q}"`, href: link({ q: "", page: "" }) });
  if (category) chips.push({ label: category.name, href: link({ category: "", page: "" }) });
  brands.forEach(name => chips.push({ label: name, href: link({ brand: brands.filter(b => b !== name), page: "" }) }));
  sizes.forEach(name => chips.push({ label: `Size ${name}`, href: link({ size: sizes.filter(s => s !== name), page: "" }) }));
  colours.forEach(name => chips.push({ label: name, href: link({ colour: colours.filter(c => c !== name), page: "" }) }));
  if (min !== null) chips.push({ label: `From ${rupeeText(min)}`, href: link({ min: "", page: "" }) });
  if (max !== null) chips.push({ label: `Up to ${rupeeText(max)}`, href: link({ max: "", page: "" }) });
  if (discount) chips.push({ label: `${discount}% off or more`, href: link({ discount: "", page: "" }) });
  if (rating) chips.push({ label: `${rating}★ and up`, href: link({ rating: "", page: "" }) });
  if (inStock) chips.push({ label: "In stock", href: link({ inStock: "", page: "" }) });

  res.render("pages/products", {
    title: `${heading} | Nexthlon`,
    heading,
    correctedQuery: corrected,
    categories,
    sorts: productService.SORTS,
    discountSteps: productService.DISCOUNT_STEPS,
    ratingSteps: productService.RATING_STEPS,
    link,
    chips,
    ...result
  });
});

const productDetail = asyncHandler(async (req, res) => {
  const product = await productService.getProduct(req.params.slug);
  if (!product) throw new HttpError(404, "That product is no longer available.");
  // Signed-in customers get it added to their recently viewed products (synced to the account).
  if (req.user && req.user.role === "customer") {
    accountService.recordView(req.user._id, product._id).catch(() => {});
  }
  const customer = req.user && req.user.role === "customer" ? req.user : null;
  const [related, reviews, reviewStatus, featured, shipTo, inCart, codLimit, together] = await Promise.all([
    productService.getRelatedProducts(product),
    reviewService.listReviews(product._id, 1, req.user && req.user.role === "customer" ? req.user._id : null),
    reviewService.reviewStatus(req.user || null, product._id),
    reviewService.featuredReview(product._id),
    // "Deliver to ..." uses the customer's default address (or their newest one).
    customer ? Address.findOne({ user: customer._id }).sort({ isDefault: -1, updatedAt: -1 }).select("fullName city pincode").lean() : null,
    // How many of this product are already in the customer's cart. Not for guests: a signed-out product page
    // is the same for everyone, so a CDN may keep it (middleware/publicCache.js).
    customer ? cartService.quantityInCart(customer._id, product._id) : 0,
    settingsService.get("codLimit"),
    // "Frequently bought together", from real orders (empty until there are some).
    recommendationService.boughtTogether(product._id, 4)
  ]);
  // Bought together first; the related row then skips those, so no product shows twice.
  const togetherProducts = together.map(entry => entry.product);
  const togetherIds = new Set(togetherProducts.map(p => String(p._id)));
  res.render("pages/product", {
    title: `${product.name} | Nexthlon`,
    metaDescription: (product.description || product.name).slice(0, 155),
    product,
    offer: productService.offerLabel(product),
    related: related.filter(p => !togetherIds.has(String(p._id))),
    together: togetherProducts,
    reviews,
    reviewStatus,
    featured,
    shipTo,
    inCart,
    codLimit,
    codAvailable: settingsService.codAllowedFor(product.price, codLimit)
  });
});

// ---------- Account pages ----------

// /login and /signup share one page whose card flips between the two forms.
// /signup?ref=CODE fills in a friend's referral code.
function authPage(mode) {
  return asyncHandler(async (req, res) => {
    const ref = referralService.normaliseCode(req.query.ref);
    res.render("pages/auth", {
      title: mode === "signup" ? "Create your account | Nexthlon" : "Sign in | Nexthlon",
      mode,
      next: safeNextPath(req.query.next, "/"),
      reason: req.query.reason,
      referralCode: referralService.CODE.test(ref) ? ref : "",
      referralReward: await settingsService.get("referralReward")
    });
  });
}
const login = authPage("login");
const signup = authPage("signup");

const wallet = asyncHandler(async (req, res) => {
  const [data, referral] = await Promise.all([
    walletService.getWallet(req.user._id, req.query),
    referralService.getReferral(req.user, `${req.protocol}://${req.get("host")}`)
  ]);
  const link = linkBuilder("/wallet", { type: data.filters.type === "all" ? "" : data.filters.type });
  res.render("pages/wallet", { title: "Your wallet | Nexthlon", ...data, referral, link });
});

const profile = asyncHandler(async (req, res) => {
  const addresses = await profileService.listAddresses(req.user._id);
  res.render("pages/profile", { title: "Your account | Nexthlon", addresses, states: INDIAN_STATES, maxAddresses: MAX_ADDRESSES });
});

// Customers see their account's cart, guests the cart kept by their cookie (checkout asks them to sign in).
const cart = asyncHandler(async (req, res) => {
  const owner = req.user ? req.user._id : (readGuestCart(req) ? { guest: readGuestCart(req) } : null);
  const data = await cartService.getCart(owner);
  // "Customers also bought": products often ordered with what is in the cart.
  const alsoBought = data.items.length ? await recommendationService.forCart(data.items.map(item => item.productId), 4) : [];
  res.render("pages/cart", { title: "Your cart | Nexthlon", checkoutOpen: true, alsoBought, ...data });
});

// ---------- Checkout and orders ----------

// /checkout buys the cart; /checkout?buy=now buys only the "Buy now" product (the cart is untouched).
// Both use the same steps and the same payment options.
const checkout = asyncHandler(async (req, res) => {
  const source = req.query.buy === "now" ? "buynow" : "cart";
  const [quote, addresses] = await Promise.all([
    checkoutService.buildQuote(req.user._id, { source }),
    profileService.listAddresses(req.user._id)
  ]);
  // Nothing to buy: back to the cart, which explains why.
  if (!quote.lines.length) return res.redirect("/cart");
  return res.render("pages/checkout", {
    title: source === "buynow" ? "Buy now | Nexthlon" : "Checkout | Nexthlon",
    quote,
    buyNow: source === "buynow",
    addresses,
    states: INDIAN_STATES,
    razorpayEnabled: razorpayService.isEnabled()
  });
});

const orders = asyncHandler(async (req, res) => {
  const data = await orderService.listOrders(req.user._id, req.query);
  const { status, period, q } = data.filters;
  const link = linkBuilder("/orders", { status: status === "all" ? "" : status, period: period === "all" ? "" : period, q });
  res.render("pages/orders", { title: "Your orders | Nexthlon", link, labels: orderRules.STATUS_LABELS, ...data });
});

const orderDetail = asyncHandler(async (req, res) => {
  const order = await orderService.getOwnedOrder(req.user._id, req.params.orderId);
  res.render("pages/order", {
    title: `Order ${order.orderId} | Nexthlon`,
    order,
    timeline: orderService.timelineFor(order),
    labels: orderRules.STATUS_LABELS,
    canCancel: order.items.some(orderRules.canCancelItem),
    canReturn: orderRules.canRequestReturn(order, STORE.returnDays),
    canRetryPayment: razorpayService.isEnabled() && order.paymentMethod === "razorpay" && ["pending", "failed"].includes(order.paymentStatus) && order.orderStatus !== "cancelled",
    cancelReasons: orderRules.CANCEL_REASONS,
    returnReasons: orderRules.RETURN_REASONS
  });
});

const orderSuccess = asyncHandler(async (req, res) => {
  const order = await orderService.getOwnedOrder(req.user._id, req.params.orderId);
  res.render("pages/order-success", { title: "Order placed | Nexthlon", order });
});

const orderInvoice = asyncHandler(async (req, res) => {
  const order = await orderService.getOwnedOrder(req.user._id, req.params.orderId);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${invoiceService.invoiceNumber(order)}.pdf"`);
  invoiceService.writeInvoice(order, res);
});

// ---------- Admin pages ----------

function adminLogin(req, res) {
  const home = `${config.adminPath}/dashboard`;
  const next = safeNextPath(req.query.next, home);
  res.render("admin/login", {
    title: "Admin sign in | Nexthlon",
    // After signing in, only pages inside the console are allowed as the next stop.
    next: next.toLowerCase().startsWith(`${config.adminPath}/`) ? next : home,
    reason: req.query.reason
  });
}

const adminDashboard = asyncHandler(async (req, res) => {
  const data = await dashboardService.dashboard(req.query);
  res.render("admin/dashboard", { title: "Dashboard | Nexthlon Admin", ...data, statusLabels: orderRules.STATUS_LABELS });
});

// Analytics. Every number comes from the service; the page only draws it.
const adminAnalytics = asyncHandler(async (req, res) => {
  const data = await analyticsService.analytics(req.query);
  const current = { range: data.range.key, by: data.group.key === "auto" ? "" : data.group.key, from: data.range.fromDay, to: data.range.toDay };
  res.render("admin/analytics", {
    title: "Analytics | Nexthlon Admin",
    ...data,
    ranges: dashboardService.RANGE_LABELS,
    paymentLabels: { razorpay: "Razorpay", wallet: "Wallet", cod: "Cash on delivery" },
    link: linkBuilder(`${config.adminPath}/analytics`, current),
    exportQuery: new URLSearchParams(Object.entries(current).filter(([, v]) => v)).toString()
  });
});

// Settings: what an admin may change, plus the fixed rules, so the page explains the whole store.
// The admin's own security: two-step login (set up, turn off, recovery codes).
const adminSecurity = asyncHandler(async (req, res) => {
  res.render("admin/security", {
    title: "Security | Nexthlon Admin",
    twoFactor: await twoFactorService.status(req.user._id),
    required: config.adminRequire2fa,
    reason: req.query.reason
  });
});

const adminSettings = asyncHandler(async (req, res) => {
  res.render("admin/settings", {
    title: "Settings | Nexthlon Admin",
    settings: await settingsService.getAll(),
    lowStockLimit: LOW_STOCK_LIMIT,
    maxPerProduct: cartService.MAX_PER_PRODUCT,
    maxAddresses: MAX_ADDRESSES
  });
});

const adminUsers = asyncHandler(async (req, res) => {
  const data = await adminService.listCustomers(req.query);
  const link = linkBuilder(`${config.adminPath}/customers`, {
    q: data.filters.q,
    status: data.filters.status === "all" ? "" : data.filters.status
  });
  res.render("admin/users", { title: "Customers | Nexthlon Admin", link, ...data });
});

const adminProducts = asyncHandler(async (req, res) => {
  const data = await adminProductService.listAdminProducts(req.query);
  const { q, category, status, sort } = data.filters;
  const link = linkBuilder(`${config.adminPath}/products`, {
    q, category, status: status === "all" ? "" : status, sort: sort === "newest" ? "" : sort
  });
  res.render("admin/products", {
    title: "Products | Nexthlon Admin",
    link,
    categories: await Category.find().sort({ sortOrder: 1, name: 1 }).select("name").lean(),
    sorts: adminProductService.ADMIN_SORTS,
    ...data
  });
});

const adminProductNew = asyncHandler(async (req, res) => {
  const categories = await Category.find().sort({ sortOrder: 1, name: 1 }).select("name isListed").lean();
  res.render("admin/product-form", { title: "Add product | Nexthlon Admin", product: null, categories });
});

const adminProductEdit = asyncHandler(async (req, res) => {
  const product = await adminProductService.getAdminProduct(req.params.productId);
  const categories = await Category.find().sort({ sortOrder: 1, name: 1 }).select("name isListed").lean();
  res.render("admin/product-form", { title: `Edit ${product.name} | Nexthlon Admin`, product, categories });
});

module.exports = {
  home,
  infoPage,
  products,
  productDetail,
  login,
  signup,
  profile,
  cart,
  checkout,
  orders,
  wallet,
  orderDetail,
  orderSuccess,
  orderInvoice,
  adminLogin,
  adminDashboard,
  adminAnalytics,
  adminUsers,
  adminSettings,
  adminSecurity,
  adminProducts,
  adminProductNew,
  adminProductEdit
};
