const {
  isReviewEligibleOrder
} = require('../apps/services/order-service/src/review-eligibility');
const {
  clampRating,
  summarizeApprovedReviews
} = require('../apps/services/product-service/src/review-summary');
const {
  mergeProductPresentation
} = require('../apps/web/src/lib/presentation-state');

describe('product review trust helpers', () => {
  test('treats paid or fulfilled orders as review eligible', () => {
    expect(isReviewEligibleOrder({ payment_status: 'paid', status: 'pending' })).toBe(true);
    expect(isReviewEligibleOrder({ payment_status: 'pending', status: 'shipped' })).toBe(true);
    expect(isReviewEligibleOrder({ payment_status: 'failed', status: 'payment_failed' })).toBe(false);
  });

  test('clamps ratings into the expected 1-5 range', () => {
    expect(clampRating(0)).toBe(1);
    expect(clampRating(6)).toBe(5);
    expect(clampRating(4.4)).toBe(4);
  });

  test('summarizes only approved reviews into aggregate product rating', () => {
    expect(summarizeApprovedReviews([
      { rating: 5, is_approved: true },
      { rating: 3, is_approved: true },
      { rating: 1, is_approved: false }
    ])).toEqual({
      reviewCount: 2,
      averageRating: 4
    });
  });

  test('preserves live rating data when presentation defaults are empty', () => {
    expect(mergeProductPresentation({
      id: 'review-rating-smoke',
      rating: 4.7,
      review_count: 12
    })).toMatchObject({
      rating: 4.7,
      review_count: 12
    });
  });
});
