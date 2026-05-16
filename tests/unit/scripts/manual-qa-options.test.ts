import { describe, expect, it } from 'vitest';

import { parseManualQaOptions } from '../../../scripts/manual-qa-options.mjs';

describe('manual QA option parsing', () => {
  it('uses visible observation defaults when manual QA env is unset', () => {
    expect(parseManualQaOptions({})).toEqual({
      demoMode: true,
      slowMoMs: 250,
      pauseMs: 1000,
      finalHoldMs: 0,
      waitForConfirm: true,
      autoConfirmAfterMs: 0
    });
  });

  it('allows explicit opt-out of demo mode while keeping confirmation defaults', () => {
    expect(parseManualQaOptions({ MANUAL_QA_DEMO: 'false' })).toEqual({
      demoMode: false,
      slowMoMs: 0,
      pauseMs: 0,
      finalHoldMs: 0,
      waitForConfirm: true,
      autoConfirmAfterMs: 0
    });
  });

  it('allows explicit timing and confirmation overrides', () => {
    expect(
      parseManualQaOptions({
        MANUAL_QA_DEMO: '1',
        MANUAL_QA_SLOW_MO_MS: '75',
        MANUAL_QA_PAUSE_MS: '300',
        MANUAL_QA_FINAL_HOLD_MS: '1500',
        MANUAL_QA_WAIT_FOR_CONFIRM: 'no',
        MANUAL_QA_AUTO_CONFIRM_AFTER_MS: '2500'
      })
    ).toEqual({
      demoMode: true,
      slowMoMs: 75,
      pauseMs: 300,
      finalHoldMs: 1500,
      waitForConfirm: false,
      autoConfirmAfterMs: 2500
    });
  });

  it('rejects invalid negative pause durations', () => {
    expect(() => parseManualQaOptions({ MANUAL_QA_PAUSE_MS: '-1' })).toThrow(
      'MANUAL_QA_PAUSE_MS must be a non-negative integer'
    );
  });

  it('rejects malformed slow motion durations instead of truncating them', () => {
    expect(() => parseManualQaOptions({ MANUAL_QA_SLOW_MO_MS: '1.5' })).toThrow(
      'MANUAL_QA_SLOW_MO_MS must be a non-negative integer, received: 1.5'
    );
  });

  it('rejects malformed pause durations instead of truncating them', () => {
    expect(() => parseManualQaOptions({ MANUAL_QA_PAUSE_MS: '10abc' })).toThrow(
      'MANUAL_QA_PAUSE_MS must be a non-negative integer, received: 10abc'
    );
  });

  it('rejects invalid negative final hold durations', () => {
    expect(() => parseManualQaOptions({ MANUAL_QA_FINAL_HOLD_MS: '-1' })).toThrow(
      'MANUAL_QA_FINAL_HOLD_MS must be a non-negative integer'
    );
  });

  it('rejects malformed final hold durations instead of truncating them', () => {
    expect(() => parseManualQaOptions({ MANUAL_QA_FINAL_HOLD_MS: '2.9' })).toThrow(
      'MANUAL_QA_FINAL_HOLD_MS must be a non-negative integer, received: 2.9'
    );
  });

  it('rejects invalid negative auto confirm durations', () => {
    expect(() => parseManualQaOptions({ MANUAL_QA_AUTO_CONFIRM_AFTER_MS: '-1' })).toThrow(
      'MANUAL_QA_AUTO_CONFIRM_AFTER_MS must be a non-negative integer'
    );
  });

  it('rejects malformed auto confirm durations instead of truncating them', () => {
    expect(() => parseManualQaOptions({ MANUAL_QA_AUTO_CONFIRM_AFTER_MS: '3ms' })).toThrow(
      'MANUAL_QA_AUTO_CONFIRM_AFTER_MS must be a non-negative integer, received: 3ms'
    );
  });
});
