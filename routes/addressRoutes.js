const router = require('express').Router();
const {
  listAddresses,
  addAddress,
  updateAddress,
  setDefaultAddress,
  deleteAddress,
} = require('../controllers/profileController');
const {requireAuth, requireRole} = require('../middleware/auth');

// Mounted at /api/addresses. Every route here needs a signed-in customer.
router.use(requireAuth, requireRole('customer'));
router.get('/', listAddresses);
router.post('/', addAddress);
router.patch('/:addressId', updateAddress);
router.patch('/:addressId/default', setDefaultAddress);
router.delete('/:addressId', deleteAddress);

module.exports = router;
