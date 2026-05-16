import { afterEach, describe, expect, it, vi } from 'vitest';

import { waitForManualQaCloseGate } from '../../../scripts/manual-qa-close-gate.mjs';

describe('manual QA close gate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for newline confirmation when terminal stdin is interactive', async () => {
    const annotate = vi.fn(async () => {});
    const log = vi.fn(async () => {});
    const question = vi.fn(async () => '');
    const close = vi.fn();
    const createInterface = vi.fn(() => ({
      question,
      close
    }));

    await waitForManualQaCloseGate(
      {
        waitForConfirm: true,
        autoConfirmAfterMs: 0,
        finalHoldMs: 0
      },
      {
        annotate,
        log,
        stdin: { readable: true, isTTY: true },
        stdout: { isTTY: true },
        isInteractive: () => true,
        createInterface
      }
    );

    expect(annotate).toHaveBeenCalledWith('Press Enter in the terminal to close browser');
    expect(log).toHaveBeenCalledWith('Press Enter in the terminal to close browser');
    expect(createInterface).toHaveBeenCalledWith({
      input: { readable: true, isTTY: true },
      output: { isTTY: true }
    });
    expect(question).toHaveBeenCalledWith('');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('auto-confirms after the configured timeout', async () => {
    vi.useFakeTimers();

    const annotate = vi.fn();
    const log = vi.fn();
    const wait = vi.fn((ms: number) => new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }));

    const pendingClose = waitForManualQaCloseGate(
      {
        waitForConfirm: true,
        autoConfirmAfterMs: 2500,
        finalHoldMs: 0
      },
      {
        annotate,
        log,
        wait
      }
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(annotate).toHaveBeenCalledWith('Manual QA complete - auto-closing in 2500ms');
    expect(log).toHaveBeenCalledWith('Manual QA complete - auto-closing in 2500ms');
    let resolved = false;
    void pendingClose.then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(2499);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await pendingClose;
    expect(resolved).toBe(true);
  });

  it('fails fast when confirmation is required but stdin is unavailable', async () => {
    await expect(
      waitForManualQaCloseGate(
        {
          waitForConfirm: true,
          autoConfirmAfterMs: 0,
          finalHoldMs: 0
        },
        {
          stdin: undefined,
          stdout: { isTTY: false },
          isInteractive: () => false
        }
      )
    ).rejects.toThrow(
      'Manual QA close confirmation requires readable terminal stdin. Provide stdin input or set MANUAL_QA_AUTO_CONFIRM_AFTER_MS to auto-close.'
    );
  });
});
