import { createInterface as createReadlineInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';

function isReadableInteractiveStdin(stdin, stdout) {
  return Boolean(stdin?.readable && stdin?.isTTY && stdout?.isTTY);
}

async function runCallback(callback, message) {
  if (typeof callback === 'function') {
    await callback(message);
  }
}

async function announce(message, { annotate, log }) {
  await runCallback(annotate, message);
  await runCallback(log, message);
}

export async function waitForManualQaCloseGate(
  manualQaOptions,
  {
    annotate,
    log,
    stdin = process.stdin,
    stdout = process.stdout,
    wait = sleep,
    createInterface = createReadlineInterface,
    isInteractive = isReadableInteractiveStdin
  } = {}
) {
  if (!manualQaOptions.waitForConfirm) {
    if (manualQaOptions.finalHoldMs > 0) {
      await announce(`Manual QA complete - closing in ${manualQaOptions.finalHoldMs}ms`, {
        annotate,
        log
      });
      await wait(manualQaOptions.finalHoldMs);
    }

    return;
  }

  if (manualQaOptions.autoConfirmAfterMs > 0) {
    await announce(`Manual QA complete - auto-closing in ${manualQaOptions.autoConfirmAfterMs}ms`, {
      annotate,
      log
    });
    await wait(manualQaOptions.autoConfirmAfterMs);
    return;
  }

  if (isInteractive(stdin, stdout)) {
    const prompt = 'Press Enter in the terminal to close browser';
    await announce(prompt, { annotate, log });

    const readline = createInterface({ input: stdin, output: stdout });

    try {
      await readline.question('');
    } finally {
      readline.close();
    }

    return;
  }

  throw new Error(
    'Manual QA close confirmation requires readable terminal stdin. Provide stdin input or set MANUAL_QA_AUTO_CONFIRM_AFTER_MS to auto-close.'
  );
}
