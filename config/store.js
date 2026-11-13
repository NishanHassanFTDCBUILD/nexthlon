// Store details shown on the policy pages, the footer, the contact page, invoices and emails.
// The business details come from settings (STORE_* in .env or the host's dashboard), so going live needs
// no code change. Anything still in [square brackets] is a placeholder: India's e-commerce rules and
// Razorpay both need the real ones, and the startup check warns about them in production
// (config/schema.js). Amounts are in paise (₹1 = 100 paise).
const setting = (name, placeholder) => (process.env[name] || "").trim() || placeholder;

const STORE = {
  brandName: "Nexthlon",
  legalName: setting("STORE_LEGAL_NAME", "[Your registered business name]"),
  address: setting("STORE_ADDRESS", "[Building, street], [City], [State] [PIN code], India"),
  gstin: setting("STORE_GSTIN", "[Your GSTIN]"),
  // The state the business is registered for GST in. A buyer in the same state pays CGST + SGST,
  // anyone else IGST (utils/gst.js). Kerala until set.
  state: setting("STORE_STATE", "Kerala"),
  // "regular" issues tax invoices with GST shown. "composition" (a small business under the composition
  // scheme) cannot charge GST, so it issues a "bill of supply" without the tax split.
  gstScheme: setting("STORE_GST_SCHEME", "regular") === "composition" ? "composition" : "regular",
  supportEmail: setting("STORE_SUPPORT_EMAIL", "[support@your-domain.in]"),
  supportPhone: setting("STORE_SUPPORT_PHONE", "[+91 00000 00000]"),
  supportHours: setting("STORE_SUPPORT_HOURS", "Monday to Saturday, 10 am to 6 pm IST"),
  grievanceOfficer: setting("STORE_GRIEVANCE_OFFICER", "[Name of grievance officer]"),
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
