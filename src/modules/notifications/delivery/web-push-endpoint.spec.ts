import { isAllowedWebPushEndpoint } from './web-push-endpoint';

describe('isAllowedWebPushEndpoint', () => {
  const allowed = ['fcm.googleapis.com', 'updates.push.services.mozilla.com'];

  it('accepts an HTTPS endpoint of an allowlisted push service', () => {
    expect(
      isAllowedWebPushEndpoint('https://fcm.googleapis.com/fcm/send/abc123', allowed),
    ).toBe(true);
  });

  it('rejects a host outside the allowlist (SSRF guard)', () => {
    expect(isAllowedWebPushEndpoint('https://169.254.169.254/latest/meta-data', allowed)).toBe(
      false,
    );
    expect(isAllowedWebPushEndpoint('https://evil.example.com/push', allowed)).toBe(false);
  });

  it('rejects a subdomain that merely ends with an allowlisted host', () => {
    expect(
      isAllowedWebPushEndpoint('https://fcm.googleapis.com.evil.example/push', allowed),
    ).toBe(false);
  });

  it('rejects non-HTTPS schemes, including loopback and file', () => {
    expect(isAllowedWebPushEndpoint('http://fcm.googleapis.com/fcm/send/x', allowed)).toBe(false);
    expect(isAllowedWebPushEndpoint('file:///etc/passwd', allowed)).toBe(false);
  });

  it('rejects a value that is not a URL at all', () => {
    expect(isAllowedWebPushEndpoint('not-a-url', allowed)).toBe(false);
    expect(isAllowedWebPushEndpoint('', allowed)).toBe(false);
  });

  it('rejects everything when the allowlist is empty', () => {
    expect(isAllowedWebPushEndpoint('https://fcm.googleapis.com/fcm/send/x', [])).toBe(false);
  });
});
