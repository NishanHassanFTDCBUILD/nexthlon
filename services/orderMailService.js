// The emails about an order: confirmed, shipped (with tracking), out for delivery, delivered, cancelled,
// refunded, and the return request and its answer. Called by the listeners in events/listeners/orderEmails.js,
// which run as background jobs, so each function loads the order as it is NOW and may be retried safely.
//
// Exactly once: every email has a key ("order:NX-2026-000123:status:shipped") recorded in EmailLog when it is
// sent. A retried job, a duplicate event or a restart in the middle finds the key and sends nothing more.
//
// Who gets what: the receipt, cancellations, refunds and return decisions always go (they are about money and
// your rights). Delivery progress (shipped, out for delivery, delivered, tracking) follows the customer's
// "Order updates" switch in My Account > Notifications.
const Order = require("../models/Order");
const User = require("../models/User");
const EmailLog = require("../models/EmailLog");
const mailService = require("./mailService");
const deliveryService = require("./deliveryService");
const { renderEmail, siteUrl, absoluteUrl } = require("../utils/emailLayout");
const { sizedUrl } = require("../utils/images");
const { formatPaise } = require("../utils/money");
const { STORE } = require("../config/store");
const logger = require("../utils/logger");

const CLAIM_LEASE_MS = 5 * 60 * 1000;
const PROGRESS_KINDS = new Set(["shipped", "out_for_delivery", "delivered", "tracking"]);
const dateFormat = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const firstName = user => String(user.name || "").trim().split(/\s+/)[0] || "there";

// ---------- Blocks shared by the emails ----------

function itemsSection(order, base, items = order.items) {
  return {
    type: "items",
    items: items.map(item => ({
      name: item.name,
      detail: [item.brand, item.option, `Qty ${item.quantity}`].filter(Boolean).join(" · "),
      image: absoluteUrl(sizedUrl(item.image, 200), base),
      price: formatPaise(item.lineTotal)
    }))
  };
}

function moneySection(order) {
  const rows = [["Items", formatPaise(order.subtotal)]];
  if (order.couponDiscount > 0) rows.push([`Coupon ${order.couponCode || ""}`.trim(), `-${formatPaise(order.couponDiscount)}`]);
  rows.push(["Delivery", order.deliveryFee > 0 ? formatPaise(order.deliveryFee) : "Free"]);
  if (order.walletUsed > 0) rows.push(["Paid from wallet", `-${formatPaise(order.walletUsed)}`]);
  if (order.paymentMethod === "cod" && order.total > 0) rows.push(["To pay on delivery", formatPaise(order.total), { strong: true }]);
  else if (order.paymentMethod === "razorpay") rows.push([order.paymentStatus === "paid" ? "Paid online" : "To pay online", formatPaise(order.total), { strong: true }]);
  else rows.push(["Total paid", formatPaise(order.walletUsed || order.total), { strong: true }]);
  return { type: "facts", title: "Payment", rows };
}

function addressSection(order) {
  const a = order.address || {};
  return { type: "text", title: "Delivering to", lines: [a.fullName, a.line1, a.line2, a.landmark, `${a.city || ""}, ${a.state || ""} ${a.pincode || ""}`.trim(), a.phone && `Phone ${a.phone}`].filter(Boolean) };
}

function trackingLines(order) {
  const shipment = order.shipments && order.shipments[order.shipments.length - 1];
  if (!shipment) return null;
  return [
    `${shipment.courier}: ${shipment.trackingNumber}`,
    ...(shipment.expectedAt ? [`Expected by ${dateFormat.format(shipment.expectedAt)}`] : [])
  ];
}

const orderUrl = (order, base) => `${base}/orders/${order.orderId}`;

// ---------- The emails ----------
// Each builder returns the subject and what renderEmail needs.

