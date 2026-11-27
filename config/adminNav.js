// The admin console's sections, in sidebar order. Used by the sidebar and the Ctrl+K palette.
// Every section listed here is built: there are no "coming soon" placeholders any more, so a URL
// that is not one of these is a plain 404 like any other unknown page.
//   key    the section id (also the URL: <ADMIN_PATH>/<key>)
//   label  what the sidebar and the palette show
//   icon   a name from public/img/icons.svg
const ADMIN_NAV = [
  {
    group: 'Overview',
    items: [
      {key: 'dashboard', label: 'Dashboard', icon: 'grid'},
      {key: 'analytics', label: 'Analytics', icon: 'trending-up'},
    ],
  },
  {
    group: 'Sales',
    items: [
      {key: 'orders', label: 'Orders', icon: 'package-check'},
      {key: 'returns', label: 'Returns', icon: 'rotate-ccw'},
      {
        key: 'transactions',
        label: 'Transactions',
        icon: 'credit-card',
        perm: 'reports.read',
      },
      {key: 'coupons', label: 'Coupons', icon: 'ticket'},
      {key: 'deals', label: 'Deals of the day', icon: 'bolt'},
      {
        key: 'returns-report',
        label: 'Return reasons',
        icon: 'rotate-ccw',
        perm: 'reports.read',
      },
    ],
  },
  {
    group: 'Catalog',
    items: [
      {key: 'products', label: 'Products', icon: 'box'},
      {key: 'categories', label: 'Categories', icon: 'layers'},
      {key: 'inventory', label: 'Inventory', icon: 'archive'},
    ],
  },
  {
    group: 'Customers',
    items: [
      {key: 'customers', label: 'Customers', icon: 'users'},
      {key: 'questions', label: 'Questions', icon: 'headset'},
      {key: 'reviews', label: 'Reviews', icon: 'star', perm: 'reviews.write'},
      {
        key: 'support',
        label: 'Support inbox',
        icon: 'mail',
        perm: 'support.write',
      },
    ],
  },
  {
    group: 'System',
    items: [
      {key: 'staff', label: 'Staff', icon: 'users', perm: 'staff.manage'},
      {
        key: 'settings',
        label: 'Settings',
        icon: 'settings',
        perm: 'settings.write',
      },
      {key: 'system', label: 'System status', icon: 'monitor'},
    ],
  },
];

const ALL_ITEMS = ADMIN_NAV.flatMap((group) =>
  group.items.map((item) => ({...item, group: group.group})),
);

// The sections one role may open: an item with perm needs that permission (utils/permissions.js).
function navFor(role) {
  const {can} = require('../utils/permissions');
  return ADMIN_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.perm || can(role, item.perm)),
  })).filter((group) => group.items.length);
}

module.exports = {ADMIN_NAV, ALL_ITEMS, navFor};
