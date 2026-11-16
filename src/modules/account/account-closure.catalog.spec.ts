import { ACCOUNT_CLOSURE_STEPS } from './account-closure.catalog';
import { mapClosurePreview } from './account-closure.mapper';
import { mediaKeysOf } from './account-closure.steps';

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

  it('collects the files of photos, stories, reels, chat media, comment attachments, verification selfies and personal exercise uploads', () => {
    const withMedia = new Set(ACCOUNT_CLOSURE_STEPS.filter((step) => step.mediaKey).map((step) => step.table));
    expect([...withMedia].sort()).toEqual([
      'chat.messages', 'community.content_comments', 'profile.photos', 'profile.stories', 'social.photo_verifications', 'social.reels',
      'training.exercise_media',
    ]);
  });

  it('deletes every verification attempt of the member and releases its selfie', () => {
    const steps = ACCOUNT_CLOSURE_STEPS.filter((step) => step.table === 'social.photo_verifications');
    expect(steps).toEqual([expect.objectContaining({ disposition: 'DELETED', where: 't.user_id = :userId', mediaKey: 't.selfie_storage_key' })]);
  });

  it('erases personal exercise uploads from the owner folder before the exercises themselves', () => {
    const uploads = ACCOUNT_CLOSURE_STEPS.findIndex((step) => step.table === 'training.exercise_media');
    const exercises = ACCOUNT_CLOSURE_STEPS.findIndex((step) => step.table === 'public.ejercicios');
    expect(uploads).toBeGreaterThanOrEqual(0);
    expect(uploads).toBeLessThan(exercises);
    expect(ACCOUNT_CLOSURE_STEPS[uploads].where).toContain("'/ejercicios/%'");
    expect(ACCOUNT_CLOSURE_STEPS[uploads].where).toContain("e.tipo_ejercicio = 'PERSONAL'");
  });

  it('releases both files of a personal exercise upload at closure: the file and its poster', () => {
    const uploads = ACCOUNT_CLOSURE_STEPS.find((step) => step.table === 'training.exercise_media' && step.disposition === 'DELETED');
    const keys = mediaKeysOf(uploads?.mediaKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toContain('t.url');
    expect(keys[1]).toContain('t.thumbnail_url');
    for (const key of keys) expect(key).toContain("'/ejercicios/%'");
  });

  it('keeps a reported personal exercise and its uploads (held ones included) as evidence', () => {
    const steps = (table: string) => ACCOUNT_CLOSURE_STEPS.filter((step) => step.table === table);
    const reportedExercise = "r.target_kind = 'EXERCISE' AND r.target_id = t.ejercicio_id";
    const [deletedUploads, keptUploads] = steps('training.exercise_media');
    expect(deletedUploads).toMatchObject({ disposition: 'DELETED' });
    expect(deletedUploads.where).toContain(`NOT EXISTS (SELECT 1 FROM moderation.reports r WHERE ${reportedExercise})`);
    expect(keptUploads).toMatchObject({ disposition: 'KEPT' });
    expect(keptUploads.where).toContain(`AND EXISTS (SELECT 1 FROM moderation.reports r WHERE ${reportedExercise})`);
    expect(keptUploads.where.replace(/AND EXISTS \(SELECT 1 FROM moderation\.reports r WHERE [^)]*\)$/u, ''))
      .toBe(deletedUploads.where.replace(/AND NOT EXISTS \(SELECT 1 FROM moderation\.reports r WHERE [^)]*\)$/u, ''));

    const exercises = steps('public.ejercicios');
    const deleted = exercises.find((step) => step.disposition === 'DELETED');
    expect(deleted?.where).toContain("NOT EXISTS (SELECT 1 FROM moderation.reports r WHERE r.target_kind = 'EXERCISE' AND r.target_id = t.id)");
    expect(exercises.filter((step) => step.disposition === 'KEPT' && step.where.includes("r.target_kind = 'EXERCISE'"))).toHaveLength(1);
  });

  it('keeps the moderation evidence of franja 4 (no FK, so the e2e FK scan cannot see it)', () => {
    for (const table of ['moderation.chat_message_evidence', 'moderation.auto_hide_reviews']) {
      const steps = ACCOUNT_CLOSURE_STEPS.filter((step) => step.table === table);
      expect([table, steps.map((step) => step.disposition)]).toEqual([table, ['KEPT']]);
    }
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

  it("a staff closure leaves the members' gym chats and the routines assigned to them in place", () => {
    const deleted = (table: string) => ACCOUNT_CLOSURE_STEPS.filter((step) => step.table === table && step.disposition === 'DELETED');
    for (const step of deleted('chat.conversations')) expect(step.where).toContain('p.can_write = false');
    expect(deleted('training.routine_assignments').map((step) => step.where)).toEqual(['t.cliente_user_id = :userId']);
    const keptAssignments = ACCOUNT_CLOSURE_STEPS.find((step) => step.table === 'training.routine_assignments' && step.disposition === 'KEPT');
    expect(keptAssignments?.where).toContain('t.asignado_por_user_id = :userId');
    const ownRoutines = deleted('training.routines')[0];
    expect(ownRoutines.where).toContain('es_oficial');
    expect(ownRoutines.where).toContain('training.routine_assignments');
    const staffProfile = ACCOUNT_CLOSURE_STEPS.find((step) => step.table === 'membership.staff_profiles');
    expect(staffProfile).toMatchObject({ disposition: 'ANONYMIZED' });
    expect(staffProfile?.set).toContain("employment_status = 'TERMINATED'");
  });

  it('drops pending notice emails of the account except the one marked to survive the closure', () => {
    const outbox = ACCOUNT_CLOSURE_STEPS.find((step) => step.table === 'integration.outbox_jobs');
    expect(outbox?.where).toContain("t.payload->>'survivesClosure' = 'false'");
    expect(outbox?.where).toContain("t.payload->>'recipientUserId' = CAST(:userId AS text)");
  });
});
