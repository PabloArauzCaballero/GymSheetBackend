import {
  bannedAccountError,
  isPendingReviewSuspension,
  PENDING_REVIEW_SUSPENSION_UNTIL,
  suspendedAccountError,
  suspendedSessionError,
} from './account-suspension';

const reason = { code: 'ACOSO', label: 'Acoso', text: 'mensajes o contenido que hostigan o intimidan a otra persona' };

describe('account suspension messages', () => {
  it('treats the 9999 sentinel as an open-ended review, never as a date', () => {
    expect(isPendingReviewSuspension(PENDING_REVIEW_SUSPENSION_UNTIL)).toBe(true);
    expect(isPendingReviewSuspension(new Date('9999-12-31T00:00:00.000Z'))).toBe(true);
    expect(isPendingReviewSuspension(new Date('2027-01-31T00:00:00.000Z'))).toBe(false);
    for (const error of [suspendedAccountError(PENDING_REVIEW_SUSPENSION_UNTIL, reason), suspendedSessionError(PENDING_REVIEW_SUSPENSION_UNTIL, reason)]) {
      expect(error.message).toBe('Tu cuenta está suspendida mientras revisamos un reporte.');
      expect(error.message).not.toContain('9999');
    }
  });

  it('keeps the dated wording of a strike suspension', () => {
    const until = new Date('2027-01-31T12:00:00.000Z');
    expect(suspendedAccountError(until, reason).getStatus()).toBe(403);
    expect(suspendedAccountError(until, reason).message).toBe(
      `Tu cuenta está suspendida hasta el ${until.toLocaleDateString('es')} por incumplir las normas de la comunidad.`,
    );
    expect(suspendedSessionError(until, reason).getStatus()).toBe(401);
  });

  it('carries the stable ACCOUNT_SUSPENDED code, with the end date only when there is one', () => {
    const until = new Date('2027-01-31T12:00:00.000Z');
    expect(suspendedAccountError(until, reason).getResponse()).toMatchObject({
      code: 'ACCOUNT_SUSPENDED',
      details: { pendingReview: false, until: until.toISOString() },
    });
    expect(suspendedSessionError(PENDING_REVIEW_SUSPENSION_UNTIL, reason).getResponse()).toMatchObject({
      code: 'ACCOUNT_SUSPENDED',
      details: { pendingReview: true },
    });
    expect(JSON.stringify(suspendedSessionError(PENDING_REVIEW_SUSPENSION_UNTIL, reason).getResponse())).not.toContain('9999');
  });

  it('carries the public reason of the sanction in details, nothing about who reported it', () => {
    const until = new Date('2027-01-31T12:00:00.000Z');
    expect(suspendedAccountError(until, reason).getResponse()).toMatchObject({ details: { reason } });
    expect(suspendedSessionError(PENDING_REVIEW_SUSPENSION_UNTIL, reason).getResponse()).toMatchObject({
      details: { pendingReview: true, reason },
    });
  });

  it('refuses a banned account with 403 ACCOUNT_BANNED and the reason', () => {
    const error = bannedAccountError(reason);
    expect(error.getStatus()).toBe(403);
    expect(error.getResponse()).toEqual({
      code: 'ACCOUNT_BANNED',
      message: 'Cerramos tu cuenta por incumplir las normas de la comunidad.',
      details: { reason },
    });
  });
});
