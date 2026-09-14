import { DevicePlatform } from '../device-token.model';
import { ExpoPushTransport } from './expo-push.transport';
import { PushMessage, PushTarget } from './push.transport';

const message: PushMessage = {
  title: 'Camila',
  body: '¿Entrenamos mañana?',
  url: null,
};

function target(suffix: string): PushTarget {
  return {
    id: `target-${suffix}`,
    platform: DevicePlatform.ANDROID,
    pushToken: `ExponentPushToken[${suffix}]`,
    p256dh: null,
    auth: null,
  };
}

/** El cuerpo que se le mandó a Expo, ya como objetos. */
function bodySentOn(call: [string, RequestInit]): Array<Record<string, unknown>> {
  const [, init] = call;
  return JSON.parse(typeof init.body === 'string' ? init.body : '[]') as Array<
    Record<string, unknown>
  >;
}

function respondWith(payload: unknown, ok = true, status = 200) {
  return jest.fn().mockResolvedValue({ ok, status, json: async () => payload });
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

/**
 * Portado de `expo-push.service.spec.ts` al dividir el servicio en puerto y
 * adaptador (ADR-0011). Lo que cambió no es la lógica de Expo sino quién decide
 * qué hacer con ella: el transporte ya no toca el repositorio, sólo CLASIFICA
 * cada destino, y es el despachador quien da de baja lo que vuelve como `GONE`.
 */
describe('ExpoPushTransport', () => {
  it('no llama a Expo cuando no hay destinos', async () => {
    const fetchMock = respondWith({ data: [] });
    global.fetch = fetchMock;

    await expect(new ExpoPushTransport().send([], message)).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('manda un mensaje por destino, con título y cuerpo', async () => {
    const fetchMock = respondWith({
      data: [
        { status: 'ok', id: 'ticket-1' },
        { status: 'ok', id: 'ticket-2' },
      ],
    });
    global.fetch = fetchMock;

    const outcomes = await new ExpoPushTransport().send(
      [target('aaa'), target('bbb')],
      message,
    );

    const sent = bodySentOn(fetchMock.mock.calls[0] as [string, RequestInit]);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      to: 'ExponentPushToken[aaa]',
      title: 'Camila',
      body: '¿Entrenamos mañana?',
    });
    expect(outcomes).toEqual([
      { targetId: 'target-aaa', status: 'DELIVERED' },
      { targetId: 'target-bbb', status: 'DELIVERED' },
    ]);
  });

  it('marca GONE el token que Expo declara no registrado, y sigue con el resto', async () => {
    global.fetch = respondWith({
      data: [
        { status: 'error', details: { error: 'DeviceNotRegistered' } },
        { status: 'ok', id: 'ticket-2' },
      ],
    });

    const outcomes = await new ExpoPushTransport().send(
      [target('muerto'), target('vivo')],
      message,
    );

    expect(outcomes).toEqual([
      { targetId: 'target-muerto', status: 'GONE' },
      { targetId: 'target-vivo', status: 'DELIVERED' },
    ]);
  });

  it('no marca GONE por un error que puede dejar de darse', async () => {
    global.fetch = respondWith({
      data: [{ status: 'error', details: { error: 'MessageRateExceeded' } }],
    });

    const outcomes = await new ExpoPushTransport().send([target('aaa')], message);

    expect(outcomes).toEqual([{ targetId: 'target-aaa', status: 'FAILED' }]);
  });

  /**
   * Un ticket ausente (la respuesta trajo menos de los que se pidieron) es fallo
   * transitorio y NO baja: dar de baja por una respuesta incompleta apagaría el
   * push de un dispositivo sano.
   */
  it('trata un ticket ausente como fallo, no como baja', async () => {
    global.fetch = respondWith({ data: [{ status: 'ok', id: 'ticket-1' }] });

    const outcomes = await new ExpoPushTransport().send(
      [target('aaa'), target('bbb')],
      message,
    );

    expect(outcomes[1]).toEqual({ targetId: 'target-bbb', status: 'FAILED' });
  });

  it('un 5xx de Expo no tumba a quien llama', async () => {
    global.fetch = respondWith({}, false, 502);

    // Best-effort por diseño: la notificación in-app ya está guardada.
    await expect(new ExpoPushTransport().send([target('aaa')], message)).resolves.toEqual([
      { targetId: 'target-aaa', status: 'FAILED' },
    ]);
  });

  it('una red caída tampoco lanza', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(new ExpoPushTransport().send([target('aaa')], message)).resolves.toEqual([
      { targetId: 'target-aaa', status: 'FAILED' },
    ]);
  });

  it('trocea en peticiones de como mucho 100 mensajes', async () => {
    const fetchMock = jest.fn().mockImplementation(async (url: string, init: RequestInit) => {
      const batch = bodySentOn([url, init]);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: batch.map((_message, index) => ({ status: 'ok', id: `t-${index}` })),
        }),
      };
    });
    global.fetch = fetchMock;
    const targets = Array.from({ length: 101 }, (_value, index) => target(`d${index}`));

    const outcomes = await new ExpoPushTransport().send(targets, message);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sizes = fetchMock.mock.calls.map(
      (call) => bodySentOn(call as [string, RequestInit]).length,
    );
    expect(sizes).toEqual([100, 1]);
    expect(outcomes).toHaveLength(101);
    expect(outcomes.every((outcome) => outcome.status === 'DELIVERED')).toBe(true);
  });
});
