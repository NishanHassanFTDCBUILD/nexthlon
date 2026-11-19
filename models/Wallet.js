const mongoose = require('mongoose');

// One wallet per customer. The balance is in paise and only ever changes through
// services/walletService.js, which writes a WalletTransaction for every change.
const walletSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    balance: {type: Number, default: 0, min: 0, validate: Number.isInteger},
    // Written in the SAME atomic update as the balance, including on standalone MongoDB.
    // Retain these receipts so an interrupted credit can safely rebuild its history entry.
    creditReceipts: {type: [String], default: [], select: false},
    adjustmentReceipts: {type: [String], default: [], select: false},
  },
  {timestamps: true},
);

module.exports = mongoose.model('Wallet', walletSchema);
