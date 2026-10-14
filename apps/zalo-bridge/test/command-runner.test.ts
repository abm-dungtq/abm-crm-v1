import type { BridgeCommandResult } from '@abm/contracts';
import { describe, expect, it, vi } from 'vitest';
import { CommandRunner, splitIntoChunks, type RunnerAccounts } from '../src/command-runner';
import type { ZaloUserProfile } from '../src/zalo-client';
import type { BridgeCommand, ResultDelivery } from '../src/crm-client';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function setup(overrides: {
  complete?: (r: { text: string }) => Promise<string>;
  send?: RunnerAccounts['send'];
  downloadImage?: (url: string, dir: string) => Promise<string | null>;
} = {}) {
  const results: { id: string; result: BridgeCommandResult }[] = [];
  const crm = {
    pollCommands: vi.fn(async () => [] as BridgeCommand[]),
    postResult: vi.fn(async (id: string, result: BridgeCommandResult): Promise<ResultDelivery> => {
      results.push({ id, result });
      return 'accepted';
    }),
  };
  const goclaw = {
    complete: vi.fn(overrides.complete ?? (async () => 'reply')),
    completeWithMedia: vi.fn(async () => 'media reply'),
  };
  let msgId = 100;
  const accounts = {
    login: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    send: vi.fn(overrides.send ?? (async () => ({ msgId: String(msgId++) }))),
    profile: vi.fn(async (): Promise<ZaloUserProfile | null> => null),
  };
  const sleep = vi.fn(async (_ms: number) => {});
  const runner = new CommandRunner({
    crm, goclaw, accounts, sendMinDelayMs: 1500, sendMaxDelayMs: 4000, sleep, random: () => 0.5,
    imageDir: 'media-tmp', downloadImage: overrides.downloadImage,
  });
  return { runner, crm, goclaw, accounts, sleep, results };
}

const command = (id: string, kind: BridgeCommand['kind'], payload: unknown, conversationId: string | null = 'conv-1', attempts = 1): BridgeCommand =>
  ({ id, kind, channelAccountId: 'acc-1', conversationId, payload, attempts, leaseExpiresAt: '2026-10-08T07:05:00.000Z' });

describe('splitIntoChunks', () => {
  it('cuts 4500 characters of lines into 3 chunks of whole lines without trimming', () => {
    const lines = Array.from({ length: 45 }, (_, i) => `  ${String(i).padStart(2, '0')}`.padEnd(99, '.'));
    const text = lines.join('\n');
    expect(text.length).toBe(4499);
    const chunks = splitIntoChunks(text);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((c) => c.length <= 2000)).toBe(true);
    expect(chunks.join('\n')).toBe(text);
    expect(chunks[1]!.startsWith('  20')).toBe(true);
  });

  it('cuts a single long line hard', () => {
    expect(splitIntoChunks('x'.repeat(4500)).map((c) => c.length)).toEqual([2000, 2000, 500]);
  });

  it('keeps short text whole and drops nothing but whitespace-only chunks', () => {
    expect(splitIntoChunks(' a\n\n b ')).toEqual([' a\n\n b ']);
    expect(splitIntoChunks(' \n ')).toEqual([]);
  });
});

