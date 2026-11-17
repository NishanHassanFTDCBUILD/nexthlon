// The admin console's sections, in sidebar order. Used by the sidebar and the Ctrl+K palette.
// Every section listed here is built: there are no "coming soon" placeholders any more, so a URL
// that is not one of these is a plain 404 like any other unknown page.
//   key    the section id (also the URL: <ADMIN_PATH>/<key>)
//   label  what the sidebar and the palette show
//   icon   a name from public/img/icons.svg
const ADMIN_NAV = [
  { group: "Overview", items: [
    { key: "dashboard", label: "Dashboard", icon: "grid" },
    { key: "analytics", label: "Analytics", icon: "trending-up" }
  ] },
  { group: "Sales", items: [
    { key: "orders", label: "Orders", icon: "package-check" },
    { key: "returns", label: "Returns", icon: "rotate-ccw" },
    { key: "transactions", label: "Transactions", icon: "credit-card" },
    { key: "refunds", label: "Refunds", icon: "wallet" },
    { key: "abandoned-carts", label: "Abandoned carts", icon: "cart" },
    { key: "coupons", label: "Coupons", icon: "ticket" }
  ] },
  { group: "Catalog", items: [
    { key: "products", label: "Products", icon: "box" },
    { key: "inventory", label: "Inventory", icon: "archive" }
  ] },
  { group: "Customers", items: [
    { key: "customers", label: "Customers", icon: "users" },
    { key: "questions", label: "Questions", icon: "headset" }
  ] },
  { group: "System", items: [
    { key: "settings", label: "Settings", icon: "settings" },
    { key: "system", label: "System status", icon: "monitor" }
  ] }
];

const ALL_ITEMS = ADMIN_NAV.flatMap(group => group.items.map(item => ({ ...item, group: group.group })));

module.exports = { ADMIN_NAV, ALL_ITEMS };
