import { access, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { EOL } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { spawn } from 'node:child_process';

const projectRoot = resolve(import.meta.dirname, '..');
const evidenceDir = resolve(projectRoot, '.sisyphus', 'evidence');
const successEvidenceLogPath = resolve(evidenceDir, 'task-6-verification-harness.txt');
const failureEvidenceLogPath = resolve(evidenceDir, 'task-6-verification-harness-error.txt');

const manualQaArtifacts = [
  'manual-qa-extension.log',
  'manual-qa-kyobo-hide.png',
  'manual-qa-kyobo-reload-hidden.png',
  'manual-qa-kyobo-dynamic-hidden.png',
  'manual-qa-kyobo-unhidden.png'
].map((fileName) => ({
  fileName,
  filePath: resolve(evidenceDir, fileName)
}));

const manualQaErrorLogPath = resolve(evidenceDir, 'manual-qa-extension-error.log');
const successMarker = 'manual QA completed successfully';
const operatorPrompt = 'Press Enter in the terminal to close browser';
const failFastMessage =
  'Manual QA close confirmation requires readable terminal stdin. Provide stdin input or set MANUAL_QA_AUTO_CONFIRM_AFTER_MS to auto-close.';
const requiredAliveMs = 3000;
const runTimeoutMs = 180000;
const artifactPollIntervalMs = 100;
const artifactPollTimeoutMs = 5000;

function getManualQaSpawn() {
  if (process.platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm run manual:qa']
    };
  }

  return {
    command: 'npm',
    args: ['run', 'manual:qa']
  };
}

function createInteractiveNodeOptions() {
  const patchSource = [
    "Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });",
    "Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });",
    "Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: true });",
    "if (typeof process.stdout.clearLine !== 'function') process.stdout.clearLine = () => true;",
    "if (typeof process.stdout.cursorTo !== 'function') process.stdout.cursorTo = () => true;",
    "if (typeof process.stdout.moveCursor !== 'function') process.stdout.moveCursor = () => true;",
    "if (typeof process.stderr.clearLine !== 'function') process.stderr.clearLine = () => true;",
    "if (typeof process.stderr.cursorTo !== 'function') process.stderr.cursorTo = () => true;",
    "if (typeof process.stderr.moveCursor !== 'function') process.stderr.moveCursor = () => true;"
  ].join('');

  return `--import=data:text/javascript,${encodeURIComponent(patchSource)}`;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function formatLog(title, lines) {
  return [`# ${title}`, '', ...lines, ''].join(EOL);
}

async function removeFileIfPresent(filePath) {
  await rm(filePath, { force: true });
}

async function readArtifactStats(runStartedAt) {
  const stats = [];

  for (const artifact of manualQaArtifacts) {
    await access(artifact.filePath);
    const artifactStat = await stat(artifact.filePath);

    assert(
      artifactStat.mtimeMs >= runStartedAt,
      `Expected ${artifact.fileName} to be regenerated for this verification run.`
    );

    stats.push({
      ...artifact,
      mtimeMs: artifactStat.mtimeMs
    });
  }

  return stats;
}

async function waitForArtifactStats(runStartedAt) {
  const deadline = Date.now() + artifactPollTimeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      return await readArtifactStats(runStartedAt);
    } catch (error) {
      lastError = error;
      await sleep(artifactPollIntervalMs);
    }
  }

  throw lastError ?? new Error('Timed out waiting for manual QA evidence artifacts.');
}

