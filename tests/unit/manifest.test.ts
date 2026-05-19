import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface ExtensionManifest {
  manifest_version: number;
  permissions?: string[];
  host_permissions?: string[];
  background?: {
    service_worker?: string;
    type?: string;
  };
  content_scripts?: Array<{
    matches?: string[];
    js?: string[];
    run_at?: string;
  }>;
  action?: {
    default_popup?: string;
  };
  options_page?: string;
}

function readManifest(): ExtensionManifest {
  const manifestJson = readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8');
  return JSON.parse(manifestJson) as ExtensionManifest;
}

describe('manifest scaffold contract', () => {
  it('keeps MV3 baseline entries wired for this project', () => {
    const manifest = readManifest();
    const wildcardHost = '*://*/*';
    const hostPermissions = manifest.host_permissions ?? [];
    const contentScriptMatches = manifest.content_scripts?.flatMap((script) => script.matches ?? []) ?? [];

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(['storage']);
    expect(manifest.background?.service_worker).toBe('background.js');
    expect(manifest.background?.type).toBe('module');
    expect(manifest.content_scripts).toHaveLength(1);
    expect(manifest.content_scripts?.[0]?.js).toEqual(['content.js']);
    expect(manifest.content_scripts?.[0]?.run_at).toBe('document_idle');
    expect(hostPermissions).toEqual([
      'https://www.kyobobook.co.kr/*',
      'https://search.kyobobook.co.kr/*',
      'https://product.kyobobook.co.kr/*'
    ]);
    expect(contentScriptMatches).toEqual([
      'https://www.kyobobook.co.kr/*',
      'https://search.kyobobook.co.kr/*',
      'https://product.kyobobook.co.kr/*'
    ]);
    expect(hostPermissions).not.toContain(wildcardHost);
    expect(contentScriptMatches).not.toContain(wildcardHost);
    expect(manifest.action?.default_popup).toBe('popup.html');
    expect(manifest.options_page).toBe('options.html');
  });
});
