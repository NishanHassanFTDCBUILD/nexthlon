const mongoose = require('mongoose');

const KINDS = ['refund', 'order', 'referral', 'admin'];

// The wallet's history: every credit and debit, with the balance right after it. Paise.
// "key" makes a credit happen only once (for example one referral reward per new customer).
const walletTransactionSchema = new mongoose.Schema(
  {
    user: {type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true},
    type: {type: String, enum: ['credit', 'debit'], required: true},
    amount: {type: Number, required: true, min: 1, validate: Number.isInteger},
    kind: {type: String, enum: KINDS, required: true},
    reason: {type: String, required: true, maxlength: 160},
    orderId: {type: String, default: ''},
    balanceAfter: {type: Number, default: 0, min: 0},
    key: {type: String},
    applied: {type: Boolean, default: true},
    admin: {type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null},
  },
  {timestamps: true},
);

walletTransactionSchema.index({user: 1, createdAt: -1});
walletTransactionSchema.index({key: 1}, {unique: true, sparse: true});

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);
module.exports.KINDS = KINDS;
