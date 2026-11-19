const mongoose = require('mongoose');

// A permanent record of important changes: who did what, to what, from where, and when.
// before/after hold only the changed, non-secret fields (never passwords or tokens).
const auditLogSchema = new mongoose.Schema({
  actor: {type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null},
  actorRole: {
    type: String,
    enum: ['customer', 'admin', 'system'],
    default: 'system',
  },
  action: {type: String, required: true, maxlength: 60},
  target: {type: String, default: '', maxlength: 120},
  before: {type: mongoose.Schema.Types.Mixed, default: null},
  after: {type: mongoose.Schema.Types.Mixed, default: null},
  ip: {type: String, default: '', maxlength: 60},
  at: {type: Date, default: Date.now},
});

auditLogSchema.index({at: -1});
auditLogSchema.index({actor: 1, at: -1});
auditLogSchema.index({action: 1, at: -1});

module.exports = mongoose.model('AuditLog', auditLogSchema);
