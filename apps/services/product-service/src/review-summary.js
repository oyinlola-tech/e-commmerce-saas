const clampRating = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(1, Math.min(5, Math.round(parsed)));
};

const summarizeApprovedReviews = (reviews = []) => {
  const approved = Array.isArray(reviews)
    ? reviews.filter((review) => Boolean(review?.is_approved))
    : [];

  if (!approved.length) {
    return {
      reviewCount: 0,
      averageRating: null
    };
  }

  const totalRating = approved.reduce((sum, review) => sum + clampRating(review.rating), 0);
  const averageRating = Math.round(((totalRating / approved.length) + Number.EPSILON) * 100) / 100;

  return {
    reviewCount: approved.length,
    averageRating
  };
};

module.exports = {
  clampRating,
  summarizeApprovedReviews
};
