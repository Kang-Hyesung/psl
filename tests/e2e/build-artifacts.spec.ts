import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test('content script artifact is loadable as a classic Chrome content script', () => {
  const contentScript = readFileSync(resolve(process.cwd(), 'dist/content.js'), 'utf8');

  expect(contentScript).not.toMatch(/\bimport\s*(?:\{|[\w*])/);
  expect(contentScript).not.toContain('from"./chunks/');
  expect(contentScript).not.toContain('from "./chunks/');
  expect(() => new Function(contentScript)).not.toThrow();
});
