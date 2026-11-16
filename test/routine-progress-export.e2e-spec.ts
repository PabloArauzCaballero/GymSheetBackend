import request from 'supertest';
import { bootE2eApp, E2eApp } from './support/e2e-app';

const binaryParser = (res: request.Response, done: (error: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

/**
 * POST /export/routine-progress tiene dos contratos: con `Accept: application/json`
 * devuelve el archivo en base64 dentro del sobre; con cualquier otro Accept
 * devuelve el archivo tal cual. El CSV de la rama binaria salía envuelto en
 * `{ ok, data }` porque el interceptor leía el Content-Type antes del handler.
 */
describe('Routine progress export (e2e)', () => {
  let e2e: E2eApp;
  let token: string;

  beforeAll(async () => {
    e2e = await bootE2eApp();
    ({ token } = await e2e.register('rp-export'));
  });

  afterAll(async () => {
    await e2e.app.close();
  });

  it('returns the raw CSV, not an envelope, when the file itself is asked for', async () => {
    const response = await e2e
      .as(token)
      .post('/export/routine-progress')
      .set('Accept', 'text/csv')
      .send({ format: 'csv' })
      .expect(201);

    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename="repp-progreso-rutinas-.+\.csv"$/,
    );
    expect(response.text.replace(/^\uFEFF/, '')).toMatch(/^rutina_id,rutina_nombre,/);
    expect(response.text).not.toContain('"ok"');
  });

  it('returns the raw PDF and XLSX bytes', async () => {
    const pdf = await e2e
      .as(token)
      .post('/export/routine-progress')
      .set('Accept', '*/*')
      .send({ format: 'pdf' })
      .buffer(true)
      .parse(binaryParser)
      .expect(201);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    const xlsx = await e2e
      .as(token)
      .post('/export/routine-progress')
      .set('Accept', '*/*')
      .send({ format: 'excel' })
      .buffer(true)
      .parse(binaryParser)
      .expect(201);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });

  it.each(['csv', 'pdf', 'excel'])(
    'keeps the JSON contract (%s in base64 inside the envelope) with Accept: application/json',
    async (format) => {
      const response = await e2e
        .as(token)
        .post('/export/routine-progress')
        .set('Accept', 'application/json')
        .send({ format })
        .expect(201);

      expect(response.headers['content-type']).toContain('application/json');
      expect(response.body.ok).toBe(true);
      expect(response.body.data).toMatchObject({
        fileName: expect.stringMatching(/^repp-progreso-rutinas-/),
        mimeType: expect.any(String),
        recordsCount: 0,
        base64: expect.any(String),
      });
      expect((response.body.data.base64 as string).length).toBeGreaterThan(0);
    },
  );

  it('rejects an anonymous request', async () => {
    await request(e2e.http)
      .post(e2e.url('/export/routine-progress'))
      .send({ format: 'csv' })
      .expect(401);
  });
});
