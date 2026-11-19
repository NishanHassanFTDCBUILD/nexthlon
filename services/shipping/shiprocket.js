// Shiprocket (B5): one account books parcels with many couriers (Delhivery, Blue Dart, Ekart ...).
// Used only when SHIPPING_PROVIDER=shiprocket and its login and pickup location are set (config/env.js).
//
// What it does for the store:
//   serviceability(pin)  which couriers deliver to a PIN code, if Cash on Delivery works there, and how fast
//   book(order)          create the order on Shiprocket, take the AWB (tracking number), ask for a pickup,
//                        and fetch the shipping label to print
// Tracking updates come the other way, as a webhook (services/shippingService.js handleTrackingUpdate).
//
// The login token lasts 10 days; it is kept in memory and renewed a day early, or at once if Shiprocket
// says it expired. Every call has a time limit, so a slow courier platform never hangs a page.
const config = require('../../config/env');
const logger = require('../../utils/logger');
const {HttpError} = require('../../utils/http');

const TOKEN_LIFE_MS = 9 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 8000;

let transport = (url, options) =>
  fetch(url, {...options, signal: AbortSignal.timeout(TIMEOUT_MS)});
let token = null;
let tokenAt = 0;

// Tests swap in a fake (nothing is ever sent to Shiprocket from the tests).
function setTransport(fn) {
  transport = fn;
  token = null;
  tokenAt = 0;
}

const settings = () => config.shipping.shiprocket;

async function request(method, path, body, {auth = true, retry = true} = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (auth) headers.Authorization = `Bearer ${await login()}`;
  let response;
  try {
    response = await transport(settings().baseUrl + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    logger.warn('shiprocket.unreachable', {path, error});
    throw new HttpError(
      502,
      'The courier platform did not answer. Try again in a minute.',
      null,
      'shipping_unreachable',
    );
  }
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {message: text.slice(0, 200)};
  }
  if (response.status === 401 && auth && retry) {
    token = null;
    return request(method, path, body, {auth, retry: false});
  }
  if (!response.ok) {
    const message =
      typeof data.message === 'string'
        ? data.message
        : `Shiprocket answered ${response.status}.`;
    const error = new HttpError(
      response.status === 404 ? 404 : 502,
      `Shiprocket: ${message}`.slice(0, 300),
      null,
      'shipping_rejected',
    );
    error.providerStatus = response.status;
    throw error;
  }
  return data;
}

async function login() {
  if (token && Date.now() - tokenAt < TOKEN_LIFE_MS) return token;
  const {email, password} = settings();
  const data = await request(
    'POST',
    '/auth/login',
    {email, password},
    {auth: false},
  );
  if (!data.token)
    throw new HttpError(
      502,
      'Shiprocket did not accept the login. Check SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD.',
      null,
      'shipping_login',
    );
  token = data.token;
  tokenAt = Date.now();
  return token;
}

