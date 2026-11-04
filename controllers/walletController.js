const walletService = require("../services/walletService");
const referralService = require("../services/referralService");
const { asyncHandler } = require("../utils/http");

// GET /api/wallet?type=all|credit|debit&page=   Balance, history (paise) and the referral code.
const getWallet = asyncHandler(async (req, res) => {
  const [wallet, referral] = await Promise.all([
    walletService.getWallet(req.user._id, req.query),
    referralService.getReferral(req.user, `${req.protocol}://${req.get("host")}`)
  ]);
  res.json({ ...wallet, referral });
});

module.exports = { getWallet };
