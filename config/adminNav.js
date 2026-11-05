// The admin console's sections, in sidebar order. Used by the sidebar, the Ctrl+K command
// palette and the placeholder page of sections that are not built yet.
//   key    the section id (also the URL: <ADMIN_PATH>/<key>)
//   ready  false while the section is still being built; it then shows a short notice
//   part   which part of the admin build brings it (for that notice)
const ADMIN_NAV = [
  { group: "Overview", items: [
    { key: "dashboard", label: "Dashboard", icon: "grid", ready: true },
    { key: "analytics", label: "Analytics", icon: "trending-up", part: 5 }
  ] },
  { group: "Sales", items: [
    { key: "orders", label: "Orders", icon: "package-check", part: 4 },
    { key: "returns", label: "Returns", icon: "rotate-ccw", part: 4 },
    { key: "transactions", label: "Transactions", icon: "credit-card", part: 4 },
    { key: "refunds", label: "Refunds", icon: "wallet", part: 4 },
    { key: "abandoned-carts", label: "Abandoned carts", icon: "cart", part: 4 }
  ] },
  { group: "Catalog", items: [
    { key: "products", label: "Products", icon: "box", ready: true },
    { key: "categories", label: "Categories", icon: "layers", part: 6 },
    { key: "brands", label: "Brands", icon: "award", part: 6 },
    { key: "inventory", label: "Inventory", icon: "archive", part: 6 },
    { key: "reviews", label: "Reviews", icon: "star", part: 6 },
    { key: "questions", label: "Q&A", icon: "help", part: 6 }
  ] },
  { group: "Customers", items: [
    { key: "customers", label: "Customers", icon: "users", ready: true },
    { key: "segments", label: "Segments", icon: "pie", part: 6 },
    { key: "tickets", label: "Support tickets", icon: "headset", ready: true }
  ] },
  { group: "Marketing", items: [
    { key: "coupons", label: "Coupons", icon: "ticket", part: 6 },
    { key: "offers", label: "Offers", icon: "tag", part: 6 },
    { key: "flash-sales", label: "Flash sales", icon: "bolt", part: 6 },
    { key: "campaigns", label: "Email campaigns", icon: "mail", part: 6 },
    { key: "gift-cards", label: "Gift cards", icon: "gift", part: 6 },
    { key: "loyalty", label: "Loyalty & Pro", icon: "sparkles", part: 6 }
  ] },
  { group: "Content", items: [
    { key: "cms", label: "Home page CMS", icon: "home", part: 6 },
    { key: "banners", label: "Banners", icon: "image", part: 6 }
  ] },
  { group: "Reports", items: [
    { key: "sales-report", label: "Sales report", icon: "file-text", part: 6 },
    { key: "exports", label: "Exports", icon: "download", part: 6 }
  ] },
  { group: "Settings", items: [
    { key: "settings", label: "Store settings", icon: "settings", ready: true },
    { key: "delivery-zones", label: "Delivery zones", icon: "truck", part: 6 },
    { key: "admins", label: "Admin users & roles", icon: "shield", part: 6 },
    { key: "audit-log", label: "Audit log", icon: "history", part: 6 },
    { key: "system", label: "System status", icon: "monitor", part: 6 }
  ] }
];

const ALL_ITEMS = ADMIN_NAV.flatMap(group => group.items.map(item => ({ ...item, group: group.group })));
const findSection = key => ALL_ITEMS.find(item => item.key === key) || null;

module.exports = { ADMIN_NAV, ALL_ITEMS, findSection };
