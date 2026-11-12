// The only user fields that are ever sent to the browser (API replies and page locals).
function toPublicUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    isBlocked: user.isBlocked,
    emailVerified: Boolean(user.emailVerifiedAt),
    referralCode: user.referralCode || "",
    createdAt: user.createdAt
  };
}

module.exports = { toPublicUser };