async function runManualQa({
  title,
  evidenceLogPath,
  interactive,
  confirmAfterSuccess = false,
  expectFailureMessage = null
}) {
  await mkdir(evidenceDir, { recursive: true });

  if (confirmAfterSuccess) {
    for (const artifact of manualQaArtifacts) {
      await removeFileIfPresent(artifact.filePath);
    }
  }

  if (expectFailureMessage) {
    await removeFileIfPresent(manualQaErrorLogPath);
  }

  const runStartedAt = Date.now();
  const outputLines = [`[harness] Starting ${title}`];
  let successSeenAt = null;
  let promptSeen = false;
  let stayedAliveMs = null;
  let artifactStats = [];
  let failFastSeen = false;
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let confirmationSent = false;
  const pendingChunkReads = new Set();

  const env = {
    ...process.env,
    MANUAL_QA_DEMO: '0',
    MANUAL_QA_SLOW_MO_MS: '0',
    MANUAL_QA_PAUSE_MS: '0',
    MANUAL_QA_FINAL_HOLD_MS: '0',
    MANUAL_QA_WAIT_FOR_CONFIRM: '1',
    MANUAL_QA_AUTO_CONFIRM_AFTER_MS: '0'
  };

  if (interactive) {
    env.NODE_OPTIONS = [process.env.NODE_OPTIONS, createInteractiveNodeOptions()].filter(Boolean).join(' ');
  }

  const { command, args } = getManualQaSpawn();

  const child = spawn(command, args, {
    cwd: projectRoot,
    env,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let timeoutId;

  const completion = new Promise((resolvePromise, rejectPromise) => {
    const onChunk = async (chunk, streamName) => {
      const text = chunk.toString();
      outputLines.push(...text.replace(/\r/g, '').split('\n').filter((line, index, all) => line.length > 0 || index < all.length - 1).map((line) => `[${streamName}] ${line}`));

      if (streamName === 'stdout') {
        stdoutBuffer = `${stdoutBuffer}${text}`.slice(-Math.max(successMarker.length, operatorPrompt.length) * 2);
      }

      if (streamName === 'stderr') {
        stderrBuffer = `${stderrBuffer}${text}`.slice(-failFastMessage.length * 2);
      }

      if (successSeenAt == null && stdoutBuffer.includes(successMarker)) {
        successSeenAt = Date.now();
        outputLines.push(`[harness] Observed success marker at ${successSeenAt}`);

        if (confirmAfterSuccess) {
          artifactStats = await waitForArtifactStats(runStartedAt);
          outputLines.push(
            `[harness] Evidence present before confirmation: ${artifactStats
              .map((artifact) => `${artifact.fileName}@${new Date(artifact.mtimeMs).toISOString()}`)
              .join(', ')}`
          );
          await sleep(requiredAliveMs);
          assert(child.exitCode == null, `Manual QA process exited before remaining alive for ${requiredAliveMs}ms.`);
          stayedAliveMs = Date.now() - successSeenAt;
          outputLines.push(`[harness] Process remained alive for ${stayedAliveMs}ms before confirmation.`);

          if (!confirmationSent) {
            confirmationSent = true;
            child.stdin.write('\n');
            outputLines.push('[harness] Sent newline confirmation to stdin.');
          }
        }
      }

      if (stdoutBuffer.includes(operatorPrompt)) {
        promptSeen = true;
      }

      if (expectFailureMessage && `${stdoutBuffer}${stderrBuffer}`.includes(expectFailureMessage)) {
        failFastSeen = true;
      }
    };

    const queueChunkRead = (chunk, streamName) => {
      const pendingChunkRead = onChunk(chunk, streamName)
        .catch(rejectPromise)
        .finally(() => {
          pendingChunkReads.delete(pendingChunkRead);
        });

      pendingChunkReads.add(pendingChunkRead);
    };

    child.stdout.on('data', (chunk) => {
      queueChunkRead(chunk, 'stdout');
    });

    child.stderr.on('data', (chunk) => {
      queueChunkRead(chunk, 'stderr');
    });

    child.on('error', rejectPromise);

    child.on('close', (code, signal) => {
      void Promise.allSettled([...pendingChunkReads]).then(() => {
        resolvePromise({ code, signal });
      }, rejectPromise);
    });
  });

  timeoutId = setTimeout(() => {
    outputLines.push(`[harness] Timeout after ${runTimeoutMs}ms.`);
    child.kill();
  }, runTimeoutMs);

  try {
    const { code, signal } = await completion;
    outputLines.push(`[harness] Process exited with code=${code} signal=${signal}`);

    if (confirmAfterSuccess) {
      assert(successSeenAt != null, `Did not observe success marker: ${successMarker}`);
      assert(promptSeen, `Did not observe operator prompt: ${operatorPrompt}`);
      assert(stayedAliveMs != null && stayedAliveMs >= requiredAliveMs, `Process stayed alive only ${stayedAliveMs ?? 0}ms after success.`);
      assert(code === 0, `Expected exit code 0 after newline confirmation, received ${code}`);
      outputLines.push(`PASS stay-open-before-confirm (${stayedAliveMs}ms >= ${requiredAliveMs}ms)`);
    }

    if (expectFailureMessage) {
      const combinedOutput = outputLines.join('\n');

      assert(successSeenAt != null, `Second pass never reached success marker: ${successMarker}`);
      assert(combinedOutput.includes(expectFailureMessage), `Did not observe fail-fast guidance: ${expectFailureMessage}`);
      assert(code === 1, `Expected exit code 1 for no-stdin fail-fast run, received ${code}`);
      const errorLogStat = await stat(manualQaErrorLogPath);
      assert(errorLogStat.mtimeMs >= runStartedAt, 'Expected manual-qa-extension-error.log to be regenerated for fail-fast run.');
      outputLines.push('PASS no-stdin-fail-fast');
    }

    await writeFile(evidenceLogPath, formatLog(title, outputLines), 'utf8');
    return outputLines;
  } catch (error) {
    outputLines.push(`[harness] FAILURE: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    await writeFile(evidenceLogPath, formatLog(title, outputLines), 'utf8');
    throw error;
  } finally {
    clearTimeout(timeoutId);
    child.stdin.destroy();
  }
}

async function main() {
  const successLines = await runManualQa({
    title: 'Task 6 verification harness - stay-open-until-confirm',
    evidenceLogPath: successEvidenceLogPath,
    interactive: true,
    confirmAfterSuccess: true
  });

  const failureLines = await runManualQa({
    title: 'Task 6 verification harness - no-stdin fail-fast',
    evidenceLogPath: failureEvidenceLogPath,
    interactive: false,
    expectFailureMessage: failFastMessage
  });

  for (const line of [...successLines, ...failureLines]) {
    if (line.startsWith('PASS ')) {
      console.log(line);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
