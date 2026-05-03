const REVIEW_ELIGIBLE_ORDER_STATUSES = new Set(['confirmed', 'shipped', 'delivered']);

const isReviewEligibleOrder = (record = {}) => {
  const paymentStatus = String(record.payment_status || '').trim().toLowerCase();
  const orderStatus = String(record.status || '').trim().toLowerCase();

  return paymentStatus === 'paid' || REVIEW_ELIGIBLE_ORDER_STATUSES.has(orderStatus);
};

module.exports = {
  REVIEW_ELIGIBLE_ORDER_STATUSES,
  isReviewEligibleOrder
};
