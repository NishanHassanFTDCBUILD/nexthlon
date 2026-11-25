// Read-only work queues. The same predicates power the list and its exports.
const ORDER_WORK_QUEUES = [
  {
    key: 'payment',
    label: 'Payment needed',
    description: 'Unpaid online orders awaiting payment',
    icon: 'credit-card',
    filter: () => ({
      orderStatus: {$in: ['placed', 'confirmed']},
      paymentMethod: 'razorpay',
      paymentStatus: {$in: ['pending', 'failed']},
    }),
  },
  {
    key: 'dispatch',
    label: 'Ready to dispatch',
    description: 'Confirmed orders with payment ready',
    icon: 'package-check',
    filter: () => ({
      orderStatus: 'confirmed',
      $or: [
        {paymentMethod: 'cod'},
        {paymentStatus: {$in: ['paid', 'partially_refunded']}},
      ],
    }),
  },
  {
    key: 'transit',
    label: 'In transit',
    description: 'Shipped and out-for-delivery orders',
    icon: 'truck',
    filter: () => ({orderStatus: {$in: ['shipped', 'out_for_delivery']}}),
  },
  {
    key: 'returns',
    label: 'Return requests',
    description: 'Customer returns awaiting a decision',
    icon: 'rotate-ccw',
    filter: () => ({orderStatus: 'return_requested'}),
  },
  {
    key: 'refunds',
    label: 'Payment returns processing',
    description: 'Orders with an earlier payment return still processing',
    icon: 'wallet',
    filter: () => ({refunds: {$elemMatch: {status: 'pending'}}}),
  },
  {
    key: 'recovery',
    label: 'Changes processing',
    description: 'Order changes with unfinished settlement work',
    icon: 'clock',
    filter: () => ({settlements: {$elemMatch: {done: false}}}),
  },
];
module.exports = {ORDER_WORK_QUEUES};
