// Admin roles and what each one may do. One table, read by the admin API (routes/adminRoutes.js)
// and by the console's navigation, so a button a role cannot use is never shown to it.
//
// Every admin is one of these roles. An admin account with no role saved is treated as the owner,
// so existing accounts keep full access. Anything the table does not list is refused unless the
// role is the owner: a new write route is closed by default until someone gives it a permission.
const ROLES = Object.freeze([
  'owner',
  'manager',
  'catalogue',
  'packing',
  'support',
  'finance',
]);

const ROLE_LABELS = Object.freeze({
  owner: 'Owner',
  manager: 'Manager',
  catalogue: 'Catalogue',
  packing: 'Packing',
  support: 'Support',
  finance: 'Finance',
});

const ROLE_HELP = Object.freeze({
  owner: 'Everything, including staff accounts and settings.',
  manager: 'Runs the store day to day. Cannot manage staff accounts.',
  catalogue: 'Products, categories, stock, deals and reviews.',
  packing: 'Orders: packing, shipping and notes. Cannot refund.',
  support: 'Customer tickets, order notes and reviews.',
  finance: 'Refunds, wallet credit and reports. Cannot change products.',
});

const ALL = '*';
// "read" is every GET on the admin API: any staff role can see the console.
const PERMISSIONS = Object.freeze({
  owner: [ALL],
  manager: [
    'read',
    'orders.write',
    'orders.ship',
    'orders.note',
    'refunds.write',
    'wallet.write',
    'products.write',
    'categories.write',
    'inventory.write',
    'deals.write',
    'coupons.write',
    'customers.write',
    'support.write',
    'reviews.write',
    'settings.write',
    'reports.read',
  ],
  catalogue: [
    'read',
    'products.write',
    'categories.write',
    'inventory.write',
    'deals.write',
    'reviews.write',
  ],
  packing: ['read', 'orders.ship', 'orders.note'],
  support: ['read', 'support.write', 'orders.note', 'reviews.write'],
  finance: ['read', 'refunds.write', 'wallet.write', 'reports.read'],
});

// The permission a write needs, by path under /api/admin (the first matching rule wins).
// GET requests are "read" unless a rule below says otherwise.
const RULES = [
  [/^\/staff/, 'staff.manage'],
  [/^\/settings/, 'settings.write'],
  [/^\/reports/, 'reports.read'],
  [/^\/tickets/, 'support.write'],
  [/^\/questions/, 'reviews.write'],
  [/^\/reviews/, 'reviews.write'],
  [/^\/views/, 'read'],
  [/^\/goals/, 'settings.write'],
  [/^\/products/, 'products.write'],
  [/^\/categories/, 'categories.write'],
  [/^\/inventory/, 'inventory.write'],
  [/^\/deals/, 'deals.write'],
  [/^\/coupons/, 'coupons.write'],
  [/^\/customers\/[^/]+\/wallet/, 'wallet.write'],
  [/^\/customers/, 'customers.write'],
  [/^\/security\//, 'read'],
  [/^\/returns\/rules/, 'settings.write'],
  [/^\/returns/, 'refunds.write'],
  [/^\/transactions/, 'reports.read'],
  [/^\/orders\/[^/]+\/refunds/, 'refunds.write'],
  [/^\/orders\/[^/]+\/notes/, 'orders.note'],
  [/^\/orders\/[^/]+\/(shipments|ship)/, 'orders.ship'],
  [/^\/orders\/bulk-status/, 'orders.ship'],
  [/^\/orders\/[^/]+\/assignment/, 'orders.ship'],
  [/^\/orders/, 'orders.write'],
];

// Pages and lists that are narrower than the console itself. Every other GET is "read".
const READ_GATES = [
  [/^\/settings/, 'settings.write'],
  [/^\/goals/, 'reports.read'],
  [/^\/staff/, 'staff.manage'],
  [/^\/reports/, 'reports.read'],
  [/^\/transactions/, 'reports.read'],
];

// The permission a request needs. null means "owner only": the default for anything unlisted.
function permissionFor(method, path) {
  if (method === 'GET' || method === 'HEAD') {
    for (const [pattern, permission] of READ_GATES)
      if (pattern.test(path)) return permission;
    return 'read';
  }
  for (const [pattern, permission] of RULES)
    if (pattern.test(path)) return permission;
  return null;
}

function roleOf(user) {
  if (!user || user.role !== 'admin') return null;
  // The User schema and existing seeded accounts use '' for the legacy owner.
  if (user.adminRole == null || user.adminRole === '') return 'owner';
  return ROLES.includes(user.adminRole) ? user.adminRole : null;
}

// Can this role do this permission? null (owner only) is allowed for the owner alone.
function can(role, permission) {
  if (!role || !PERMISSIONS[role]) return false;
  const granted = PERMISSIONS[role];
  if (granted.includes(ALL)) return true;
  if (permission === null) return false;
  return granted.includes(permission);
}

module.exports = {
  ROLES,
  ROLE_LABELS,
  ROLE_HELP,
  PERMISSIONS,
  RULES,
  permissionFor,
  roleOf,
  can,
};
