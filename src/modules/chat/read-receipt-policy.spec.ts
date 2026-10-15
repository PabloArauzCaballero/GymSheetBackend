import {
  applyReadReceiptCommand,
  canPublishReadReceipt,
  defaultReadReceiptSettings,
  isReadReceiptEnabled,
} from './read-receipt-policy';

describe('read-receipt-policy', () => {
  it('defaults to enabled and applies a conversation override only there', () => {
    const initial = defaultReadReceiptSettings();
    expect(isReadReceiptEnabled(initial, 'conversation-a')).toBe(true);
    const next = applyReadReceiptCommand(initial, {
      expectedVersion: 0,
      scope: 'CONVERSATION',
      conversationId: 'conversation-a',
      enabled: false,
    });
    expect(isReadReceiptEnabled(next, 'conversation-a')).toBe(false);
    expect(isReadReceiptEnabled(next, 'conversation-b')).toBe(true);
  });

  it('applies selected conversations without altering other exceptions', () => {
    const initial = {
      enabled: true,
      overrides: { 'conversation-c': false },
      version: 4,
    };
    const next = applyReadReceiptCommand(initial, {
      expectedVersion: 4,
      scope: 'SELECTED',
      conversationIds: ['conversation-a', 'conversation-b'],
      enabled: false,
    });
    expect(next.overrides).toEqual({
      'conversation-a': false,
      'conversation-b': false,
      'conversation-c': false,
    });
    expect(next.version).toBe(5);
  });

  it('applies all by changing the default and clearing old exceptions', () => {
    const initial = { enabled: true, overrides: { 'conversation-a': false }, version: 2 };
    const next = applyReadReceiptCommand(initial, {
      expectedVersion: 2,
      scope: 'ALL',
      enabled: false,
    });
    expect(next).toEqual({ enabled: false, overrides: {}, version: 3 });
    expect(isReadReceiptEnabled(next, 'new-conversation')).toBe(false);
  });

  it('publishes a receipt only when both participants permit it', () => {
    const enabled = defaultReadReceiptSettings();
    const disabled = applyReadReceiptCommand(enabled, {
      expectedVersion: 0,
      scope: 'CONVERSATION',
      conversationId: 'conversation-a',
      enabled: false,
    });
    expect(canPublishReadReceipt(enabled, enabled, 'conversation-a')).toBe(true);
    expect(canPublishReadReceipt(enabled, disabled, 'conversation-a')).toBe(false);
  });

  it('rejects stale settings writes and invalid/oversized selections', () => {
    const initial = defaultReadReceiptSettings();
    expect(() => applyReadReceiptCommand(initial, {
      expectedVersion: 1,
      scope: 'ALL',
      enabled: false,
    })).toThrow('READ_RECEIPT_VERSION_CONFLICT');
    expect(() => applyReadReceiptCommand(initial, {
      expectedVersion: 0,
      scope: 'SELECTED',
      conversationIds: [''],
      enabled: false,
    })).toThrow('INVALID_CONVERSATION_SELECTION');
    expect(() => applyReadReceiptCommand(initial, {
      expectedVersion: 0,
      scope: 'SELECTED',
      conversationIds: Array.from({ length: 101 }, (_, index) => `conversation-${index}`),
      enabled: false,
    })).toThrow('INVALID_CONVERSATION_SELECTION');
  });
});
