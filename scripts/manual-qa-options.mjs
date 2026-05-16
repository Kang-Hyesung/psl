function parseBooleanFlag(value) {
  if (value == null || value === '') {
    return false;
  }

  const normalized = String(value).trim().toLowerCase();

  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parseDurationMs(value, fallback, variableName) {
  if (value == null || value === '') {
    return fallback;
  }

  const normalized = String(value).trim();

  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${variableName} must be a non-negative integer, received: ${value}`);
  }

  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${variableName} must be a non-negative integer, received: ${value}`);
  }

  return parsed;
}

export function parseManualQaOptions(env = process.env) {
  const demoMode = env.MANUAL_QA_DEMO == null || env.MANUAL_QA_DEMO === '' ? true : parseBooleanFlag(env.MANUAL_QA_DEMO);

  return {
    demoMode,
    slowMoMs: parseDurationMs(env.MANUAL_QA_SLOW_MO_MS, demoMode ? 250 : 0, 'MANUAL_QA_SLOW_MO_MS'),
    pauseMs: parseDurationMs(env.MANUAL_QA_PAUSE_MS, demoMode ? 1000 : 0, 'MANUAL_QA_PAUSE_MS'),
    finalHoldMs: parseDurationMs(env.MANUAL_QA_FINAL_HOLD_MS, 0, 'MANUAL_QA_FINAL_HOLD_MS'),
    waitForConfirm:
      env.MANUAL_QA_WAIT_FOR_CONFIRM == null || env.MANUAL_QA_WAIT_FOR_CONFIRM === ''
        ? true
        : parseBooleanFlag(env.MANUAL_QA_WAIT_FOR_CONFIRM),
    autoConfirmAfterMs: parseDurationMs(
      env.MANUAL_QA_AUTO_CONFIRM_AFTER_MS,
      0,
      'MANUAL_QA_AUTO_CONFIRM_AFTER_MS'
    )
  };
}
