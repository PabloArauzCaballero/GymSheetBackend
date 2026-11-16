import { ACCOUNT_CLOSURE_STEPS } from './account-closure.catalog';
import { mapClosurePreview } from './account-closure.mapper';

describe('ACCOUNT_CLOSURE_STEPS', () => {
  it('gives every anonymization a SET clause and every kept or anonymized row a reason', () => {
    for (const step of ACCOUNT_CLOSURE_STEPS) {
      if (step.disposition === 'ANONYMIZED') expect([step.table, Boolean(step.set)]).toEqual([step.table, true]);
      if (step.disposition !== 'DELETED') expect([step.table, Boolean(step.reason)]).toEqual([step.table, true]);
      if (step.disposition === 'KEPT') expect([step.table, step.mediaKey]).toEqual([step.table, undefined]);
    }
  });

  it('scopes every predicate to the closing account and leaves the account row to the repository', () => {
    for (const step of ACCOUNT_CLOSURE_STEPS) {
      expect([step.table, step.where.includes(':userId')]).toEqual([step.table, true]);
    }
    expect(ACCOUNT_CLOSURE_STEPS.some((step) => step.table === 'public.usuarios')).toBe(false);
  });

  it('collects the files of photos, stories, reels, chat media and comment attachments', () => {
    const withMedia = new Set(ACCOUNT_CLOSURE_STEPS.filter((step) => step.mediaKey).map((step) => step.table));
    expect([...withMedia].sort()).toEqual(['chat.messages', 'community.content_comments', 'profile.photos', 'profile.stories', 'social.reels']);
  });

  it('previews only tables with rows, grouped by what happens to them', () => {
    const [deleted, kept] = [ACCOUNT_CLOSURE_STEPS[0], ACCOUNT_CLOSURE_STEPS.find((step) => step.disposition === 'KEPT')!];
    const preview = mapClosurePreview(
      [{ step: deleted, count: 2 }, { step: kept, count: 1 }, { step: ACCOUNT_CLOSURE_STEPS[1], count: 0 }],
      { allowed: true, pinAllowed: false },
    );
    expect(preview.deleted).toEqual([{ table: deleted.table, label: deleted.label, count: 2, reason: null }]);
    expect(preview.kept).toHaveLength(1);
    expect(preview.anonymized).toEqual([]);
    expect(preview.proof).toEqual({ password: true, emailPin: false });
  });
});