const rupees = (paise) => Math.round(Number(paise) || 0) / 100;
const pad = (n) => String(n).padStart(2, '0');
function istStamp(date) {
  const ist = new Date(new Date(date).getTime() + 5.5 * 60 * 60 * 1000);
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())} ${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}`;
}

// Which couriers deliver here. Returns null when none does.
async function serviceability(
  pincode,
  {cod = false, weightKg = config.shipping.defaultWeightKg} = {},
) {
  const query = new URLSearchParams({
    pickup_postcode: config.shipping.pickupPincode,
    delivery_postcode: pincode,
    cod: cod ? '1' : '0',
    weight: String(weightKg),
  });
  let data;
  try {
    data = await request('GET', `/courier/serviceability/?${query}`);
  } catch (error) {
    if (error.providerStatus === 404) return null;
    throw error;
  }
  const couriers =
    (data && data.data && data.data.available_courier_companies) || [];
  if (!couriers.length) return null;
  const days = couriers
    .map((c) => Number(c.estimated_delivery_days))
    .filter((n) => Number.isFinite(n) && n > 0);
  return {
    couriers: couriers.length,
    cod: couriers.some((c) => Number(c.cod) === 1),
    fastestDays: days.length ? Math.min(...days) : null,
    slowestDays: days.length ? Math.max(...days) : null,
  };
}

// The parcel as Shiprocket wants it: rupees, kg, the address split into its parts.
function parcelFor(order, user, weights) {
  const items = order.items.filter((item) => item.status !== 'cancelled');
  const [first, ...rest] = String(order.address.fullName || 'Customer')
    .trim()
    .split(/\s+/);
  const weightKg = Math.max(
    0.1,
    items.reduce(
      (sum, item) =>
        sum +
        (weights.get(String(item.product)) ||
          config.shipping.defaultWeightKg * 1000) *
          item.quantity,
      0,
    ) / 1000,
  );
  const cod =
    order.paymentMethod === 'cod' && order.paymentStatus === 'pending';
  return {
    order_id: order.orderId,
    order_date: istStamp(order.createdAt || new Date()),
    pickup_location: settings().pickupLocation,
    billing_customer_name: first,
    billing_last_name: rest.join(' '),
    billing_address: order.address.line1,
    billing_address_2: [order.address.line2, order.address.landmark]
      .filter(Boolean)
      .join(', '),
    billing_city: order.address.city,
    billing_pincode: order.address.pincode,
    billing_state: order.address.state,
    billing_country: 'India',
    billing_email: user && user.email ? user.email : '',
    billing_phone: order.address.phone,
    shipping_is_billing: true,
    order_items: items.map((item) => ({
      name: item.option ? `${item.name} (${item.option})` : item.name,
      sku: item.sku || String(item.product),
      units: item.quantity,
      selling_price: rupees(item.price),
      hsn: item.tax && item.tax.hsn ? item.tax.hsn : '',
    })),
    payment_method: cod ? 'COD' : 'Prepaid',
    shipping_charges: rupees(order.deliveryFee),
    total_discount: rupees(
      (order.couponDiscount || 0) + (order.walletUsed || 0),
    ),
    // What the courier collects at the door for COD; for prepaid orders the value of the goods.
    sub_total: cod
      ? rupees(order.total)
      : rupees(items.reduce((sum, item) => sum + item.lineTotal, 0)),
    length: 30,
    breadth: 25,
    height: 10,
    weight: Math.round(weightKg * 100) / 100,
  };
}

// Book the parcel: order -> AWB -> pickup -> label. Any step after the first can fail on its own
// (no courier free today, label not ready yet); the shipment is still recorded with what we have.
async function book(order, user, weights) {
  const created = await request(
    'POST',
    '/orders/create/adhoc',
    parcelFor(order, user, weights),
  );
  const shipmentId = created.shipment_id;
  if (!shipmentId)
    throw new HttpError(
      502,
      `Shiprocket did not create the shipment${created.message ? `: ${created.message}` : '.'}`,
      null,
      'shipping_rejected',
    );
  const assigned = await request('POST', '/courier/assign/awb', {
    shipment_id: shipmentId,
  });
  const awb =
    assigned && assigned.response && assigned.response.data
      ? assigned.response.data
      : {};
  if (!awb.awb_code) {
    throw new HttpError(
      502,
      'Shiprocket created the order but no courier took it yet. Open Shiprocket to pick a courier, or try again.',
      null,
      'shipping_no_courier',
    );
  }
  await request('POST', '/courier/generate/pickup', {
    shipment_id: [shipmentId],
  }).catch((error) =>
    logger.warn('shiprocket.pickup_failed', {order: order.orderId, error}),
  );
  const label = await request('POST', '/courier/generate/label', {
    shipment_id: [shipmentId],
  }).catch((error) => {
    logger.warn('shiprocket.label_failed', {order: order.orderId, error});
    return {};
  });
  return {
    courier: String(awb.courier_name || 'Courier').slice(0, 60),
    trackingNumber: String(awb.awb_code).slice(0, 60),
    providerOrderId: String(created.order_id || ''),
    providerShipmentId: String(shipmentId),
    labelUrl:
      typeof label.label_url === 'string' && /^https:\/\//.test(label.label_url)
        ? label.label_url
        : '',
  };
}

module.exports = {
  serviceability,
  book,
  parcelFor,
  setTransport,
  login,
  istStamp,
};
