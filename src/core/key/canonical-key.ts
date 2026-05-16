const NUMERIC_TOKEN_REGEX = /\b\d{5,13}\b/g;
const NUMERIC_ONLY_REGEX = /^\d{5,13}$/;
const URL_SCHEME_REGEX = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//;
const EXPLICIT_ID_PARAM_KEYS = ['productId', 'id', 'isbn', 'ean', 'barcode'] as const;
const DEFAULT_BASE_URL = 'https://www.kyobobook.co.kr';

function isLikelyUrlCandidate(candidate: string): boolean {
  return URL_SCHEME_REGEX.test(candidate) || candidate.startsWith('/');
}

function parseUrlCandidate(candidate: string): URL | null {
  if (!isLikelyUrlCandidate(candidate)) {
    return null;
  }

  try {
    return new URL(candidate, DEFAULT_BASE_URL);
  } catch {
    return null;
  }
}

function normalizeCandidate(candidate: string): string | null {
  const normalized = candidate.trim();

  return normalized.length > 0 ? normalized : null;
}

function normalizeUrlForKey(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

function pushIfUnique(target: string[], value: string): void {
  if (!target.includes(value)) {
    target.push(value);
  }
}

export function resolveCanonicalProductKey(candidates: readonly string[] | null | undefined): string | null {
  if (!candidates || candidates.length === 0) {
    return null;
  }

  const explicitProductIds: string[] = [];
  const pathnameNumericTokens: string[] = [];
  const normalizedUrls: string[] = [];

  for (const rawCandidate of candidates) {
    const candidate = normalizeCandidate(rawCandidate);

    if (!candidate) {
      continue;
    }

    const parsedUrl = parseUrlCandidate(candidate);

    if (!parsedUrl) {
      if (NUMERIC_ONLY_REGEX.test(candidate)) {
        pushIfUnique(pathnameNumericTokens, candidate);
      } else {
        pushIfUnique(explicitProductIds, candidate);
      }
      continue;
    }

    for (const key of EXPLICIT_ID_PARAM_KEYS) {
      const explicitId = normalizeCandidate(parsedUrl.searchParams.get(key) ?? '');

      if (explicitId) {
        pushIfUnique(explicitProductIds, explicitId);
      }
    }

    const pathTokens = parsedUrl.pathname.match(NUMERIC_TOKEN_REGEX) ?? [];

    for (const token of pathTokens) {
      pushIfUnique(pathnameNumericTokens, token);
    }

    pushIfUnique(normalizedUrls, normalizeUrlForKey(parsedUrl));
  }

  return explicitProductIds[0] ?? pathnameNumericTokens[0] ?? normalizedUrls[0] ?? null;
}

export function dedupeCanonicalProductKeys(candidateSets: ReadonlyArray<readonly string[]>): string[] {
  const deduped: string[] = [];

  for (const candidates of candidateSets) {
    const canonicalKey = resolveCanonicalProductKey(candidates);

    if (canonicalKey && !deduped.includes(canonicalKey)) {
      deduped.push(canonicalKey);
    }
  }

  return deduped;
}
