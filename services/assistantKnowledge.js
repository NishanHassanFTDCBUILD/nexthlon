// Public store guidance only. Personal order status and balances stay on authenticated pages.
const {STORE} = require('../config/store');

const money = (paise) =>
  `\u20b9${(paise / 100).toLocaleString('en-IN', {maximumFractionDigits: 2})}`;
const contact = () =>
  [STORE.supportEmail, STORE.supportPhone]
    .filter((value) => value && !value.includes('[') && !value.includes(']'))
    .join(' or ');

const TOPICS = [
  {
    id: 'overview',
    match:
      /\b(nexthlon|about (?:you|the store|this website)|what (?:is this|do you sell|can you do)|everything|features)\b/i,
    label: 'About Nexthlon',
    href: '/about',
    answer: () =>
      `${STORE.brandName} is a sports gear store based in ${STORE.address}. Browse gear by sport, compare product details, photos, videos where available, sizes, prices and reviews. You can save wishlists, manage your cart, checkout, track orders, request eligible returns and use wallet credit. I can explain these features, store policies and help you find products by need or budget. Ask a specific question for details.`,
  },
  {
    id: 'location',
    match:
      /\b(located|location|based|business address|store address|shop address|office address)\b/i,
    label: 'Business details',
    href: '/about',
    answer: () =>
      `${STORE.brandName}'s business address is ${STORE.address}. Check About Nexthlon and Contact us for the published business details. This does not confirm a walk-in shop or collection point; contact the team before visiting.`,
  },
  {
    id: 'withdrawal',
    match:
      /\b(withdraw|withdrawal|transfer|cash out|bank refund|original payment|original method)\b/i,
    label: 'Wallet credit policy',
    href: '/refund-policy',
    answer: () =>
      'Nexthlon wallet credit can be spent on other available Nexthlon products. It cannot be transferred to another account or withdrawn as cash, to a bank, card or UPI through the store. Standard paid cancellations and approved returns credit the wallet. Contact support for payment errors or exceptional problems.',
  },
  {
    id: 'cancellation',
    match: /\b(cancel(?:lation|lations|led|ing)?|canceled)\b/i,
    label: 'Cancellation and wallet credit',
    href: '/refund-policy',
    answer: () =>
      'Cancel eligible items before shipment from Your orders. Once shipped, cancellation is unavailable; an eligible return may be requested after delivery. The eligible amount already paid online or from your wallet is credited to your Nexthlon wallet. An unpaid Cash on Delivery cancellation creates no credit for money never collected. Partial cancellations credit only the eligible paid value of the cancelled items.',
  },
  {
    id: 'returns',
    match:
      /\b(return(?:s|ed|ing)?|refund(?:s|ed)?|money back|exchanges?|replace(?:ment)?)\b/i,
    label: 'Returns and wallet credit',
    href: '/refund-policy',
    answer: () =>
      `Request an eligible return from Your orders within ${STORE.returnDays} days of delivery. Keep the item unused with tags, original packaging and accessories. Hygiene-sensitive items are not eligible for change-of-mind returns. Once approved, the eligible paid value is credited to your Nexthlon wallet for another purchase. For an exchange or replacement, check the options on your order or contact support; I cannot approve one here.`,
  },
  {
    id: 'damage',
    match:
      /\b(damaged|faulty|broken|defective|wrong item|incorrect item|missing item)\b/i,
    label: 'Get order support',
    href: '/account/help',
    answer: () =>
      'Contact support promptly about damaged, faulty, incorrect or missing items. Include the order number, explain the issue and attach clear photos where possible. Keep the item and packaging while the team investigates. I cannot approve a return or confirm compensation in this chat.',
  },
  {
    id: 'wallet',
    match: /\b(wallet|store credit|balance)\b/i,
    label: 'Your wallet',
    href: '/account/wallet',
    answer: () =>
      'Sign in and open Wallet to see your balance and credit history. Paid cancellations and approved returns credit the eligible amount to your Nexthlon wallet. Select wallet payment at checkout to spend it on another purchase. If it covers only part of the total, pay the remainder online; partial wallet payment cannot be combined with Cash on Delivery. I cannot read your personal balance here.',
  },
  {
    id: 'delivery',
    match:
      /\b(shipping|delivery|deliveries|deliver(?:ed)?|arriv(?:e|al)|dispatch|ship|courier|pincode|pin code)\b/i,
    label: 'Shipping and delivery',
    href: '/shipping-policy',
    answer: () =>
      `We deliver across India where courier service is available. Dispatch usually takes ${STORE.dispatchDays}; delivery usually takes ${STORE.deliveryDays} after dispatch, depending on your PIN code. Delivery is free on orders of ${money(STORE.freeDeliveryMin)} or more; smaller orders pay ${money(STORE.deliveryFee)}. Checkout shows the exact charges and available delivery information. These are estimates, not a guaranteed arrival date.`,
  },
  {
    id: 'tracking',
    match:
      /\b(track(?:ing)?|order status|where is my order|my orders?|late order|order number)\b/i,
    label: 'Track your order',
    href: '/track',
    answer: () =>
      'Use Track an order and enter the requested order details, or sign in and open Your orders to view updates. When the order ships, its courier and tracking details are sent by email. I cannot look up your private order status from this chat. If an update is missing or delivery is delayed, contact support with your order number.',
  },
  {
    id: 'payment-problem',
    match:
      /\b(failed payment|payment failed|payment pending|money deducted|debited|charged twice|duplicate payment|paid but|payment problem)\b/i,
    label: 'Payment support',
    href: '/contact',
    answer: () =>
      'If money was deducted but your order is not confirmed, check Your orders before paying again. Contact support with the order number and payment reference for pending, duplicate or failed payments. Never share a card number, password, OTP or UPI PIN here. I cannot confirm a bank reversal or its timing; support must verify the transaction.',
  },
  {
    id: 'payment',
    match:
      /\b(payments?|pay|upi|cards?|netbanking|razorpay|cod|cash on delivery)\b/i,
    label: 'Your orders and payments',
    href: '/account/orders',
    answer: () =>
      'Checkout shows the available payment methods for your order. Online payments are processed through Razorpay using its available UPI, card and other methods. Cash on Delivery is offered only when eligible. You can use wallet credit; any partial-wallet remainder must be paid online. Never give this chat your OTP, card details or UPI PIN.',
  },
  {
    id: 'size',
    match: /\b(sizes?|fit|measure|sizing|shoe size)\b/i,
    label: 'Find my shoe size',
    href: '/find-my-size',
    answer: () =>
      'Use Find my shoe size for shoe measurements, and check each product’s size guide, specifications and available size options before adding it to the cart. Clothing fit varies by product, so compare its measurements rather than assuming every brand fits alike. I cannot guarantee a fit without the product’s measurements.',
  },
  {
    id: 'signup',
    match: /\b(sign ?up|register|registration|create (?:an? )?account)\b/i,
    label: 'Create an account',
    href: '/signup',
    answer: () =>
      'Open Create an account, enter the details requested and choose a strong password. Complete email verification if prompted. After signing in you can manage orders, addresses, wishlists and wallet credit in Your account. Do not send passwords or verification codes to this chat.',
  },
  {
    id: 'login',
    match:
      /\b(log ?in|sign ?in|password|forgot|reset|locked|verification|verify email)\b/i,
    label: 'Login and account security',
    href: '/account/security',
    answer: () =>
      'Use Sign in to access your account. If you forgot your password, choose the password reset option on the sign-in page and follow the email instructions. Login & security in Your account manages password and account security options. Check spam for verification messages or contact support if you remain locked out. Never share passwords, OTPs or reset links here.',
  },
  {
    id: 'address',
    match: /\b(address(?:es)?|default address|change city)\b/i,
    label: 'Saved addresses',
    href: '/account/addresses',
    answer: () =>
      'Manage saved delivery addresses in Your account → Addresses. Add or edit the recipient, phone, address and PIN code, and choose a default. At checkout, select the correct delivery address before confirming the order. Editing a saved address does not automatically change an order already placed; contact support about that order.',
  },
  {
    id: 'cart',
    match: /\b(cart|basket|checkout|buy now|place (?:an? )?order)\b/i,
    label: 'Your cart',
    href: '/cart',
    answer: () =>
      'Choose any required size or colour on the product page, select a quantity and Add to cart, or use Buy now. In the cart you can change quantities, remove items or save them for later. Checkout guides you through delivery address, order summary and payment. Stock, discounts and the final total are checked again before the order is confirmed.',
  },
  {
    id: 'wishlist',
    match:
      /\b(wishlist|wish list|saved (?:items|products)|lists|save for later)\b/i,
    label: 'Wishlist and lists',
    href: '/account/lists',
    answer: () =>
      'Tap a product’s heart to save it to your wishlist. Sign in to manage Wishlist & lists, organise saved products and use available list-sharing controls. Saving a product does not reserve its stock or price; check availability again when you buy.',
  },
  {
    id: 'offers',
    match: /\b(coupons?|promo(?:tion)?s?|discounts?|offers?|deals?)\b/i,
    label: 'Coupons and offers',
    href: '/account/coupons',
    answer: () =>
      'Check Coupons & offers for available offers and their eligibility. Enter an eligible coupon during checkout and check the updated total before paying. Minimum spend, expiry, product restrictions and usage limits may apply. Product discounts and coupons follow the checkout rules; I cannot invent a coupon or promise a discount.',
  },
  {
    id: 'referral',
    match: /\b(referrals?|refer|invite|rewards?)\b/i,
    label: 'Refer a friend',
    href: '/account/referral',
    answer: () =>
      'Open Refer a friend in Your account to find your invite code, link and current reward information. For an eligible new customer who signs up with your code, both wallets receive the configured reward after that customer’s first order is delivered. Rewards may be paused or changed; the account page shows the current amount.',
  },
  {
    id: 'stock',
    match:
      /\b(stock|sold out|availability|available|restock|back in stock|price alert)\b/i,
    label: 'Browse available gear',
    href: '/products',
    answer: () =>
      'The product page shows current stock and availability for each listed size or colour. If an email or price alert option is available, sign in and enable it there. Cart and wishlist items do not reserve stock. For a specific product, tell me its name and I can search listed, in-stock gear; I cannot promise a restock date.',
  },
  {
    id: 'media',
    match: /\b(video|photos?|images?|gallery|360|spin)\b/i,
    label: 'Browse product details',
    href: '/products',
    answer: () =>
      'Open a product to see its photo gallery. Where a video has been added, its Video thumbnail appears in the same gallery; select it to watch, then select a photo to return to images. Products do not all have videos. The 360-spin feature has been removed.',
  },
  {
    id: 'reviews',
    match: /\b(reviews?|ratings?|questions?|answers?)\b/i,
    label: 'Product reviews and questions',
    href: '/products',
    answer: () =>
      'Product pages show published customer ratings and reviews, and questions and answers where enabled. Sign in to use available review or question forms and follow any eligibility instructions shown. Read the product specifications too; I cannot make up reviews or claim a product is suitable without its actual details.',
  },
  {
    id: 'invoice',
    match: /\b(invoice|receipt|gst|tax)\b/i,
    label: 'Your order documents',
    href: '/account/orders',
    answer: () =>
      'Open an order in Your orders to access its available invoice or receipt. Check the order summary for the final amount before paying. The current storefront does not add a separate GST line; historical order documents may retain the tax details recorded when they were placed. Contact support about a document or billing discrepancy.',
  },
  {
    id: 'privacy',
    match:
      /\b(privacy|personal data|delete (?:my )?account|download (?:my )?data|cookies|secure|security)\b/i,
    label: 'Privacy policy',
    href: '/privacy',
    answer: () =>
      'Your account’s Login & security page includes available account and data controls. Read the privacy policy for how Nexthlon uses account, order and technical information. Payment details are entered on the payment partner’s page; this chat does not need your card details, UPI PIN, password or OTP. I cannot delete your account or access private records here.',
  },
  {
    id: 'notifications',
    match: /\b(notifications?|email preferences|unsubscribe|alerts?)\b/i,
    label: 'Notification settings',
    href: '/account/notifications',
    answer: () =>
      'Open Notifications in Your account to manage the communication options shown there. Product-specific stock or price alerts are controlled from the relevant product page where available. Essential messages about account security or orders may still be needed to operate your account.',
  },
  {
    id: 'profile',
    match: /\b(profile|change (?:my )?(?:name|phone)|edit (?:my )?account)\b/i,
    label: 'Your profile',
    href: '/account/profile',
    answer: () =>
      'Open Your profile in Your account to update the personal details and preferences supported by the form. Use Addresses for delivery details and Login & security for password or security options. I cannot change your personal information from this chat.',
  },
  {
    id: 'guides',
    match: /\b(guides?|stories|learn|training tips)\b/i,
    label: 'Sport guides',
    href: '/guides',
    answer: () =>
      'Sport guides and stories provide the articles currently published by Nexthlon. Product specifications and size guides remain the best place to check a particular item. I can help you search for gear, but cannot give personalised medical or injury advice.',
  },
  {
    id: 'support',
    match:
      /\b(contact|human|agent|support|help|person|complaint|opening hours|working hours|phone number|email address)\b/i,
    label: 'Contact Nexthlon',
    href: '/contact',
    answer: () =>
      `Contact the Nexthlon team using the contact form${contact() ? `, or ${contact()}` : ''}. Support hours: ${STORE.supportHours}. Signed-in customers can also open Help & support to raise and follow a ticket. Include your order number for order problems, but never passwords, payment PINs or OTPs.`,
  },
];

module.exports = {TOPICS};
