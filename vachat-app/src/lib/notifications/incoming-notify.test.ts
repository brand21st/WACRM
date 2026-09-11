import { describe, expect, it } from 'vitest';

import { shouldNotifyIncoming, viewingConversationIdFromPath } from './incoming-notify';
import { parseIncomingAlertPrefs } from './incoming-prefs-parse';

const base = {
  senderType: 'customer',
  conversationId: 'conv-1',
  messageId: 'msg-1',
  viewingConversationId: null as string | null,
  appInactive: false,
  alreadySeen: false,
};

describe('shouldNotifyIncoming', () => {
  it('alerts on a new inbound customer message', () => {
    expect(shouldNotifyIncoming(base)).toEqual({
      sound: true,
      toast: true,
      push: false,
    });
  });

  it('uses a system notification only when the app is in the background', () => {
    expect(shouldNotifyIncoming({ ...base, appInactive: true })).toEqual({
      sound: true,
      toast: true,
      push: true,
    });
  });

  it('skips when the agent is looking at that thread', () => {
    expect(
      shouldNotifyIncoming({
        ...base,
        viewingConversationId: 'conv-1',
        appInactive: false,
      }),
    ).toEqual({ sound: false, toast: false, push: false });
  });

  it('still alerts if the thread is open but the app is backgrounded', () => {
    expect(
      shouldNotifyIncoming({
        ...base,
        viewingConversationId: 'conv-1',
        appInactive: true,
      }),
    ).toEqual({ sound: true, toast: true, push: true });
  });

  it('ignores agent, bot, duplicate rows, and call bubbles', () => {
    expect(shouldNotifyIncoming({ ...base, senderType: 'agent' }).sound).toBe(false);
    expect(shouldNotifyIncoming({ ...base, senderType: 'bot' }).sound).toBe(false);
    expect(shouldNotifyIncoming({ ...base, alreadySeen: true }).sound).toBe(false);
    expect(shouldNotifyIncoming({ ...base, contentType: 'call' }).sound).toBe(false);
  });
});

describe('viewingConversationIdFromPath', () => {
  it('reads /chat/:id only', () => {
    expect(viewingConversationIdFromPath('/chat/abc')).toBe('abc');
    expect(viewingConversationIdFromPath('/chat/abc?x=1')).toBe('abc');
    expect(viewingConversationIdFromPath('/(tabs)/chats')).toBeNull();
    expect(viewingConversationIdFromPath('/')).toBeNull();
  });
});

describe('parseIncomingAlertPrefs', () => {
  it('defaults both flags on, and ignores junk', () => {
    expect(parseIncomingAlertPrefs(null)).toEqual({ sound: true, push: true });
    expect(parseIncomingAlertPrefs('{nope')).toEqual({ sound: true, push: true });
    expect(parseIncomingAlertPrefs('{"sound":false}')).toEqual({ sound: false, push: true });
  });
});
