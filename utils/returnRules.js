// Return rules, as pure checks (no database here). Limits are in paise; 0 means the rule is off.
//   autoApproveUnder   a return whose refund is at or under this is approved as soon as it is asked for
//   ownerApprovalAbove a refund above this can only be approved by the owner
const MAX_LIMIT = 1000000000; // ₹1 crore, in paise

// Does a refund this large need the owner to approve it?
function ownerApprovalNeeded(refund, ownerApprovalAbove) {
  return ownerApprovalAbove > 0 && refund > ownerApprovalAbove;
}

// Can this refund be approved automatically under the rules?
function autoApprovable(refund, rules) {
  return (
    rules.autoApproveUnder > 0 &&
    refund > 0 &&
    refund <= rules.autoApproveUnder &&
    !ownerApprovalNeeded(refund, rules.ownerApprovalAbove)
  );
}

module.exports = {MAX_LIMIT, ownerApprovalNeeded, autoApprovable};
