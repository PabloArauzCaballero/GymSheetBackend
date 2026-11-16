import {
  isPendingReviewSuspension,
  PENDING_REVIEW_SUSPENSION_UNTIL,
  suspendedAccountError,
  suspendedSessionError,
} from './account-suspension';

describe('account suspension messages', () => {
  it('treats the 9999 sentinel as an open-ended review, never as a date', () => {
    expect(isPendingReviewSuspension(PENDING_REVIEW_SUSPENSION_UNTIL)).toBe(true);
    expect(isPendingReviewSuspension(new Date('9999-12-31T00:00:00.000Z'))).toBe(true);
    expect(isPendingReviewSuspension(new Date('2027-01-31T00:00:00.000Z'))).toBe(false);
    for (const error of [suspendedAccountError(PENDING_REVIEW_SUSPENSION_UNTIL), suspendedSessionError(PENDING_REVIEW_SUSPENSION_UNTIL)]) {
      expect(error.message).toBe('Tu cuenta está suspendida mientras revisamos un reporte.');
      expect(error.message).not.toContain('9999');
    }
  });

  it('keeps the dated wording of a strike suspension', () => {
    const until = new Date('2027-01-31T12:00:00.000Z');
    expect(suspendedAccountError(until).getStatus()).toBe(403);
    expect(suspendedAccountError(until).message).toBe(
      `Tu cuenta está suspendida hasta el ${until.toLocaleDateString('es')} por incumplir las normas de la comunidad.`,
    );
    expect(suspendedSessionError(until).getStatus()).toBe(401);
  });
});
