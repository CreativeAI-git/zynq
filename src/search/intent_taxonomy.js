import { protectTermsInText, restoreProtectedTerms } from "./protected_terms.js";

import dotenv from "dotenv";

dotenv.config();

function parseJsonObjectEnv(rawValue) {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseJsonArrayEnv(rawValue) {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonStringMapEnv(rawValue) {
  const parsed = parseJsonObjectEnv(rawValue);
  if (!parsed) return {};

  const map = {};
  Object.entries(parsed).forEach(([key, value]) => {
    const k = String(key || "").trim();
    const v = String(value || "").trim();
    if (k && v) map[k] = v;
  });
  return map;
}

function parseJsonRegexListEnv(rawValue) {
  const parsed = parseJsonArrayEnv(rawValue);
  return parsed
    .map((pattern) => {
      try {
        return new RegExp(String(pattern), "i");
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function parseJsonNegationRulesEnv(rawValue) {
  const parsed = parseJsonArrayEnv(rawValue);
  return parsed
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const source = String(item.pattern || "").trim();
      if (!source) return null;

      let pattern;
      try {
        pattern = new RegExp(source, "i");
      } catch {
        return null;
      }

      const excludes = Array.isArray(item.excludes)
        ? item.excludes.map((v) => String(v || "").trim()).filter(Boolean)
        : [];

      return { pattern, excludes };
    })
    .filter(Boolean);
}

function normalizeBucketDef(def = {}) {
  return {
    include: Array.isArray(def.include) ? def.include.map((v) => String(v || "").trim()).filter(Boolean) : [],
    exclude: Array.isArray(def.exclude) ? def.exclude.map((v) => String(v || "").trim()).filter(Boolean) : [],
    strict: Boolean(def.strict)
  };
}

function buildIntentBuckets() {
  const envBuckets = parseJsonObjectEnv(process.env.SEARCH_INTENT_BUCKETS_JSON);
  if (!envBuckets) {
    return {
      pigmentation: {
        strict: false,
        include: ["pigmentation", "pigment", "pigmentering", "melasma", "tone variation", "dark spots", "age spots"],
        exclude: []
      },
      acne_scars: {
        strict: false,
        include: ["acne scars", "acne scar", "aknearr", "scar", "scars", "ärr", "arr"],
        exclude: []
      },
      redness: {
        strict: false,
        include: ["redness", "rodhet", "rödhet", "rosacea", "vascular", "blood vessels", "rodnad"],
        exclude: []
      },
      loose_skin: {
        strict: false,
        include: ["loose skin", "slapp hud", "skin tightening", "hud tightening", "tightening", "sagging", "firming"],
        exclude: []
      },
      dark_circles: {
        strict: false,
        include: ["dark circles", "under eye", "under eyes", "tear trough", "morka ringar", "mörka ringar"],
        exclude: []
      },
      hair_removal: {
        strict: false,
        include: ["hair removal", "laser hair removal", "hair reduction", "hårborttagning", "harborttagning"],
        exclude: ["tattoo", "tattoo removal", "tatuering"]
      },
      pores: {
        strict: false,
        include: ["pores", "porer", "large pores", "enlarged pores"],
        exclude: []
      },
      laser: {
        strict: true,
        include: ["laser", "ipl", "pico", "picosecond", "alexandrite", "thulium"],
        exclude: ["non laser", "not laser", "without laser"]
      },
      rf: {
        strict: true,
        include: ["rf", "radiofrequency", "radio frequency", "radiofrekvens", "rf hud", "microneedling rf"],
        exclude: []
      },
      hifu: {
        strict: true,
        include: ["hifu", "high intensity focused ultrasound", "ultrasound", "ultraljud"],
        exclude: []
      },
      microneedling: {
        strict: true,
        include: ["microneedling", "microneedl", "skinpen", "dermapen", "micro needling"],
        exclude: []
      },
      filler: {
        strict: true,
        include: ["filler", "fillers", "ha filler", "hyaluronic", "restylane", "juvederm", "juvéderm"],
        exclude: []
      }
    };
  }

  return Object.fromEntries(
    Object.entries(envBuckets).map(([key, value]) => [key, normalizeBucketDef(value)])
  );
}

export const INTENT_BUCKETS = buildIntentBuckets();
if (Object.keys(INTENT_BUCKETS).length === 0) {
  console.warn("[search] INTENT_BUCKETS is empty. Set SEARCH_INTENT_BUCKETS_JSON.");
}

const NEGATION_PATTERNS = parseJsonRegexListEnv(process.env.SEARCH_NEGATION_PATTERNS_JSON);
const NEGATION_RULES = parseJsonNegationRulesEnv(process.env.SEARCH_NEGATION_RULES_JSON);
if (NEGATION_PATTERNS.length === 0) {
  NEGATION_PATTERNS.push(/\b(non|not|without|exclude|avoid)\s+laser\b/i);
}
if (NEGATION_RULES.length === 0) {
  NEGATION_RULES.push({ pattern: /\b(non|not|without|exclude|avoid)\s+laser\b/i, excludes: ["laser"] });
}
const TOKEN_REWRITE = parseJsonStringMapEnv(process.env.SEARCH_TOKEN_REWRITE_JSON);

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeSearchText(value = "") {
  const { protectedText, map } = protectTermsInText(String(value || ""));
  let out = protectedText
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_\s:+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const [from, to] of Object.entries(TOKEN_REWRITE)) {
    const escaped = escapeRegex(from);
    out = out.replace(new RegExp(`\\b${escaped}\\b`, "g"), to);
  }

  out = out.replace(/\s+/g, " ").trim();
  return restoreProtectedTerms(out, map).toLowerCase();
}

function includesPhrase(haystack = "", phrase = "") {
  if (!haystack || !phrase) return false;
  return new RegExp(`\\b${escapeRegex(phrase)}\\b`, "i").test(haystack);
}

function hasTokenCompatibleMatch(haystack = "", phrase = "") {
  const haystackTokens = normalizeSearchText(haystack).split(/\s+/).filter(Boolean);
  const phraseTokens = normalizeSearchText(phrase).split(/\s+/).filter(Boolean);
  if (!haystackTokens.length || !phraseTokens.length) return false;

  return phraseTokens.every((phraseToken) => {
    if (phraseToken.length < 4) return haystackTokens.includes(phraseToken);
    return haystackTokens.some((textToken) => (
      textToken === phraseToken ||
      textToken.startsWith(phraseToken) ||
      phraseToken.startsWith(textToken) ||
      (phraseToken.length >= 6 && textToken.length >= 6 && phraseToken.slice(0, 6) === textToken.slice(0, 6))
    ));
  });
}

export function parseSearchIntent(rawSearch = "") {
  const normalized = normalizeSearchText(rawSearch);
  const matchedNegationRules = NEGATION_RULES.filter((rule) => rule.pattern.test(normalized));
  const hasNegation = matchedNegationRules.length > 0 || NEGATION_PATTERNS.some((re) => re.test(normalized));
  const negationExcludes = Array.from(new Set(
    matchedNegationRules.flatMap((rule) => rule.excludes || []).map((v) => normalizeSearchText(v))
  ));
  const language = /[\u00e5\u00e4\u00f6]/i.test(rawSearch) ? "sv" : "en";

  let intentBucket = null;
  let confidence = 0;
  let matchedKeyword = "";

  for (const [bucket, def] of Object.entries(INTENT_BUCKETS)) {
    const includeHits = (def.include || []).filter((kw) => {
      const normalizedKeyword = normalizeSearchText(kw);
      return includesPhrase(normalized, normalizedKeyword) ||
        hasTokenCompatibleMatch(normalized, normalizedKeyword);
    });
    if (!includeHits.length) continue;

    const exactHit = includeHits.find((kw) => normalizeSearchText(kw) === normalized);
    const bucketScore = exactHit ? 1 : Math.min(0.95, 0.55 + (includeHits.length * 0.1));
    if (bucketScore > confidence) {
      intentBucket = bucket;
      confidence = bucketScore;
      matchedKeyword = includeHits.sort((a, b) => b.length - a.length)[0];
    }
  }

  const intentType = intentBucket
    ? (INTENT_BUCKETS[intentBucket]?.strict ? "strict_category" : "broad_concern")
    : "general";

  return {
    raw: rawSearch,
    normalized,
    language,
    hasNegation,
    intentType,
    canonicalIntent: intentBucket,
    intentBucket,
    intentConfidence: Number(confidence.toFixed(3)),
    matchedKeyword,
    negationExcludes
  };
}

export function isTextAllowedForIntent(text = "", queryInfo = {}) {
  const intent = queryInfo?.intentBucket;
  if (!intent) return true;

  const def = INTENT_BUCKETS[intent];
  if (!def) return true;

  const normalized = normalizeSearchText(text);
  const hasInclude = (def.include || []).some((kw) => {
    const normalizedKeyword = normalizeSearchText(kw);
    return includesPhrase(normalized, normalizedKeyword) ||
      hasTokenCompatibleMatch(normalized, normalizedKeyword);
  });
  if (!hasInclude) return false;

  const hasExclude = (def.exclude || []).some((kw) => {
    const normalizedKeyword = normalizeSearchText(kw);
    return includesPhrase(normalized, normalizedKeyword) ||
      hasTokenCompatibleMatch(normalized, normalizedKeyword);
  });
  if (hasExclude) return false;

  return true;
}

export function isTextExcludedByNegation(text = "", queryInfo = {}) {
  if (!queryInfo?.hasNegation) return false;
  const normalized = normalizeSearchText(text);
  const excludes = Array.isArray(queryInfo?.negationExcludes) ? queryInfo.negationExcludes : [];
  if (!excludes.length) return false;
  return excludes.some((token) => includesPhrase(normalized, token));
}
