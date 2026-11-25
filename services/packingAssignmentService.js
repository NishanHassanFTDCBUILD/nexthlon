const Order = require('../models/Order');
const {HttpError} = require('../utils/http');
async function change(orderId, actor, action) {
  if (!['claim', 'release'].includes(action))
    throw new HttpError(400, 'Choose claim or release.');
  const filter = {orderId, orderStatus: {$in: ['placed', 'confirmed']}};
  if (action === 'claim')
    filter.$or = [{packingOwner: null}, {packingOwner: actor._id}];
  else filter.packingOwner = actor._id;
  const fields =
    action === 'claim'
      ? {
          packingOwner: actor._id,
          packingOwnerName: actor.name,
          packingClaimedAt: new Date(),
        }
      : {packingOwner: null, packingOwnerName: '', packingClaimedAt: null};
  const order = await Order.findOneAndUpdate(
    filter,
    {$set: fields},
    {new: true},
  ).select('orderId packingOwner packingOwnerName packingClaimedAt');
  if (!order)
    throw new HttpError(
      409,
      'This order is assigned to someone else or has left the packing queue. Refresh its status.',
    );
  return order;
}
module.exports = {change};
