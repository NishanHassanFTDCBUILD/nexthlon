// One account directory shared by the sidebar and the account home.
const ACCOUNT_NAV = [
  {
    group: '',
    items: [
      {
        key: 'overview',
        href: '/account',
        icon: 'grid',
        label: 'Overview',
        description: 'Your account at a glance',
      },
    ],
  },
  {
    group: 'Orders',
    items: [
      {
        key: 'orders',
        href: '/account/orders',
        icon: 'package-check',
        label: 'Your orders',
        description: 'Track deliveries, request returns and view invoices',
      },
      {
        key: 'buy-again',
        href: '/account/buy-again',
        icon: 'rotate-ccw',
        label: 'Buy it again',
        description: 'Find products from your previous deliveries',
      },
    ],
  },
  {
    group: 'Payments',
    items: [
      {
        key: 'wallet',
        href: '/account/wallet',
        icon: 'wallet',
        label: 'Wallet',
        description: 'Check your balance, credits and transaction history',
      },
      {
        key: 'coupons',
        href: '/account/coupons',
        icon: 'ticket',
        label: 'Coupons & offers',
        description: 'See available offers and their conditions',
      },
    ],
  },
  {
    group: 'Shopping',
    items: [
      {
        key: 'lists',
        href: '/account/lists',
        icon: 'heart',
        label: 'Wishlist & lists',
        description: 'Organise your saved products and shopping lists',
      },
      {
        key: 'recent',
        href: '/account/recent',
        icon: 'history',
        label: 'Recently viewed',
        description: 'Pick up where you left off browsing',
      },
    ],
  },
  {
    group: 'Account',
    items: [
      {
        key: 'profile',
        href: '/account/profile',
        icon: 'users',
        label: 'Your profile',
        description: 'Personal details, sports and size preferences',
      },
      {
        key: 'addresses',
        href: '/account/addresses',
        icon: 'pin',
        label: 'Addresses',
        description: 'Add delivery addresses and choose your default',
      },
      {
        key: 'security',
        href: '/account/security',
        icon: 'lock',
        label: 'Login & security',
        description: 'Manage your password and signed-in devices',
      },
      {
        key: 'notifications',
        href: '/account/notifications',
        icon: 'mail',
        label: 'Notifications',
        description: 'Choose which updates you receive',
      },
      {
        key: 'referral',
        href: '/account/referral',
        icon: 'gift',
        label: 'Refer a friend',
        description: 'Share your invite and check your rewards',
      },
      {
        key: 'help',
        href: '/account/help',
        icon: 'headset',
        label: 'Help & support',
        description: 'Ask about an order and follow your support requests',
      },
    ],
  },
];
module.exports = {ACCOUNT_NAV};