const BUILDERS = {
  placed(order, user, base) {
    const estimate = deliveryService.estimateDelivery(order.address && order.address.pincode);
    return {
      subject: `Order ${order.orderId} confirmed: thank you!`,
      content: {
        preheader: `We have your order and will pack it soon.`,
        heading: "Thank you for your order!",
        paragraphs: [
          `Hi ${firstName(user)}, we have your order ${order.orderId} and will start packing it soon.`,
          ...(estimate && estimate.deliverable ? [`Expected delivery: ${estimate.label}.`] : [])
        ],
        sections: [itemsSection(order, base), moneySection(order), addressSection(order)],
        button: { label: "View your order", url: orderUrl(order, base) },
        note: `You can cancel it free of charge until it ships. Returns are accepted for ${STORE.returnDays} days after delivery.`
      }
    };
  },

  shipped(order, user, base) {
    const tracking = trackingLines(order);
    return {
      subject: `Your order ${order.orderId} has shipped`,
      content: {
        preheader: tracking ? tracking[0] : "On its way to you.",
        heading: "Your order is on its way",
        paragraphs: [`Good news, ${firstName(user)}! Order ${order.orderId} has been handed to the courier.`],
        sections: [...(tracking ? [{ type: "callout", title: "Tracking", lines: tracking }] : []), itemsSection(order, base), addressSection(order)],
        button: { label: "Track your order", url: orderUrl(order, base) }
      }
    };
  },

  out_for_delivery(order, user, base) {
    const toPay = order.paymentMethod === "cod" && order.total > 0 && order.paymentStatus !== "paid";
    return {
      subject: `Arriving today: order ${order.orderId}`,
      content: {
        preheader: "Out for delivery.",
        heading: "Out for delivery today",
        paragraphs: [
          `${firstName(user)}, your order ${order.orderId} is out for delivery and should reach you today.`,
          ...(toPay ? [`Please keep ${formatPaise(order.total)} ready: this order is paid on delivery.`] : [])
        ],
        sections: [addressSection(order)],
        button: { label: "Track your order", url: orderUrl(order, base) }
      }
    };
  },

  delivered(order, user, base) {
    return {
      subject: `Delivered: order ${order.orderId}`,
      content: {
        preheader: "Your order has arrived.",
        heading: "Your order has arrived",
        paragraphs: [
          `${firstName(user)}, order ${order.orderId} has been delivered. We hope you love it.`,
          `If something is not right, you can return it within ${STORE.returnDays} days from your order page.`
        ],
        sections: [itemsSection(order, base)],
        button: { label: "Review your purchase", url: orderUrl(order, base) },
        note: `Your tax invoice is on the order page: ${base}/orders/${order.orderId}/invoice`
      }
    };
  },

  // A tracking number added after the order had already shipped.
  tracking(order, user, base) {
    const tracking = trackingLines(order) || [];
    return {
      subject: `Tracking details for order ${order.orderId}`,
      content: {
        preheader: tracking[0] || "",
        heading: "Tracking details",
        paragraphs: [`${firstName(user)}, here is how to follow order ${order.orderId}.`],
        sections: [{ type: "callout", title: "Tracking", lines: tracking }],
        button: { label: "Track your order", url: orderUrl(order, base) }
      }
    };
  },

  cancelled(order, user, base, extra) {
    const ids = new Set((extra.itemIds || []).map(String));
    const items = order.items.filter(item => ids.has(String(item._id)));
    const whole = order.orderStatus === "cancelled";
    return {
      subject: whole ? `Order ${order.orderId} cancelled` : `Item cancelled in order ${order.orderId}`,
      content: {
        preheader: whole ? "Your order was cancelled." : "Part of your order was cancelled.",
        heading: whole ? "Your order was cancelled" : "An item was cancelled",
        paragraphs: [
          `Hi ${firstName(user)}, ${whole ? `order ${order.orderId} has been cancelled` : "the items below were cancelled"}${extra.reason ? `: ${extra.reason}` : "."}`,
          ...(order.paymentStatus === "pending" && order.paymentMethod === "cod" ? [] : ["If you had already paid, the refund is on its way and you will get a separate email when it is done."])
        ],
        sections: [itemsSection(order, base, items.length ? items : order.items)],
        button: { label: "View your order", url: orderUrl(order, base) }
      }
    };
  },

  refunded(order, user, base, extra) {
    const parts = (extra.parts || []).map(part => `${formatPaise(part.amount)} ${part.method === "original" ? "to your original payment method (it can take 5 to 7 working days to show)" : "to your Nexthlon wallet (available now)"}`);
    return {
      subject: `Refund of ${formatPaise(extra.amount)} for order ${order.orderId}`,
      content: {
        preheader: `${formatPaise(extra.amount)} is on its way back to you.`,
        heading: "Your refund is on its way",
        paragraphs: [`Hi ${firstName(user)}, we have refunded ${formatPaise(extra.amount)} for order ${order.orderId}.`],
        sections: [{ type: "callout", title: "Where the money went", lines: parts.length ? parts : [formatPaise(extra.amount)] }],
        button: { label: "View your order", url: orderUrl(order, base) },
        note: extra.reason ? `Reason: ${extra.reason}` : ""
      }
    };
  },

  return_requested(order, user, base) {
    return {
      subject: `We got your return request for ${order.orderId}`,
      content: {
        preheader: "We will arrange a pickup.",
        heading: "Return request received",
        paragraphs: [
          `Hi ${firstName(user)}, we have your return request for order ${order.orderId}.`,
          "We will review it and arrange a pickup. You will get another email as soon as it is decided."
        ],
        sections: [itemsSection(order, base, order.items.filter(item => item.status === "return_requested"))],
        button: { label: "View your order", url: orderUrl(order, base) }
      }
    };
  },

  return_decided(order, user, base, extra) {
    const approved = extra.decision === "approve";
    return {
      subject: approved ? `Return approved for order ${order.orderId}` : `Update on your return for order ${order.orderId}`,
      content: {
        preheader: approved ? "Your refund follows." : "We could not accept this return.",
        heading: approved ? "Your return was approved" : "We could not accept your return",
        paragraphs: approved
          ? [`Hi ${firstName(user)}, your return for order ${order.orderId} was approved.`, "The refund is made now; you will get a separate email with where it went."]
          : [`Hi ${firstName(user)}, we looked at your return request for order ${order.orderId} and could not accept it.`, "The items stay with you."],
        sections: extra.note ? [{ type: "callout", title: approved ? "Note from us" : "Why", lines: [extra.note] }] : [],
        button: { label: "View your order", url: orderUrl(order, base) },
        note: approved ? "" : `Questions? Write to ${STORE.supportEmail} and we will help.`
      }
    };
  }
};

