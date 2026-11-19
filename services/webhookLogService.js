// The webhook log: record every payment and courier webhook, list them for the team, and re-run a
// payment event. Recording never blocks or changes the webhook's answer: a log failure is only logged.
const mongoose = require('mongoose');
const WebhookEvent = require('../models/WebhookEvent');
const logger = require('../utils/logger');
const {HttpError} = require('../utils/http');
const {pageSize} = require('../utils/paging');

const PROVIDERS = ['razorpay', 'shiprocket'];
const OUTCOMES = ['processed', 'ignored', 'rejected', 'failed', 'rerun'];
const MAX_BODY = 60000;

// The event name and the id it is about, read from a Razorpay JSON body (empty when unreadable).
function describeRazorpay(rawBody) {
  try {
    const parsed = JSON.parse(String(rawBody || ''));
    const p = parsed.payload || {};
    const entity =
      (p.payment && p.payment.entity) ||
      (p.refund && p.refund.entity) ||
      (p.order && p.order.entity) ||
      {};
    return {
      event: String(parsed.event || ''),
      externalId: String(entity.id || ''),
    };
  } catch {
    return {event: '', externalId: ''};
  }
}

// Outcome from what the handler did: rejected for a bad signature, failed for a server error.
function outcomeOf(error) {
  if (!error) return 'processed';
  if (error instanceof HttpError && error.status < 500) return 'rejected';
  return 'failed';
}

async function record({
  provider,
  rawBody,
  signature,
  signatureOk,
  outcome,
  error,
  event,
  externalId,
}) {
  try {
    const read =
      provider === 'razorpay'
        ? describeRazorpay(rawBody)
        : {event: '', externalId: ''};
    // What the body says wins; the caller's details fill in when the body does not say.
    const described = {
      event: read.event || event || '',
      externalId: read.externalId || externalId || '',
    };
    const keepBody =
      provider === 'razorpay' &&
      typeof rawBody !== 'undefined' &&
      rawBody !== null;
    await WebhookEvent.create({
      provider,
      event: described.event,
      externalId: described.externalId,
      signatureOk: Boolean(signatureOk),
      outcome,
      error: error ? String(error.message || error).slice(0, 300) : '',
      rawBody: keepBody ? String(rawBody).slice(0, MAX_BODY) : '',
      signature: keepBody ? String(signature || '').slice(0, 300) : '',
    });
  } catch (logError) {
    logger.warn('webhook_log.record_failed', {error: logError});
  }
}

async function list(query = {}) {
  const filter = {};
  if (PROVIDERS.includes(query.provider)) filter.provider = query.provider;
  if (OUTCOMES.includes(query.outcome)) filter.outcome = query.outcome;
  const size = pageSize(query, 20);
  const current = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const [rows, total] = await Promise.all([
    WebhookEvent.find(filter)
      .sort({receivedAt: -1, _id: -1})
      .skip((current - 1) * size)
      .limit(size)
      .select('-rawBody -signature')
      .lean(),
    WebhookEvent.countDocuments(filter),
  ]);
  return {
    events: rows.map((r) => ({
      id: String(r._id),
      provider: r.provider,
      event: r.event || '(unreadable)',
      externalId: r.externalId,
      signatureOk: r.signatureOk,
      outcome: r.outcome,
      error: r.error,
      receivedAt: r.receivedAt,
    })),
    filters: {
      provider: PROVIDERS.includes(query.provider) ? query.provider : '',
      outcome: OUTCOMES.includes(query.outcome) ? query.outcome : '',
    },
    pagination: {
      page: current,
      pages: Math.max(1, Math.ceil(total / size)),
      total,
      limit: size,
    },
  };
}

// Re-run a Razorpay payment event we received with a good signature. The original body and
// signature are used, so the handler checks the same signature again.
async function rerun(id, handle) {
  if (!mongoose.isValidObjectId(id))
    throw new HttpError(404, 'Webhook not found.');
  const original = await WebhookEvent.findById(id).lean();
  if (!original) throw new HttpError(404, 'Webhook not found.');
  if (original.provider !== 'razorpay')
    throw new HttpError(
      400,
      'Only payment (Razorpay) events can be re-run here.',
    );
  if (!original.signatureOk || !original.rawBody)
    throw new HttpError(
      400,
      'Only events with a good signature and a stored body can be re-run.',
    );
  let error = null;
  try {
    await handle(Buffer.from(original.rawBody, 'utf8'), original.signature);
  } catch (caught) {
    error = caught;
  }
  await record({
    provider: 'razorpay',
    event: original.event,
    externalId: original.externalId,
    rawBody: original.rawBody,
    signature: original.signature,
    signatureOk: true,
    outcome: error ? outcomeOf(error) : 'rerun',
    error,
  });
  if (error) throw error;
  return {event: original.event, externalId: original.externalId};
}

module.exports = {
  PROVIDERS,
  OUTCOMES,
  record,
  list,
  rerun,
  outcomeOf,
  describeRazorpay,
};