describe('CommandRunner', () => {
  it('runs two commands of the same conversation one after another', async () => {
    const first = deferred<string>();
    const order: string[] = [];
    const { runner, results } = setup({
      complete: async ({ text }) => {
        order.push(`start ${text}`);
        const out = text === 'one' ? await first.promise : 'second reply';
        order.push(`end ${text}`);
        return out;
      },
    });
    runner.dispatch(command('c1', 'run_completion', { agentKey: 'bot', userId: 'u', text: 'one' }));
    runner.dispatch(command('c2', 'run_completion', { agentKey: 'bot', userId: 'u', text: 'two' }));
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['start one']);

    first.resolve('first reply');
    await runner.idle();
    expect(order).toEqual(['start one', 'end one', 'start two', 'end two']);
    expect(results).toEqual([
      { id: 'c1', result: { attempts: 1, ok: true, text: 'first reply' } },
      { id: 'c2', result: { attempts: 1, ok: true, text: 'second reply' } },
    ]);
  });

  it('runs commands of different conversations in parallel', async () => {
    const gate = deferred<string>();
    const started: string[] = [];
    const { runner } = setup({ complete: async ({ text }) => { started.push(text); return gate.promise; } });
    runner.dispatch(command('c1', 'run_completion', { agentKey: 'bot', userId: 'u', text: 'a' }, 'conv-1'));
    runner.dispatch(command('c2', 'run_completion', { agentKey: 'bot', userId: 'u', text: 'b' }, 'conv-2'));
    await new Promise((r) => setTimeout(r, 10));
    expect(started).toEqual(['a', 'b']);
    gate.resolve('x');
    await runner.idle();
  });

  it('sends 4500 characters as 3 messages with a human pause before each, reporting the first id', async () => {
    const { runner, accounts, sleep, results } = setup();
    const text = Array.from({ length: 45 }, () => 'y'.repeat(99)).join('\n');
    runner.dispatch(command('s1', 'send_zalo', { messageId: 'm1', threadId: 'cust-1', threadKind: 'direct', text }, 'conv-1', 2));
    await runner.idle();

    expect(accounts.send).toHaveBeenCalledTimes(3);
    for (const call of accounts.send.mock.calls) expect(call.slice(0, 3)).toEqual(['acc-1', 'cust-1', 'direct']);
    expect(accounts.send.mock.calls.every((call) => call[4] === 's1')).toBe(true);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2750, 2750, 2750]);
    expect(results).toEqual([{ id: 's1', result: { attempts: 2, ok: true, externalMsgId: '100' } }]);
  });

  it('passes replyTo only on the first chunk', async () => {
    const { runner, accounts } = setup();
    const replyTo = { msgId: 'm-ask', senderId: 'u1', senderName: 'Hùng' };
    const text = 'a\n' + 'b'.repeat(2000);
    runner.dispatch(command('s1', 'send_zalo', { threadId: 'g1', threadKind: 'group', text, replyTo }, 'conv-1', 1));
    await runner.idle();
    expect(accounts.send).toHaveBeenCalledTimes(2);
    expect(accounts.send.mock.calls[0]?.slice(0, 6)).toEqual(['acc-1', 'g1', 'group', 'a', 's1', replyTo]);
    expect(accounts.send.mock.calls[1]?.[5]).toBeUndefined();
    expect(accounts.send.mock.calls[1]?.[3]).toBe('b'.repeat(2000));
  });

  it('continues a partly sent message from the next chunk when the command is claimed again', async () => {
    let calls = 0;
    const { runner, accounts, results } = setup({
      send: async () => {
        calls += 1;
        if (calls === 2) throw Object.assign(new Error('ZALO_SEND_FAILED'), { code: 'ZALO_SEND_FAILED' });
        return { msgId: `z${calls}` };
      },
    });
    const text = Array.from({ length: 45 }, (_, i) => String(i).padEnd(99, '.')).join('\n');
    const chunks = splitIntoChunks(text);
    expect(chunks).toHaveLength(3);
    const payload = { messageId: 'm1', threadId: 'cust-1', threadKind: 'direct', text };
    runner.dispatch(command('s1', 'send_zalo', payload, 'conv-1', 1));
    await runner.idle();
    expect(results).toEqual([{ id: 's1', result: { attempts: 1, ok: false, error: 'ZALO_SEND_FAILED:PARTIAL_1_OF_3' } }]);

    runner.dispatch(command('s1', 'send_zalo', payload, 'conv-1', 2));
    await runner.idle();
    // The first chunk went out once; the failed one is retried, then the rest.
    expect(accounts.send.mock.calls.map((call) => call[3])).toEqual([chunks[0], chunks[1], chunks[1], chunks[2]]);
    expect(results.at(-1)).toEqual({ id: 's1', result: { attempts: 2, ok: true, externalMsgId: 'z1' } });

    // Once the Worker has the success, the command is forgotten: a later claim would send it as new.
    runner.dispatch(command('s1', 'send_zalo', payload, 'conv-1', 3));
    await runner.idle();
    expect(accounts.send).toHaveBeenCalledTimes(7);
  });

  it('does not send again when the success of a send could not be reported', async () => {
    const { runner, crm, accounts, results } = setup();
    crm.postResult.mockImplementationOnce(async (id: string, result: BridgeCommandResult) => {
      results.push({ id, result });
      return 'undelivered';
    });
    const payload = { messageId: 'm1', threadId: 'cust-1', threadKind: 'direct', text: 'a\n' + 'b'.repeat(2000) };
    runner.dispatch(command('s1', 'send_zalo', payload, 'conv-1', 1));
    await runner.idle();
    runner.dispatch(command('s1', 'send_zalo', payload, 'conv-1', 2));
    await runner.idle();
    expect(accounts.send).toHaveBeenCalledTimes(2);
    expect(results.map((r) => r.result)).toEqual([
      { attempts: 1, ok: true, externalMsgId: '100' },
      { attempts: 2, ok: true, externalMsgId: '100' },
    ]);
  });

  it('keeps the delivered chunks when the Worker ignores the success because a newer claim owns the command', async () => {
    const { runner, crm, accounts, results } = setup();
    crm.postResult.mockImplementationOnce(async (id: string, result: BridgeCommandResult) => {
      results.push({ id, result });
      return 'ignored';
    });
    const payload = { messageId: 'm1', threadId: 'cust-1', threadKind: 'direct', text: 'a\n' + 'b'.repeat(2000) };
    runner.dispatch(command('s1', 'send_zalo', payload, 'conv-1', 1));
    await runner.idle();
    expect(accounts.send).toHaveBeenCalledTimes(2);

    // The newer claim reports the same success without sending anything again, and is then forgotten.
    runner.dispatch(command('s1', 'send_zalo', payload, 'conv-1', 2));
    await runner.idle();
    expect(accounts.send).toHaveBeenCalledTimes(2);
    expect(results.map((r) => r.result)).toEqual([
      { attempts: 1, ok: true, externalMsgId: '100' },
      { attempts: 2, ok: true, externalMsgId: '100' },
    ]);
    runner.dispatch(command('s1', 'send_zalo', payload, 'conv-1', 3));
    await runner.idle();
    expect(accounts.send).toHaveBeenCalledTimes(4);
  });

  it('reports failures with the claimed attempts and an error code', async () => {
    const { runner, results } = setup({
      complete: async () => {
        throw Object.assign(new Error('GOCLAW_HTTP_429'), { code: 'GOCLAW_HTTP_429' });
      },
    });
    runner.dispatch(command('c1', 'run_completion', { agentKey: 'bot', userId: 'u', text: 'hi' }, 'conv-1', 3));
    runner.dispatch(command('c2', 'run_completion', { userId: 'u', text: 'hi' }, 'conv-1', 1));
    runner.dispatch(command('c3', 'send_lark', { text: 'x' }, null, 1));
    await runner.idle();
    expect([...results].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'c1', result: { attempts: 3, ok: false, error: 'GOCLAW_HTTP_429' } },
      { id: 'c2', result: { attempts: 1, ok: false, error: 'INVALID_PAYLOAD' } },
      { id: 'c3', result: { attempts: 1, ok: false, error: 'UNSUPPORTED_COMMAND' } },
    ]);
  });

  it('does not run a re-claimed command twice and reports it with the newest attempts', async () => {
    const gate = deferred<string>();
    const { runner, goclaw, results } = setup({ complete: async () => gate.promise });
    runner.dispatch(command('c1', 'run_completion', { agentKey: 'bot', userId: 'u', text: 'hi' }, 'conv-1', 1));
    runner.dispatch(command('c1', 'run_completion', { agentKey: 'bot', userId: 'u', text: 'hi' }, 'conv-1', 2));
    gate.resolve('done');
    await runner.idle();
    expect(goclaw.complete).toHaveBeenCalledTimes(1);
    expect(results).toEqual([{ id: 'c1', result: { attempts: 2, ok: true, text: 'done' } }]);
  });

  it('hands zalo_login and zalo_logout to the account manager', async () => {
    const { runner, accounts, results } = setup();
    runner.dispatch(command('l1', 'zalo_login', { accountId: 'acc-9' }, null));
    runner.dispatch(command('l2', 'zalo_logout', { accountId: 'acc-9' }, null));
    await runner.idle();
    expect(accounts.login).toHaveBeenCalledWith('acc-9');
    expect(accounts.logout).toHaveBeenCalledWith('acc-9');
    expect(results.map((r) => r.result.ok)).toEqual([true, true]);
  });

  it('polls until aborted and keeps going after a poll error', async () => {
    const { runner, crm, sleep } = setup();
    const controller = new AbortController();
    crm.pollCommands
      .mockImplementationOnce(async () => { throw new Error('down'); })
      .mockImplementationOnce(async () => [command('c1', 'run_completion', { agentKey: 'bot', userId: 'u', text: 'hi' })])
      .mockImplementation(async () => { controller.abort(); return []; });
    await runner.run(controller.signal);
    await runner.idle();
    expect(sleep).toHaveBeenCalledWith(5000);
    expect(crm.postResult).toHaveBeenCalledTimes(1);
  });

  it('prepends the Zalo profile line and maps gender to nam, nữ, or không rõ', async () => {
    const cases = [
      { name: 'Hùng', gender: 'male' as const, label: 'nam' },
      { name: 'Lan', gender: 'female' as const, label: 'nữ' },
      { name: 'An', gender: null, label: 'không rõ' },
    ];
    for (const [index, item] of cases.entries()) {
      const { runner, goclaw, accounts } = setup();
      accounts.profile.mockResolvedValue({ name: item.name, gender: item.gender });
      runner.dispatch(command(`c${index}`, 'run_completion', { agentKey: 'bot', userId: 'u', text: 'xin chào', zaloUserId: 'uid-1' }));
      await runner.idle();
      expect(accounts.profile).toHaveBeenCalledTimes(1);
      expect(accounts.profile).toHaveBeenCalledWith('acc-1', 'uid-1');
      expect(goclaw.complete).toHaveBeenCalledWith({
        agentKey: 'bot',
        userId: 'u',
        text: `[Hồ sơ Zalo của khách: tên "${item.name}"; giới tính: ${item.label}]\nxin chào`,
      });
    }
  });

  it('keeps the text unchanged when the profile lookup throws and still completes', async () => {
    const { runner, goclaw, accounts, results } = setup();
    accounts.profile.mockRejectedValue(Object.assign(new Error('ZALO_DOWN'), { code: 'ZALO_DOWN' }));
    runner.dispatch(command('c1', 'run_completion', { agentKey: 'bot', userId: 'u', text: 'xin chào', zaloUserId: 'uid-1' }));
    await runner.idle();
    expect(goclaw.complete).toHaveBeenCalledWith({ agentKey: 'bot', userId: 'u', text: 'xin chào' });
    expect(results).toEqual([{ id: 'c1', result: { attempts: 1, ok: true, text: 'reply' } }]);
  });

  it('does not look up the same profile twice', async () => {
    const { runner, goclaw, accounts } = setup();
    accounts.profile.mockResolvedValue({ name: 'Hùng', gender: 'male' });
    runner.dispatch(command('c1', 'run_completion', { agentKey: 'bot', userId: 'u', text: 'một', zaloUserId: 'uid-1' }));
    await runner.idle();
    runner.dispatch(command('c2', 'run_completion', { agentKey: 'bot', userId: 'u', text: 'hai', zaloUserId: 'uid-1' }));
    await runner.idle();
    expect(accounts.profile).toHaveBeenCalledTimes(1);
    expect(goclaw.complete).toHaveBeenNthCalledWith(1, {
      agentKey: 'bot', userId: 'u', text: '[Hồ sơ Zalo của khách: tên "Hùng"; giới tính: nam]\nmột',
    });
    expect(goclaw.complete).toHaveBeenNthCalledWith(2, {
      agentKey: 'bot', userId: 'u', text: '[Hồ sơ Zalo của khách: tên "Hùng"; giới tính: nam]\nhai',
    });
  });

  it('does not look up a profile when zaloUserId or the account is absent', async () => {
    const { runner, goclaw, accounts } = setup();
    runner.dispatch(command('c1', 'run_completion', { agentKey: 'bot', userId: 'u', text: 'xin chào' }));
    await runner.idle();
    runner.dispatch({ ...command('c2', 'run_completion', { agentKey: 'bot', userId: 'u', text: 'xin chào', zaloUserId: 'uid-1' }, 'conv-2'), channelAccountId: null });
    await runner.idle();
    expect(accounts.profile).not.toHaveBeenCalled();
    expect(goclaw.complete).toHaveBeenNthCalledWith(1, { agentKey: 'bot', userId: 'u', text: 'xin chào' });
    expect(goclaw.complete).toHaveBeenNthCalledWith(2, { agentKey: 'bot', userId: 'u', text: 'xin chào' });
  });

  it('treats a profile lookup that exceeds 5 seconds as no profile and still completes', async () => {
    vi.useFakeTimers();
    try {
      const { runner, goclaw, accounts, results } = setup();
      accounts.profile.mockReturnValue(new Promise(() => {}));
      runner.dispatch(command('c1', 'run_completion', { agentKey: 'bot', userId: 'u', text: 'xin chào', zaloUserId: 'uid-1' }));
      await vi.advanceTimersByTimeAsync(4999);
      expect(goclaw.complete).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await runner.idle();
      expect(goclaw.complete).toHaveBeenCalledWith({ agentKey: 'bot', userId: 'u', text: 'xin chào' });
      expect(results).toEqual([{ id: 'c1', result: { attempts: 1, ok: true, text: 'reply' } }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('calls completeWithMedia with the one downloaded image path', async () => {
    const downloadImage = vi.fn(async () => 'C:\\tmp\\one.png');
    const { runner, goclaw, results } = setup({ downloadImage });
    runner.dispatch(command('c1', 'run_completion', {
      agentKey: 'bot', userId: 'u', text: 'biên lai', images: ['https://zdn.vn/a.png'],
    }));
    await runner.idle();
    expect(downloadImage).toHaveBeenCalledWith('https://zdn.vn/a.png', 'media-tmp');
    expect(goclaw.completeWithMedia).toHaveBeenCalledWith({
      agentKey: 'bot', userId: 'u', text: 'biên lai', mediaPaths: ['C:\\tmp\\one.png'],
    });
    expect(goclaw.complete).not.toHaveBeenCalled();
    expect(results).toEqual([{ id: 'c1', result: { attempts: 1, ok: true, text: 'media reply' } }]);
  });

  it('calls complete when the payload has no images', async () => {
    const { runner, goclaw } = setup();
    runner.dispatch(command('c1', 'run_completion', { agentKey: 'bot', userId: 'u', text: 'xin chào' }));
    await runner.idle();
    runner.dispatch(command('c2', 'run_completion', { agentKey: 'bot', userId: 'u', text: 'xin chào', images: [] }, 'conv-2'));
    await runner.idle();
    expect(goclaw.complete).toHaveBeenNthCalledWith(1, { agentKey: 'bot', userId: 'u', text: 'xin chào' });
    expect(goclaw.complete).toHaveBeenNthCalledWith(2, { agentKey: 'bot', userId: 'u', text: 'xin chào' });
    expect(goclaw.completeWithMedia).not.toHaveBeenCalled();
  });

  it('falls back to complete with a note when the image download fails', async () => {
    const { runner, goclaw } = setup({ downloadImage: async () => null });
    runner.dispatch(command('c1', 'run_completion', {
      agentKey: 'bot', userId: 'u', text: 'biên lai', images: ['https://zdn.vn/a.png'],
    }));
    await runner.idle();
    expect(goclaw.complete).toHaveBeenCalledWith({
      agentKey: 'bot', userId: 'u', text: 'biên lai\n[Ảnh không tải được]',
    });
    expect(goclaw.completeWithMedia).not.toHaveBeenCalled();
  });

  it('sends the images that downloaded and notes the one that failed', async () => {
    const { runner, goclaw } = setup({
      downloadImage: async (url) => (url.endsWith('ok.png') ? 'C:\\tmp\\ok.png' : null),
    });
    runner.dispatch(command('c1', 'run_completion', {
      agentKey: 'bot', userId: 'u', text: 'biên lai',
      images: ['https://zdn.vn/ok.png', 'https://zdn.vn/bad.png'],
    }));
    await runner.idle();
    expect(goclaw.completeWithMedia).toHaveBeenCalledWith({
      agentKey: 'bot', userId: 'u', text: 'biên lai\n[Ảnh không tải được]', mediaPaths: ['C:\\tmp\\ok.png'],
    });
    expect(goclaw.complete).not.toHaveBeenCalled();
  });
});