// ---------- Sending, exactly once ----------

// Claims the key, sends, and records it. Returns "sent", or "skipped" when it was already sent. Throws when sending
// fails (the job is retried) or when another worker is sending it right now (retried later).
async function sendOnce(key, { kind, to, orderId }, send) {
  const now = new Date();
  const existing = await EmailLog.findOne({ key });
  if (existing && existing.sentAt) return "skipped";
  if (existing) {
    // Claimed but not finished: a worker is sending it, or died doing so. After the lease, take over.
    if (existing.claimedAt && now - existing.claimedAt < CLAIM_LEASE_MS) throw new Error(`Another worker is sending ${key}`);
    await EmailLog.updateOne({ key }, { $set: { claimedAt: now } });
  } else {
    try {
      await EmailLog.create({ key, kind, to, orderId, claimedAt: now });
    } catch (error) {
      if (error.code === 11000) throw new Error(`Another worker is sending ${key}`);
      throw error;
    }
  }
  let result;
  try {
    result = await send();
  } catch (error) {
    // The send failed cleanly: free the claim so the retry (not a crashed worker) can try again at once.
    await EmailLog.updateOne({ key }, { $set: { claimedAt: null } });
    throw error;
  }
  await EmailLog.updateOne({ key }, { $set: { sentAt: new Date(), provider: result.provider || "", providerId: result.id || "" } });
  return "sent";
}

// Sends one order email. kind: a key of BUILDERS. suffix makes the key specific when one order can have several
// of the same kind (a second refund). Returns "sent" | "skipped" | "opted-out" | "missing".
async function sendOrderEmail(kind, orderId, extra = {}, suffix = "") {
  const order = await Order.findOne({ orderId });
  const user = order && await User.findById(order.user);
  if (!order || !user || user.isDeleted) return "missing";
  if (PROGRESS_KINDS.has(kind) && user.notifyPrefs && user.notifyPrefs.orderUpdates === false) return "opted-out";

  const base = siteUrl();
  const { subject, content } = BUILDERS[kind](order, user, base, extra);
  const { html, text } = renderEmail(content);
  const key = `order:${orderId}:${kind}${suffix ? `:${suffix}` : ""}`;
  const outcome = await sendOnce(key, { kind, to: user.email, orderId }, () => mailService.send({ to: user.email, subject, html, text }));
  if (outcome === "sent") logger.info("order_email.sent", { order: orderId, kind });
  return outcome;
}

module.exports = { sendOrderEmail, sendOnce, BUILDERS, PROGRESS_KINDS };
