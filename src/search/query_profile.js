import { normalizeSearchText } from "./intent_taxonomy.js";

function tokenize(value = "") {
  return normalizeSearchText(value).split(/\s+/).filter(Boolean);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const QUERY_PROFILE_CACHE = new Map();

export function buildQueryProfile(search = "", corpusTexts = []) {
  const cacheKey = `${String(search).trim().toLowerCase()}::${corpusTexts.length}`;
  if (QUERY_PROFILE_CACHE.has(cacheKey)) {
    return QUERY_PROFILE_CACHE.get(cacheKey);
  }

  const normalized = normalizeSearchText(search || "");
  const tokens = tokenize(normalized);
  const uniqueTokens = Array.from(new Set(tokens));

  const tokenFreq = new Map();
  const corpusSize = Math.max(1, corpusTexts.length);

  corpusTexts.forEach((text) => {
    const seen = new Set(tokenize(text));
    seen.forEach((tok) => tokenFreq.set(tok, (tokenFreq.get(tok) || 0) + 1));
  });

  const rarityScores = uniqueTokens.map((tok) => {
    const freq = tokenFreq.get(tok) || 0;
    return 1 - (freq / corpusSize);
  });

  const avgRarity = rarityScores.length
    ? rarityScores.reduce((a, b) => a + b, 0) / rarityScores.length
    : 0;

  const hasNumerics = /\d/.test(normalized) ? 1 : 0;
  const phraseLengthScore = clamp(uniqueTokens.length / 5, 0, 1);
  const shortestTokenLength = uniqueTokens.length
    ? Math.min(...uniqueTokens.map((token) => token.length))
    : 0;
  const partialTokenRisk = uniqueTokens.length > 0 && shortestTokenLength < 5 ? 1 : 0;
  const typoOrPartialIntent = uniqueTokens.some((token) => {
    const freq = tokenFreq.get(token) || 0;
    return freq === 0 && token.length >= 4 && token.length <= 9;
  });
  const specificity = clamp(
    (0.5 * avgRarity) +
    (0.35 * phraseLengthScore) +
    (0.15 * hasNumerics) -
    (0.12 * partialTokenRisk),
    0,
    1
  );

  const profile = {
    raw: String(search || ""),
    normalized,
    tokens: uniqueTokens,
    token_count: uniqueTokens.length,
    average_token_rarity: Number(avgRarity.toFixed(4)),
    specificity: Number(specificity.toFixed(4)),
    typo_or_partial_intent: Boolean(typoOrPartialIntent || partialTokenRisk),
    partial_token_risk: Boolean(partialTokenRisk),
    broad_intent: specificity < 0.4,
    narrow_intent: specificity >= 0.65,
  };

  QUERY_PROFILE_CACHE.set(cacheKey, profile);
  return profile;
}

export function computeAdaptiveThreshold(profile = {}, options = {}) {
  const base = Number(options.base ?? 0.6);
  const min = Number(options.min ?? 0.45);
  const max = Number(options.max ?? 0.8);
  const specificity = Number(profile?.specificity ?? 0.5);
  const adjusted = base - ((0.5 - specificity) * 0.18);
  return Number(clamp(adjusted, min, max).toFixed(3));
}

export function computeAdaptiveCap(profile = {}, options = {}) {
  const min = Number(options.min ?? 8);
  const max = Number(options.max ?? 24);
  const specificity = Number(profile?.specificity ?? 0.5);
  const raw = Math.round(max - (specificity * (max - min)));
  const partialAdjusted = profile?.typo_or_partial_intent
    ? Math.min(raw, Math.ceil((min + max) / 2))
    : raw;
  return clamp(partialAdjusted, min, max);
}
