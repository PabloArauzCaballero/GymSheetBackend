export type ReadReceiptSettings = {
  enabled: boolean;
  overrides: Record<string, boolean>;
  version: number;
};

export type ReadReceiptCommand =
  | { expectedVersion: number; scope: 'ALL'; enabled: boolean }
  | { expectedVersion: number; scope: 'CONVERSATION'; conversationId: string; enabled: boolean }
  | { expectedVersion: number; scope: 'SELECTED'; conversationIds: string[]; enabled: boolean };

const MAX_SELECTED_CONVERSATIONS = 100;
const MAX_CONVERSATION_ID_LENGTH = 128;

export function defaultReadReceiptSettings(): ReadReceiptSettings {
  return { enabled: true, overrides: {}, version: 0 };
}

export function isReadReceiptEnabled(settings: ReadReceiptSettings, conversationId: string): boolean {
  return settings.overrides[conversationId] ?? settings.enabled;
}

/** A public read receipt requires consent from both sides for this conversation. */
export function canPublishReadReceipt(
  readerSettings: ReadReceiptSettings,
  senderSettings: ReadReceiptSettings,
  conversationId: string,
): boolean {
  return isReadReceiptEnabled(readerSettings, conversationId) &&
    isReadReceiptEnabled(senderSettings, conversationId);
}

function validateSelectedIds(ids: string[]): string[] {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_SELECTED_CONVERSATIONS ||
      ids.some((id) => typeof id !== 'string' || id.trim().length === 0 || id.length > MAX_CONVERSATION_ID_LENGTH)) {
    throw new Error('INVALID_CONVERSATION_SELECTION');
  }
  return [...new Set(ids)];
}

export function applyReadReceiptCommand(
  current: ReadReceiptSettings,
  command: ReadReceiptCommand,
): ReadReceiptSettings {
  if (command.expectedVersion !== current.version) throw new Error('READ_RECEIPT_VERSION_CONFLICT');
  if (typeof command.enabled !== 'boolean') throw new Error('INVALID_READ_RECEIPT_SETTING');

  let enabled = current.enabled;
  const overrides = { ...current.overrides };
  if (command.scope === 'ALL') {
    enabled = command.enabled;
    // "Para todas" also defines the behavior of future conversations.
    for (const key of Object.keys(overrides)) delete overrides[key];
  } else if (command.scope === 'CONVERSATION') {
    const [conversationId] = validateSelectedIds([command.conversationId]);
    overrides[conversationId] = command.enabled;
  } else {
    for (const conversationId of validateSelectedIds(command.conversationIds)) {
      overrides[conversationId] = command.enabled;
    }
  }
  return { enabled, overrides, version: current.version + 1 };
}
