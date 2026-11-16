import request from 'supertest';
import { KycBusiness, KycHarness, bootKycHarness, letters, randomDigits } from './support/kyc-e2e';

type Account = { token: string; id: string };

describe("REPP's KYC console: queues, viewer, decisions and accounts (e2e, franja 8b)", () => {
  let h: KycHarness;
  let moderator: Account;
  let otherModerator: Account;
  let previousTerms: { term: string; scope: string }[] = [];

  beforeAll(async () => {
    h = await bootKycHarness();
    moderator = await h.e2e.register('kyc-moderator');
    await h.e2e.promote(moderator.id, 'MODERATOR');
    otherModerator = await h.e2e.register('kyc-moderator-b');
    await h.e2e.promote(otherModerator.id, 'MODERATOR');
    previousTerms = (await h.e2e.as(moderator.token).get('/admin/business/banned-terms').expect(200)).body.data.terms;
  }, 60000);

  afterAll(async () => {
    await h.e2e.as(moderator.token).put('/admin/business/banned-terms').send({ terms: previousTerms });
    await h.close();
  });

  const submitted = async (label: string, options: { nit?: string; email?: string } = {}) => {
    const owner = await h.ready(label, options);
    const response = await h.e2e.as(owner.token).post('/business/me/kyc/submit').expect(200);
    return { owner, submissionId: response.body.data.submissionId as string, status: response.body.data.status as string };
  };
  const audits = (action: string, targetId: string) =>
    h.select<{ actor: string }>(
      `SELECT actor_user_id AS actor FROM admin.audit_log WHERE domain = 'business' AND action = :action AND target_id = :targetId`,
      { action, targetId },
    );
  const entityOf = async (owner: KycBusiness) =>
    (await h.select<{ status: string; isVerified: boolean; name: string }>(
      'SELECT status, is_verified AS "isVerified", name FROM directory.entities WHERE id = :id',
      { id: owner.entityId },
    ))[0];

  it('403 for gym staff, members and business accounts on admin/business/*', async () => {
    const gymAdmin = await h.e2e.register('kyc-gym-admin');
    await h.e2e.promote(gymAdmin.id, 'ADMIN');
    const person = await h.e2e.register('kyc-member');
    const business = await h.business('kyc-console-biz');
    for (const path of ['/admin/business/kyc/queue?queue=REVIEW', '/admin/business/accounts', '/admin/business/blocklist']) {
      for (const [who, token, code] of [['gym ADMIN', gymAdmin.token, undefined], ['person', person.token, undefined], ['business', business.token, 'ACCOUNT_KIND_NOT_ALLOWED']] as const) {
        const response = await h.e2e.as(token).get(path);
        expect({ path, who, status: response.status }).toEqual({ path, who, status: 403 });
        if (code) expect(response.body.code).toBe(code);
      }
    }
    await request(h.e2e.http).get(h.e2e.url('/admin/business/kyc/queue?queue=REVIEW')).expect(401);
  });

  it('queues: REVIEW holds IN_REVIEW by due date, POST_REVIEW holds automatic approvals', async () => {
    const nit = randomDigits(10);
    const auto = await submitted('kyc-q-auto', { nit });
    const review = await submitted('kyc-q-review', { nit });
    expect([auto.status, review.status]).toEqual(['AUTO_APPROVED', 'IN_REVIEW']);
    const reviewQueue = (await h.e2e.as(moderator.token).get('/admin/business/kyc/queue?queue=REVIEW&limit=100').expect(200)).body.data;
    const item = reviewQueue.items.find((entry: { submissionId: string }) => entry.submissionId === review.submissionId);
    expect(item).toMatchObject({ status: 'IN_REVIEW', entityType: 'GYM', failedChecks: ['DUPLICATE_NIT'], overdue: false, claimedByUserId: null });
    const dueDates = reviewQueue.items.map((entry: { dueAt: string }) => entry.dueAt);
    expect(dueDates).toEqual([...dueDates].sort());
    const post = (await h.e2e.as(moderator.token).get('/admin/business/kyc/queue?queue=POST_REVIEW&limit=100').expect(200)).body.data;
    expect(post.items.map((entry: { submissionId: string }) => entry.submissionId)).toContain(auto.submissionId);
    await h.e2e.as(moderator.token).get('/admin/business/kyc/queue?queue=OTHER').expect(400);
    const metrics = await request(h.e2e.http).get(h.e2e.url('/health/metrics')).expect(200);
    expect(metrics.text).toMatch(/gym_sheet_kyc_queue_size\{queue="REVIEW"\} [1-9]\d*/u);
    expect(metrics.text).toContain('gym_sheet_kyc_auto_approval_ratio');
  }, 60000);

  it('the viewer streams the decrypted document with no-store, one audit row per view; detail shows the data in clear, audited', async () => {
    const { owner, submissionId } = await submitted('kyc-viewer');
    const detail = await h.e2e.as(moderator.token).get(`/admin/business/kyc/${submissionId}`).expect(200);
    expect(detail.headers['cache-control']).toContain('no-store');
    expect(detail.body.data.identity).toEqual({ nit: expect.stringMatching(/^\d{10}$/u), repCiNumber: expect.stringMatching(/^\d{7}$/u), phone: `+591${owner.phone}` });
    expect(await audits('kyc-detail-view', submissionId)).toEqual([{ actor: moderator.id }]);
    const document = detail.body.data.documents.find((doc: { kind: string }) => doc.kind === 'CI_FRONT');
    const path = `/admin/business/kyc/${submissionId}/documents/${document.id}`;

    const person = await h.e2e.register('kyc-viewer-person');
    await h.e2e.as(person.token).get(path).expect(403);
    await h.e2e.as(owner.token).get(path).expect(403);
    expect(await audits('kyc-document-view', document.id)).toEqual([]);

    for (let view = 0; view < 2; view += 1) {
      const response = await h.e2e.as(moderator.token).get(path).buffer(true).expect(200);
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.headers['content-disposition']).toContain('inline');
      expect(response.headers['content-type']).toContain('image/jpeg');
      expect(Buffer.compare(response.body as Buffer, h.photo)).toBe(0);
    }
    expect(await audits('kyc-document-view', document.id)).toHaveLength(2);
    // Another business's document id under this submission is not found.
    await h.e2e.as(moderator.token).get(`/admin/business/kyc/${submissionId}/documents/00000000-0000-4000-8000-000000000000`).expect(404);
  });

  it('a moderator never reviews a business registered with their own mailbox (403 MODERATION_SELF_CASE)', async () => {
    const mailbox = `kyc-self-${letters(8)}`;
    const self = await h.e2e.register(mailbox);
    await h.e2e.promote(self.id, 'MODERATOR');
    const [{ email }] = await h.select<{ email: string }>('SELECT email FROM public.usuarios WHERE id = :id', { id: self.id });
    const alias = email.replace('@', '+negocio@');
    const { submissionId } = await submitted('kyc-self', { email: alias });
    for (const call of [
      () => h.e2e.as(self.token).get(`/admin/business/kyc/${submissionId}`),
      () => h.e2e.as(self.token).post(`/admin/business/kyc/${submissionId}/claim`),
      () => h.e2e.as(self.token).post(`/admin/business/kyc/${submissionId}/decide`).send({ decision: 'POST_REVIEW_OK' }),
    ]) {
      const response = await call();
      expect([response.status, response.body.code]).toEqual([403, 'MODERATION_SELF_CASE']);
    }
    await h.e2e.as(moderator.token).get(`/admin/business/kyc/${submissionId}`).expect(200);
  });

  it('claim/release: another moderator gets 409; an approval makes it «Verificado por REPP»; deciding again is 409 KYC_INVALID_TRANSITION', async () => {
    const nit = randomDigits(10);
    await submitted('kyc-claim-a', { nit });
    const { owner, submissionId, status } = await submitted('kyc-claim-b', { nit });
    expect(status).toBe('IN_REVIEW');
    await h.e2e.as(moderator.token).post(`/admin/business/kyc/${submissionId}/claim`).expect(200);
    const taken = await h.e2e.as(otherModerator.token).post(`/admin/business/kyc/${submissionId}/claim`);
    expect([taken.status, taken.body.code]).toEqual([409, 'KYC_CLAIMED_BY_OTHER']);
    const blocked = await h.e2e.as(otherModerator.token).post(`/admin/business/kyc/${submissionId}/decide`).send({ decision: 'APPROVE' });
    expect([blocked.status, blocked.body.code]).toEqual([409, 'KYC_CLAIMED_BY_OTHER']);
    await h.e2e.as(otherModerator.token).post(`/admin/business/kyc/${submissionId}/release`).expect(409);
    await h.e2e.as(moderator.token).post(`/admin/business/kyc/${submissionId}/release`).expect(200);
    const postReview = await h.e2e.as(otherModerator.token).post(`/admin/business/kyc/${submissionId}/decide`).send({ decision: 'POST_REVIEW_OK' });
    expect([postReview.status, postReview.body.code]).toEqual([409, 'KYC_INVALID_TRANSITION']);
    const approved = await h.e2e.as(otherModerator.token).post(`/admin/business/kyc/${submissionId}/decide`).send({ decision: 'APPROVE' }).expect(200);
    expect(approved.body.data.status).toBe('APPROVED');
    expect(await entityOf(owner)).toMatchObject({ status: 'ACTIVE', isVerified: true });
    expect((await h.e2e.as(owner.token).get('/business/me/kyc').expect(200)).body.data).toMatchObject({ kycStatus: 'APPROVED', badge: 'VERIFIED' });
    await request(h.e2e.http).get(h.e2e.url(`/public/handles/${owner.handle}`)).expect(200);
    const again = await h.e2e.as(moderator.token).post(`/admin/business/kyc/${submissionId}/decide`).send({ decision: 'APPROVE' });
    expect([again.status, again.body.code]).toEqual([409, 'KYC_INVALID_TRANSITION']);
    expect(await audits('kyc-decide', submissionId)).toEqual([{ actor: otherModerator.id }]);
    const rejectWithoutReason = await h.e2e.as(moderator.token).post(`/admin/business/kyc/${submissionId}/decide`).send({ decision: 'REJECT', allowResubmit: true });
    expect(rejectWithoutReason.status).toBe(400);
  }, 60000);

  it('reject with resubmit: listing back to draft; resubmit waits 24 h, keeps the documents but the selfie, and stops after 3 attempts', async () => {
    const first = await submitted('kyc-resubmit');
    const owner = first.owner;
    let submissionId = first.submissionId;
    const reject = (id: string) =>
      h.e2e.as(moderator.token).post(`/admin/business/kyc/${id}/decide`).send({ decision: 'REJECT', reasonCodes: ['DOCUMENT_UNREADABLE'], allowResubmit: true }).expect(200);
    await reject(submissionId);
    expect(await entityOf(owner)).toMatchObject({ status: 'DRAFT', isVerified: false });
    await request(h.e2e.http).get(h.e2e.url(`/public/handles/${owner.handle}`)).expect(404);
    const state = (await h.e2e.as(owner.token).get('/business/me/kyc').expect(200)).body.data;
    expect(state.lastDecision).toMatchObject({ decision: 'REJECT', reasonCodes: ['DOCUMENT_UNREADABLE'], reasons: ['Uno de los documentos no se lee bien.'], allowResubmit: true });
    expect(state.attempts).toMatchObject({ used: 1, max: 3, canResubmit: false, resubmitAvailableAt: expect.any(String) });

    for (let attempt = 2; attempt <= 3; attempt += 1) {
      const early = await h.e2e.as(owner.token).post('/business/me/kyc/resubmit');
      expect([early.status, early.body.code]).toEqual([409, 'KYC_RESUBMIT_COOLDOWN']);
      await h.e2e.sql(`UPDATE business.kyc_submissions SET decided_at = now() - interval '25 hours' WHERE id = :submissionId`, { submissionId });
      const resubmitted = await h.e2e.as(owner.token).post('/business/me/kyc/resubmit').expect(201);
      expect(resubmitted.body.data.version).toBe(attempt);
      const draft = (await h.e2e.as(owner.token).get('/business/me/kyc').expect(200)).body.data;
      expect(draft.submission.documents.map((doc: { kind: string }) => doc.kind).sort()).toEqual(['CI_BACK', 'CI_FRONT']);
      expect(draft.missing).toEqual(['DOCUMENT_SELFIE']);
      await h.e2e.as(owner.token).post('/business/me/kyc/selfie-challenge').expect(201);
      await h.e2e.as(owner.token).post('/business/me/kyc/documents').field('kind', 'SELFIE').attach('file', h.photo, 'selfie.jpg').expect(201);
      submissionId = (await h.e2e.as(owner.token).post('/business/me/kyc/submit').expect(200)).body.data.submissionId as string;
      await reject(submissionId);
    }
    await h.e2e.sql(`UPDATE business.kyc_submissions SET decided_at = now() - interval '25 hours' WHERE id = :submissionId`, { submissionId });
    const exhausted = await h.e2e.as(owner.token).post('/business/me/kyc/resubmit');
    expect([exhausted.status, exhausted.body.code, exhausted.body.details]).toEqual([409, 'KYC_RESUBMIT_NOT_ALLOWED', { reason: 'MAX_ATTEMPTS' }]);
  }, 90000);

  it('a final rejection suspends the account and frees the reserved name', async () => {
    const { owner, submissionId } = await submitted('kyc-final');
    await h.e2e.as(moderator.token).post(`/admin/business/kyc/${submissionId}/decide`).send({ decision: 'REJECT', reasonCodes: ['FRAUD_SUSPECTED'], allowResubmit: false }).expect(200);
    expect(await entityOf(owner)).toMatchObject({ status: 'SUSPENDED' });
    const handle = await h.select<{ status: string }>('SELECT status FROM directory.handles WHERE handle = :handle', { handle: owner.handle });
    expect(handle).toEqual([{ status: 'RETIRED' }]);
    const resubmit = await h.e2e.as(owner.token).post('/business/me/kyc/resubmit');
    expect(resubmit.status).toBe(409);
  });

  it('a material change of an approved business is a new version that never approves itself', async () => {
    const { owner } = await submitted('kyc-change');
    const rename = await h.e2e.as(owner.token).patch('/business/me/profile').send({ name: `Nuevo ${letters(12)}` });
    expect([rename.status, rename.body.code, rename.body.details]).toEqual([409, 'BUSINESS_MATERIAL_CHANGE_REQUIRES_REVIEW', { action: 'POST /business/me/kyc/changes' }]);
    const change = await h.e2e.as(owner.token).post('/business/me/kyc/changes').expect(201);
    expect(change.body.data.version).toBe(2);
    const newName = `Cambio ${letters(12)}`;
    await h.e2e.as(owner.token).put('/business/me/kyc/draft').send({ tradeName: newName }).expect(200);
    const sent = await h.e2e.as(owner.token).post('/business/me/kyc/submit').expect(200);
    expect(sent.body.data).toMatchObject({ status: 'IN_REVIEW', userFacingCodes: ['MATERIAL_CHANGE'] });
    // The approved version stays in force meanwhile.
    expect(await entityOf(owner)).toMatchObject({ status: 'ACTIVE', name: owner.name });
    expect((await h.e2e.as(owner.token).get('/business/me/kyc').expect(200)).body.data.kycStatus).toBe('AUTO_APPROVED');
    await h.e2e.as(moderator.token).post(`/admin/business/kyc/${sent.body.data.submissionId}/decide`).send({ decision: 'APPROVE' }).expect(200);
    expect(await entityOf(owner)).toMatchObject({ status: 'ACTIVE', name: newName, isVerified: true });
  }, 60000);

  it('suspend and reinstate an approved account (audited, notified, listing hidden then back verified)', async () => {
    const { owner } = await submitted('kyc-suspend');
    await h.e2e.as(moderator.token).post(`/admin/business/accounts/${owner.id}/suspend`).send({ reasonCode: 'PAYMENT_COMPLAINTS' }).expect(200);
    expect(await entityOf(owner)).toMatchObject({ status: 'SUSPENDED' });
    await request(h.e2e.http).get(h.e2e.url(`/public/handles/${owner.handle}`)).expect(404);
    const twice = await h.e2e.as(moderator.token).post(`/admin/business/accounts/${owner.id}/suspend`).send({ reasonCode: 'OTHER' });
    expect([twice.status, twice.body.code]).toEqual([409, 'KYC_INVALID_TRANSITION']);
    await h.e2e.as(moderator.token).post(`/admin/business/accounts/${owner.id}/reinstate`).send({ reasonCode: 'OTHER' }).expect(200);
    expect(await entityOf(owner)).toMatchObject({ status: 'ACTIVE', isVerified: true });
    expect(await audits('account-suspend', owner.id)).toHaveLength(1);
    expect(await audits('account-reinstate', owner.id)).toHaveLength(1);
    const emails = await h.select<{ channel: string }>(
      `SELECT channel FROM notifications.messages WHERE recipient_user_id = :id AND subject = 'Suspendimos tu negocio'`,
      { id: owner.id },
    );
    expect(emails.map((row) => row.channel).sort()).toEqual(['EMAIL', 'IN_APP']);
    const listed = await h.e2e.as(moderator.token).get(`/admin/business/accounts?search=${encodeURIComponent(owner.name)}`).expect(200);
    expect(listed.body.data.items.map((row: { accountId: string }) => row.accountId)).toEqual([owner.id]);
  });

  it('blocklist (HMAC only, no oracle) and banned terms send a submit to review', async () => {
    const nit = randomDigits(10);
    const entry = await h.e2e.as(moderator.token).post('/admin/business/blocklist').send({ kind: 'NIT', value: nit, reasonCode: 'FRAUD' }).expect(201);
    const duplicate = await h.e2e.as(moderator.token).post('/admin/business/blocklist').send({ kind: 'NIT', value: nit, reasonCode: 'FRAUD' });
    expect([duplicate.status, duplicate.body.code]).toEqual([409, 'BLOCKLIST_ENTRY_EXISTS']);
    const listed = (await h.e2e.as(moderator.token).get('/admin/business/blocklist').expect(200)).body.data;
    expect(JSON.stringify(listed)).not.toContain(nit);
    const blocked = await submitted('kyc-blocked', { nit });
    expect(blocked.status).toBe('IN_REVIEW');
    const state = (await h.e2e.as(blocked.owner.token).get('/business/me/kyc').expect(200)).body.data;
    expect(JSON.stringify(state)).not.toContain('BLOCKLIST');
    await h.e2e.as(moderator.token).del(`/admin/business/blocklist/${entry.body.data.id}`).expect(204);

    const term = letters(9);
    await h.e2e.as(moderator.token).put('/admin/business/banned-terms').send({ terms: [...previousTerms, { term, scope: 'NAME' }] }).expect(200);
    const owner = await h.business('kyc-banned');
    await h.e2e.as(owner.token).patch('/business/me/profile').send({ name: `Tienda ${term} ${letters(6)}` }).expect(200);
    await h.verifyPhone(owner);
    await h.legal(owner, {});
    await h.documents(owner);
    const response = await h.e2e.as(owner.token).post('/business/me/kyc/submit').expect(200);
    expect(response.body.data.status).toBe('IN_REVIEW');
    const checks = await h.select<{ code: string }>(
      `SELECT code FROM business.kyc_checks WHERE submission_id = :id AND outcome <> 'PASS'`,
      { id: response.body.data.submissionId },
    );
    expect(checks).toEqual([{ code: 'BANNED_TERMS' }]);
  }, 60000);

  it('handle reservations protect a brand; a forced rename retires the old handle without redirect', async () => {
    const brand = `${letters(10)}fit`;
    await h.e2e.as(moderator.token).post('/admin/business/handles/reservations').send({ handle: brand, reason: 'Marca registrada' }).expect(201);
    const again = await h.e2e.as(moderator.token).post('/admin/business/handles/reservations').send({ handle: brand, reason: 'x' });
    expect([again.status, again.body.code]).toEqual([409, 'HANDLE_TAKEN']);
    const business = await h.business('kyc-brand');
    const claim = await h.e2e.as(business.token).put('/business/me/handle').send({ handle: brand });
    expect([claim.status, claim.body.code]).toEqual([422, 'HANDLE_RESERVED']);

    const { owner } = await submitted('kyc-impostor');
    const renamed = `${letters(10)}.renamed`;
    const forced = await h.e2e.as(moderator.token).post(`/admin/business/handles/${owner.handle}/force-rename`).send({ newHandle: renamed, reason: 'Suplantación' }).expect(200);
    expect(forced.body.data).toEqual({ handle: renamed, previous: owner.handle });
    await request(h.e2e.http).get(h.e2e.url(`/public/handles/${owner.handle}`)).expect(404);
    await request(h.e2e.http).get(h.e2e.url(`/public/handles/${renamed}`)).expect(200);
    const changes = await h.select<{ reason: string }>('SELECT reason FROM directory.handle_changes WHERE entity_id = :id', { id: owner.entityId });
    expect(changes).toEqual([{ reason: 'REPP_FORCED' }]);
    await h.e2e.as(moderator.token).del(`/admin/business/handles/reservations/${brand}`).expect(204);
  }, 60000);
});
