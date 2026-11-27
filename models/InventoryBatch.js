const mongoose = require('mongoose');

const inventoryBatchSchema = new mongoose.Schema(
  {
    actor: {type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true},
    status: {
      type: String,
      enum: ['preview', 'applying', 'completed'],
      default: 'preview',
    },
    rows: [
      {
        productId: {type: String, required: true},
        optionId: {type: String, default: ''},
        name: String,
        units: Number,
        reason: String,
        note: String,
      },
    ],
    results: [
      {row: Number, productId: String, status: String, message: String},
    ],
    lockedUntil: Date,
    lockToken: String,
    recoveryVersion: Number,
    applyBefore: {type: Date, required: true},
    expiresAt: {type: Date, required: true},
  },
  {timestamps: true},
);

inventoryBatchSchema.index({expiresAt: 1}, {expireAfterSeconds: 0});
inventoryBatchSchema.index({actor: 1, createdAt: -1});

module.exports = mongoose.model('InventoryBatch', inventoryBatchSchema);
