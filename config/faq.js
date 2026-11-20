// The questions on the FAQ page. Answers use only the store's own settings (config/store) and the pages
// they link to, so they never state a policy detail that is not published. Edit here, not in the view.
const {STORE} = require('./store');

const rupees = (paise) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;

module.exports = Object.freeze([
  {
    q: 'How do I track my order?',
    a: 'Enter your order number on the tracking page to see where your order is.',
    href: '/track',
    link: 'Track an order',
  },
  {
    q: 'Is delivery free?',
    a: `Delivery is free on orders of ${rupees(STORE.freeDeliveryMin)} or more. Below that a delivery fee of ${rupees(STORE.deliveryFee)} applies.`,
    href: '/shipping-policy',
    link: 'Shipping and delivery policy',
  },
  {
    q: 'Can I pay on delivery?',
    a: 'Cash on delivery is offered on some orders. Checkout shows whether it is available for your order and address.',
    href: '/shipping-policy',
    link: 'Shipping and delivery policy',
  },
  {
    q: 'How do I cancel an order or return an item?',
    a: 'Our cancellation and refund policy explains when you can cancel, how to return an item, and how refunds are paid.',
    href: '/refund-policy',
    link: 'Cancellation and refunds',
  },
  {
    q: 'How do I choose the right size?',
    a: 'The size finder helps you choose the right fit for shoes and clothing.',
    href: '/size-finder',
    link: 'Open the size finder',
  },
  {
    q: 'Can I buy a gift card?',
    a: 'Yes. Gift cards can be bought for yourself or for someone else.',
    href: '/account/gift-card',
    link: 'Gift cards',
  },
  {
    q: 'I have a question that is not here.',
    a: 'Send us a message and our team will reply.',
    href: '/contact',
    link: 'Contact us',
  },
]);
