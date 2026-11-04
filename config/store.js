// Store details shown on the policy pages, the footer and the contact page.
// Everything in [square brackets] is a placeholder: replace it with your real details
// before applying for Razorpay. Amounts are in paise (₹1 = 100 paise).

const STORE = {
  brandName: "Nexthlon",
  legalName: "[Your registered business name]",
  address: "[Building, street], [City], [State] [PIN code], India",
  gstin: "[Your GSTIN]",
  supportEmail: "[support@your-domain.in]",
  supportPhone: "[+91 00000 00000]",
  supportHours: "Monday to Saturday, 10 am to 6 pm IST",
  grievanceOfficer: "[Name of grievance officer]",
  freeDeliveryMin: 49900, // free delivery above ₹499
  deliveryFee: 4000, // ₹40 below that
  returnDays: 7,
  refundDays: "5 to 7 working days",
  dispatchDays: "1 to 2 working days",
  deliveryDays: "3 to 7 working days",
  policyUpdated: "4 November 2026"
};

// Topics a shopper can pick on the contact form.
const CONTACT_TOPICS = [
  "Order or delivery",
  "Returns and refunds",
  "Payments",
  "Product question",
  "Account help",
  "Something else"
];

// Price bands in the category mega-menu (rupees).
const PRICE_BANDS = [
  { label: "Under ₹999", max: 999 },
  { label: "₹1,000 to ₹2,999", min: 1000, max: 2999 },
  { label: "₹3,000 to ₹4,999", min: 3000, max: 4999 },
  { label: "₹5,000 and above", min: 5000 }
];

module.exports = { STORE, CONTACT_TOPICS, PRICE_BANDS };
