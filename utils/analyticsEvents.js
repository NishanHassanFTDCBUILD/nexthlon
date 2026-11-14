// Shopping events for analytics (D2), in GA4's ecommerce shape (Plausible takes the flat parts).
// Pages pass them as `trackEvents`; public/js/consent.js sends them only after the shopper agreed.
// No names, emails, addresses or phone numbers ever go in here: products and amounts only.
// Amounts leave as rupees (GA4 wants major units); the store keeps paise.

const rupees = paise => Math.round(Number(paise) || 0) / 100;

const item = ({ id, name, brand, price, quantity, variant }) => {
  const out = { item_id: String(id), item_name: String(name || "").slice(0, 100), price: rupees(price), quantity: quantity || 1 };
  if (brand) out.item_brand = String(brand).slice(0, 60);
  if (variant) out.item_variant = String(variant).slice(0, 60);
  return out;
};

function viewItem(product) {
  return {
    name: "view_item",
    params: { currency: "INR", value: rupees(product.price), items: [item({ id: product._id, name: product.name, brand: product.brand, price: product.price })] }
  };
}

function beginCheckout(quote) {
  const lines = (quote && quote.lines) || [];
  return {
    name: "begin_checkout",
    params: {
      currency: "INR",
      value: rupees(quote && quote.totals ? quote.totals.total : 0),
      items: lines.map(line => item({ id: line.productId, name: line.name, brand: line.brand, price: line.price, quantity: line.quantity, variant: line.option }))
    }
  };
}

function purchase(order) {
  const items = (order.items || []).filter(line => line.status !== "cancelled");
  return {
    name: "purchase",
    params: {
      transaction_id: order.orderId,
      currency: "INR",
      value: rupees(order.total),
      shipping: rupees(order.deliveryFee || 0),
      payment_type: order.paymentMethod,
      items: items.map(line => item({ id: line.product && line.product._id ? line.product._id : line.product, name: line.name, price: line.price, quantity: line.quantity, variant: line.option }))
    },
    // A shopper who reloads the thank-you page must not count as a second sale.
    once: `purchase:${order.orderId}`
  };
}

module.exports = { viewItem, beginCheckout, purchase, rupees };
