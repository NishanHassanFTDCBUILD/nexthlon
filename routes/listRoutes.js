const router = require('express').Router();
const account = require('../controllers/accountController');
const {requireAuth, requireRole} = require('../middleware/auth');

// Mounted at /api/lists. Signed-in customers only. ":listId" is a list id, or "default" for the
// main wishlist.
router.use(requireAuth, requireRole('customer'));
router.get('/', account.getLists);
router.post('/', account.createList);
router.post('/move', account.moveListItem);
router.patch('/:listId', account.renameList);
router.delete('/:listId', account.deleteList);
router.patch('/:listId/share', account.shareList);
router.post('/:listId/items', account.addListItem);
router.delete('/:listId/items/:productId', account.removeListItem);
router.post('/:listId/items/:productId/move-to-cart', account.listItemToCart);

module.exports = router;
