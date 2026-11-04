const productService = require("../services/productService");
const profileService = require("../services/profileService");
const adminService = require("../services/adminService");
const adminProductService = require("../services/adminProductService");
const cartService = require("../services/cartService");
const homeService = require("../services/homeService");
const reviewService = require("../services/reviewService");
const wishlistService = require("../services/wishlistService");
const checkoutService = require("../services/checkoutService");
const orderService = require("../services/orderService");
const invoiceService = require("../services/invoiceService");
const razorpayService = require("../services/razorpayService");
const walletService = require("../services/walletService");
const referralService = require("../services/referralService");
const settingsService = require("../services/settingsService");
const orderRules = require("../utils/orderRules");
const Category = require("../models/Category");
const { CONTACT_TOPICS, STORE } = require("../config/store");
const { INDIAN_STATES } = require("../config/catalog");
const { HttpError, asyncHandler, safeNextPath } = require("../utils/http");
const { linkBuilder } = require("../utils/queryString");

// ---------- Store pages ----------

const home = asyncHandler(async (req, res) => {
  const data = await homeService.getHomePage();
  res.render("pages/home", { title: "Nexthlon | Your Next Move Starts Here", ...data });
});

const wishlist = asyncHandler(async (req, res) => {
  const data = await wishlistService.getWishlist(req.user._id);
  res.render("pages/wishlist", { title: "Your wishlist | Nexthlon", ...data });
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
  const { q, brands, min, max, discount, rating, inStock, sort, view } = result.filters;
  const category = result.category;
  const heading = q ? `Results for "${q}"` : category ? category.name : "All sports gear";
  // Every filter lives in the URL, so a filtered page can be bookmarked, shared or reloaded.
  const link = linkBuilder("/products", {
    q,
    category: category ? category.slug : "",
    brand: brands,
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
  if (min !== null) chips.push({ label: `From ${rupeeText(min)}`, href: link({ min: "", page: "" }) });
  if (max !== null) chips.push({ label: `Up to ${rupeeText(max)}`, href: link({ max: "", page: "" }) });
  if (discount) chips.push({ label: `${discount}% off or more`, href: link({ discount: "", page: "" }) });
  if (rating) chips.push({ label: `${rating}★ and up`, href: link({ rating: "", page: "" }) });
  if (inStock) chips.push({ label: "In stock", href: link({ inStock: "", page: "" }) });

  res.render("pages/products", {
    title: `${heading} | Nexthlon`,
    heading,
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
  const [related, reviews, reviewState] = await Promise.all([
    productService.getRelatedProducts(product),
    reviewService.listReviews(product._id, 1),
    reviewService.reviewStatus(req.user, product._id)
  ]);
  res.render("pages/product", {
    title: `${product.name} | Nexthlon`,
    metaDescription: (product.description || product.name).slice(0, 155),
    product,
    offer: productService.offerLabel(product),
    related,
    reviews,
    reviewState
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
  res.render("pages/profile", { title: "Your account | Nexthlon", addresses, states: INDIAN_STATES });
});

const cart = asyncHandler(async (req, res) => {
  const data = await cartService.getCart(req.user._id);
  res.render("pages/cart", { title: "Your cart | Nexthlon", checkoutOpen: true, ...data });
});

// ---------- Checkout and orders ----------

const checkout = asyncHandler(async (req, res) => {
  const [quote, addresses] = await Promise.all([
    checkoutService.buildQuote(req.user._id),
    profileService.listAddresses(req.user._id)
  ]);
  // Nothing to buy: back to the cart, which explains why.
  if (!quote.lines.length) return res.redirect("/cart");
  return res.render("pages/checkout", { title: "Checkout | Nexthlon", quote, addresses, states: INDIAN_STATES, razorpayEnabled: razorpayService.isEnabled() });
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
  res.render("admin/login", {
    title: "Admin sign in | Nexthlon",
    next: safeNextPath(req.query.next, "/admin"),
    reason: req.query.reason
  });
}

const adminDashboard = asyncHandler(async (req, res) => {
  const [data, settings] = await Promise.all([adminService.getDashboardStats(), settingsService.getAll()]);
  res.render("admin/dashboard", { title: "Dashboard | Nexthlon Admin", ...data, settings });
});

// The UI kit: every design token and component in one place.
function adminDesignSystem(req, res) {
  res.render("admin/design-system", { title: "Design system | Nexthlon Admin" });
}

const adminUsers = asyncHandler(async (req, res) => {
  const data = await adminService.listCustomers(req.query);
  const link = linkBuilder("/admin/users", {
    q: data.filters.q,
    status: data.filters.status === "all" ? "" : data.filters.status
  });
  res.render("admin/users", { title: "Users | Nexthlon Admin", link, ...data });
});

const adminProducts = asyncHandler(async (req, res) => {
  const data = await adminProductService.listAdminProducts(req.query);
  const { q, category, status, sort } = data.filters;
  const link = linkBuilder("/admin/products", {
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
  wishlist,
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
  adminDesignSystem,
  adminUsers,
  adminProducts,
  adminProductNew,
  adminProductEdit
};
