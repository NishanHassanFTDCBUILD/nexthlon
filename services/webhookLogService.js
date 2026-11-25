// The webhook log: record every payment and courier webhook call we receive. Recording never blocks or changes the webhook's answer: a log failure is only logged.
const WebhookEvent = require('../models/WebhookEvent');
const logger = require('../utils/logger');
const {HttpError} = require('../utils/http');

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

module.exports = {
  PROVIDERS,
  OUTCOMES,
  record,
  outcomeOf,
  describeRazorpay,
};
