const productService = require("../services/productService");
const profileService = require("../services/profileService");
const adminService = require("../services/adminService");
const adminProductService = require("../services/adminProductService");
const { INDIAN_STATES, CATEGORIES } = require("../config/catalog");
const { HttpError, asyncHandler, safeNextPath } = require("../utils/http");
const { linkBuilder } = require("../utils/queryString");

// ---------- Store pages ----------

const home = asyncHandler(async (req, res) => {
  const sections = await productService.getHomeSections();
  res.render("pages/home", { title: "Nexthlon | Your Next Move Starts Here", ...sections });
});

const products = asyncHandler(async (req, res) => {
  const [result, categories] = await Promise.all([
    productService.listProducts(req.query),
    productService.getCategorySummaries()
  ]);
  const { q, category, min, max, inStock, sort } = result.filters;
  const heading = q ? `Results for "${q}"` : category || "All sports gear";
  const link = linkBuilder("/products", {
    q, category, min, max, inStock: inStock ? "1" : "", sort: sort === "featured" ? "" : sort
  });

  // Removable chips for each active filter.
  const chips = [];
  if (q) chips.push({ label: `"${q}"`, href: link({ q: "", page: "" }) });
  if (category) chips.push({ label: category, href: link({ category: "", page: "" }) });
  if (min !== null) chips.push({ label: `From ₹${min}`, href: link({ min: "", page: "" }) });
  if (max !== null) chips.push({ label: `Up to ₹${max}`, href: link({ max: "", page: "" }) });
  if (inStock) chips.push({ label: "In stock", href: link({ inStock: "", page: "" }) });

  res.render("pages/products", {
    title: `${heading} | Nexthlon`,
    heading,
    categories,
    sorts: productService.SORTS,
    link,
    chips,
    ...result
  });
});

const productDetail = asyncHandler(async (req, res) => {
  const product = await productService.getProduct(req.params.slug);
  if (!product) throw new HttpError(404, "That product is no longer available.");
  const related = await productService.getRelatedProducts(product);
  res.render("pages/product", { title: `${product.name} | Nexthlon`, product, related });
});

// ---------- Account pages ----------

function login(req, res) {
  res.render("pages/login", {
    title: "Sign in | Nexthlon",
    next: safeNextPath(req.query.next, "/"),
    reason: req.query.reason
  });
}

function signup(req, res) {
  res.render("pages/signup", { title: "Create your account | Nexthlon", next: safeNextPath(req.query.next, "/") });
}

const profile = asyncHandler(async (req, res) => {
  const addresses = await profileService.listAddresses(req.user._id);
  res.render("pages/profile", { title: "Your account | Nexthlon", addresses, states: INDIAN_STATES });
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
  const data = await adminService.getDashboardStats();
  res.render("admin/dashboard", { title: "Dashboard | Nexthlon Admin", ...data });
});

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
    categories: CATEGORIES,
    sorts: adminProductService.ADMIN_SORTS,
    ...data
  });
});

function adminProductNew(req, res) {
  res.render("admin/product-form", { title: "Add product | Nexthlon Admin", product: null, categories: CATEGORIES });
}

const adminProductEdit = asyncHandler(async (req, res) => {
  const product = await adminProductService.getAdminProduct(req.params.productId);
  res.render("admin/product-form", { title: `Edit ${product.name} | Nexthlon Admin`, product, categories: CATEGORIES });
});

module.exports = {
  home,
  products,
  productDetail,
  login,
  signup,
  profile,
  adminLogin,
  adminDashboard,
  adminUsers,
  adminProducts,
  adminProductNew,
  adminProductEdit
};
