import dotenv from "dotenv";
import { createRequire } from "module";

dotenv.config();

const require = createRequire(import.meta.url);

function parseJsonArrayEnv(rawValue) {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function parseCsvEnv(rawValue) {
  if (!rawValue) return [];
  return String(rawValue)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function loadFileTerms() {
  try {
    const list = require("./protected_terms_list.json");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function buildProtectedTerms() {
  const envJsonTerms = parseJsonArrayEnv(process.env.PROTECTED_TERMS_JSON);
  const envCsvTerms = parseCsvEnv(process.env.PROTECTED_TERMS_CSV);
  const fileTerms = loadFileTerms();
  return Array.from(new Set(
    [...fileTerms, ...envJsonTerms, ...envCsvTerms]
      .map((term) => String(term || "").trim())
      .filter(Boolean)
  ));
}

export const PROTECTED_TERMS = buildProtectedTerms();
console.log(`[search] PROTECTED_TERMS loaded: ${PROTECTED_TERMS.length} terms`);
console.log(`[search] PROTECTED_TERMS loaded: ${PROTECTED_TERMS.length} terms`);
if (PROTECTED_TERMS.length === 0) {
  console.warn("[search] PROTECTED_TERMS is empty. Using dynamic protected-name detection.");
}

const PROTECTED_ALIASES = (() => {
  const aliasMap = new Map();

  PROTECTED_TERMS.forEach((term) => {
    const canonical = String(term || "").trim();
    if (!canonical) return;

    const lower = canonical.toLowerCase();
    const normalized = normalizeProtectedAlias(canonical);
    const compact = normalized.replace(/\s+/g, "");

    [lower, normalized, compact].forEach((alias) => {
      if (!alias) return;
      aliasMap.set(alias, canonical);
    });
  });

  // Explicit translations or spelling variants (e.g. Swedish DB/Google Translate leaks) mapped to canonical brand names

  // Object.entries(explicitAliases).forEach(([alias, canonical]) => {
  //   const lower = alias.toLowerCase();
  //   const normalized = normalizeProtectedAlias(alias);
  //   const compact = normalized.replace(/\s+/g, "");

  //   [lower, normalized, compact].forEach((a) => {
  //     if (!a) return;
  //     aliasMap.set(a, canonical);
  //   });
  // });

  // Explicit translations or spelling variants (e.g. Swedish DB/Google Translate leaks) mapped to canonical brand names
  const explicitAliases = {
    "klarhet ii": "Clarity II",
    "klarhet 2": "Clarity II",
    "klarhet": "Clarity II",
    "ikon": "Icoone",
    "dioxin": "Dioxium",
    "lasermd": "LaseMD",
    "stjärnvandrare": "StarWalker",
    "stjarnvandrare": "StarWalker",
    "norrsken": "Nordlys",
    "northern lights": "Nordlys",
    "kandela": "Candela",
    "asklepion": "Asclepion",
    "kollaserpeeling": "CarbonPeel",
    "koldioxidlaser-peel": "Carbon Laser Peel",
    "ellips": "Ellipse"
  };

  Object.entries(explicitAliases).forEach(([alias, canonical]) => {
    const lower = alias.toLowerCase();
    const normalized = normalizeProtectedAlias(alias);
    const compact = normalized.replace(/\s+/g, "");

    [lower, normalized, compact].forEach((a) => {
      if (!a) return;
      aliasMap.set(a, canonical);
    });
  });

  return aliasMap;
})();

[
  ["Clarity II", "Clarity II"],
  ["Candela Nordlys", "Candela Nordlys"],
  ["Icoone", "Icoone"],
  ["Dioxium", "Dioxium"],
  ["LaseMD", "LaseMD"],
  ["Fotona StarWalker", "Fotona StarWalker"],
  ["Foto Starwalker", "Fotona StarWalker"],
  ["CarbonPeel", "CarbonPeel"],
  ["Kollaserpeeling", "CarbonPeel"],
  ["Asclepion", "Asclepion"],
  ["Asklepion", "Asclepion"],
  ["QuadroStarPRO Green", "QuadroStarPRO Green"],
  ["ND:YAG", "ND:YAG"],
  ["Nd:YAG", "ND:YAG"],
  ["Ndyag", "ND:YAG"],
  ["Mörka ringar", "dark circles"],
  ["Morka ringar", "dark circles"],
  ["dark circles", "dark circles"],
  ["Under eye", "under eye"],
  ["Under eyes", "under eye"],
  ["Laserbehandling", "laser treatment"],
  ["Laser behandling", "laser treatment"],
  ["Laser pigmentering", "laser pigmentation"]
].forEach(([alias, canonical]) => {
  const normalized = normalizeProtectedAlias(alias);
  const compact = normalized.replace(/\s+/g, "");
  [alias, normalized, compact].forEach((value) => {
    if (value) PROTECTED_ALIASES.set(value, canonical);
  });
});
const PROTECTED_NORMALIZED = PROTECTED_TERMS.map((term) => ({
  canonical: term,
  normalized: normalizeProtectedAlias(term),
  compact: normalizeProtectedAlias(term).replace(/\s+/g, "")
}));

// Precompiled regexes for static terms (very fast)
const PRECOMPILED_STATIC_TERMS = PROTECTED_TERMS.map((term, idx) => ({
  term,
  regex: new RegExp(`\\b${escapeRegex(term)}\\b`, "gi"),
  token: `__pts${idx}__`
}));

// Precompiled regexes for aliases (very fast)
const PRECOMPILED_ALIAS_REGEXES = Array.from(PROTECTED_ALIASES.entries()).map(([alias, canonical]) => ({
  canonical,
  regex: new RegExp(`\\b${escapeRegex(alias)}\\b`, "gi")
}));

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function containsProtectedTerm(text = "") {
  const input = String(text || "").toLowerCase();
  return PROTECTED_TERMS.some((term) => input.includes(term.toLowerCase())) ||
    collectDynamicProtectedPhrases(text, { includeTitleCasePhrases: false }).length > 0;
}

export function protectTermsInText(text = "") {
  if (!text) return { protectedText: text, map: [] };

  let protectedText = String(text);
  const map = [];

  // 1️⃣ Apply precompiled static PROTECTED_TERMS first
  PRECOMPILED_STATIC_TERMS.forEach(({ term, regex, token }) => {
    regex.lastIndex = 0;
    const nextText = protectedText.replace(regex, token);
    if (nextText !== protectedText) {
      protectedText = nextText;
      map.push({ token, term });
    }
  });

  // 2️⃣ Apply dynamic terms from text analysis
  const dynamicTerms = collectDynamicProtectedPhrases(protectedText).sort((a, b) => b.length - a.length);
  dynamicTerms.forEach((term, idx) => {
    const token = `__ptd${idx}__`;
    const regex = new RegExp(`\\b${escapeRegex(term)}\\b`, "gi");
    const nextText = protectedText.replace(regex, token);
    if (nextText !== protectedText) {
      protectedText = nextText;
      map.push({ token, term });
    }
  });

  return { protectedText, map };
}

export function restoreProtectedTerms(text = "", map = []) {
  let restored = String(text || "");
  map.forEach(({ token, term }) => {
    restored = restored.replace(new RegExp(escapeRegex(token), "g"), term);
  });
  return restored;
}

export function normalizeProtectedAlias(text = "") {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s:+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(a = "", b = "") {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;

  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function similarity(a = "", b = "") {
  if (!a || !b) return 0;
  const dist = levenshteinDistance(a, b);
  return 1 - (dist / Math.max(a.length, b.length));
}

function hasRomanNumeral(value = "") {
  return /\b(i|ii|iii|iv|v|vi|vii|viii|ix|x)\b/i.test(value);
}

function tokenShape(value = "") {
  return String(value || "")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function isRomanNumeralToken(value = "") {
  return /^(i|ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(value);
}

function isTitleCaseToken(value = "") {
  return /^[A-Z][a-z0-9]+$/.test(value);
}

function isDynamicProtectedToken(value = "") {
  const token = String(value || "").trim();
  if (!token) return false;
  if (/\d/.test(token)) return true;
  if (/^[A-Z]{2,}$/.test(token)) return true;
  if (/[A-Z][a-z]+[A-Z]/.test(token)) return true;
  if (/[:+]/.test(token)) return true;
  if (isRomanNumeralToken(token)) return true;
  return false;
}

function collectDynamicProtectedPhrases(text = "", options = {}) {
  const includeTitleCasePhrases = options.includeTitleCasePhrases !== false;
  const source = String(text || "");
  const tokens = source.match(/\b[\p{L}\p{N}:+-]+\b/gu) || [];
  const phrases = [];

  for (let i = 0; i < tokens.length; i++) {
    const first = tokens[i];
    // if (!isDynamicProtectedToken(first)) continue;
    if (!isDynamicProtectedToken(first) && !isTitleCaseToken(first)) continue;

    const parts = [first];
    let hasStrongShape = isDynamicProtectedToken(first);
    let j = i + 1;

    while (j < tokens.length) {
      const next = tokens[j];
      // if (!isDynamicProtectedToken(next)) break;
      if (!isDynamicProtectedToken(next) && !isTitleCaseToken(next)) break;
      parts.push(next);
      hasStrongShape = hasStrongShape || isDynamicProtectedToken(next);
      j++;
    }

    if (hasStrongShape || (includeTitleCasePhrases && parts.length >= 2)) {
      phrases.push(parts.join(" "));
    }
  }

  return Array.from(new Set(phrases)).sort((a, b) => b.length - a.length);
}

function hasCommercialTokenShape(value = "") {
  const tokens = tokenShape(value);
  if (!tokens.length) return false;

  return tokens.some((token) => isDynamicProtectedToken(token));
}

function normalizedSimilarity(a = "", b = "") {
  const left = normalizeProtectedAlias(a);
  const right = normalizeProtectedAlias(b);
  if (!left || !right) return 0;
  return similarity(left, right);
}

export function shouldPreserveCanonicalEntityName(canonical = "", localized = "", options = {}) {
  const source = String(canonical || "").trim();
  const rendered = String(localized || "").trim();
  if (!source) return false;
  if (!rendered) return true;

  if (containsProtectedTerm(source) || containsProtectedTerm(rendered)) return true;
  if (options.alwaysProtect) return true;
  if (hasCommercialTokenShape(source)) return true;

  const sourceTokens = tokenShape(source);
  const renderedTokens = tokenShape(rendered);
  const similarityScore = normalizedSimilarity(source, rendered);
  const sourceNormalizedTokens = new Set(sourceTokens.map((token) => normalizeProtectedAlias(token)));
  const sharedTokens = renderedTokens
    .map((token) => normalizeProtectedAlias(token))
    .filter((token) => token && sourceNormalizedTokens.has(token));

  if (sourceTokens.length > 1 && sharedTokens.length > 0 && similarityScore < 0.82) {
    return true;
  }

  if (sourceTokens.length === 1 && renderedTokens.length === 1 && similarityScore < 0.68) {
    return true;
  }

  if (sourceTokens.length !== renderedTokens.length && similarityScore < 0.55) {
    return true;
  }

  return false;
}

export function resolveProtectedDisplayName(canonical = "", localized = "", options = {}) {
  const source = restoreCanonicalBrandTerms(String(canonical || ""));
  const rendered = restoreCanonicalBrandTerms(String(localized || ""));
  return shouldPreserveCanonicalEntityName(source, rendered, options)
    ? source
    : (rendered || source);
}

export function getCanonicalProtectedTerm(text = "") {
  const normalized = normalizeProtectedAlias(text);
  if (!normalized) return null;
  const compact = normalized.replace(/\s+/g, "");

  if (PROTECTED_ALIASES.has(normalized)) return PROTECTED_ALIASES.get(normalized);
  if (PROTECTED_ALIASES.has(compact)) return PROTECTED_ALIASES.get(compact);

  // OPTIMIZATION: Skip fuzzy matching if the word consists only of lowercase letters and is short (<= 6 chars),
  // as most brand/protected terms are camelCase, TitleCase, or contain special characters/numerals.
  const trimmedOriginal = text.trim();
  const isPlainLowercaseWord = /^[a-z]+$/.test(trimmedOriginal);
  if (isPlainLowercaseWord && trimmedOriginal.length <= 6) {
    return null;
  }

  let best = null;
  let bestScore = 0;
  PROTECTED_NORMALIZED.forEach((entry) => {
    const score = Math.max(
      similarity(normalized, entry.normalized),
      similarity(compact, entry.compact)
    );
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  });

  if (!best) return null;
  const threshold = hasRomanNumeral(normalized) ? 0.72 : 0.9;
  return bestScore >= threshold ? best.canonical : null;
}

export function restoreCanonicalBrandTerms(text = "") {
  let output = String(text || "");
  if (!output) return output;

  // 1️⃣ Apply precompiled alias regexes (very fast)
  PRECOMPILED_ALIAS_REGEXES.forEach(({ canonical, regex }) => {
    output = output.replace(regex, canonical);
  });

  // Fuzzy pass for near-translated or lightly corrupted variants.
  output = output
    .split(/([,;|])/)
    .map((chunk) => {
      const trimmed = chunk.trim();
      if (!trimmed || /^[,;|]$/.test(trimmed)) return chunk;

      // OPTIMIZATION: Quick check to skip fuzzy matching for very short/long strings
      if (trimmed.length < 3 || trimmed.length > 35) return chunk;

      const canonical = getCanonicalProtectedTerm(trimmed);
      return canonical ? chunk.replace(trimmed, canonical) : chunk;
    })
    .join("");

  return output;
}
