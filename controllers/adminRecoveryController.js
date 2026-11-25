const InventoryBatch = require('../models/InventoryBatch');
const {asyncHandler} = require('../utils/http');

exports.importsPage = asyncHandler(async (req, res) => {
  const batches = await InventoryBatch.find({actor: req.user._id})
    .sort({createdAt: -1})
    .limit(30)
    .lean();
  res.render('admin/inventory-imports', {
    title: 'Restock recovery | Nexthlon Admin',
    batches,
  });
});
