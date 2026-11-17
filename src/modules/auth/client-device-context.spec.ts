import { Request } from 'express';
import { clientDeviceContext } from './client-device-context';

function requestWith(headers: Record<string, string>, ip = '198.51.100.4'): Request {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return { ip, header: (name: string) => lower[name.toLowerCase()] } as unknown as Request;
}

describe('clientDeviceContext', () => {
  it('reads and bounds the device headers', () => {
    const context = clientDeviceContext(
      requestWith({
        'X-Installation-Id': '3F2B8C1E-5A4D-4E6F-9A1B-2C3D4E5F6A7B',
        'X-Client-Platform': 'ios',
        'X-App-Version': '2.4.0 (118)',
        'X-OS-Version': '18.1',
        'X-Device-Model': 'iPhone15,2',
        'User-Agent': 'GymSheet/2.4.0',
      }),
      'ip-secret',
    );
    expect(context).toEqual({
      installationId: '3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b',
      platform: 'IOS',
      appVersion: '2.4.0 (118)',
      osVersion: '18.1',
      deviceModel: 'iPhone15,2',
      userAgent: 'GymSheet/2.4.0',
      ipHmac: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
  });

  it('ignores invalid values instead of failing the request', () => {
    const context = clientDeviceContext(
      requestWith({
        'X-Installation-Id': 'not-a-uuid',
        'X-Client-Platform': 'symbian',
        'X-App-Version': 'x'.repeat(41),
        'X-OS-Version': '<script>',
        'X-Device-Model': 'model\u0000null',
      }),
      undefined,
    );
    expect(context).toMatchObject({
      installationId: null,
      platform: 'UNKNOWN',
      appVersion: null,
      osVersion: null,
      deviceModel: null,
      ipHmac: null,
    });
  });
});
