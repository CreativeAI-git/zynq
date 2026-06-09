import { protectTermsInText, restoreProtectedTerms } from "./protected_terms.js";

import dotenv from "dotenv";

dotenv.config();

export const SPECIFIC_LASER_BUCKETS = new Set(["ipl", "pico", "alexandrite", "thulium", "co2", "erbium", "ndyag"]);
export const ALL_LASER_BUCKETS = new Set(["laser", ...SPECIFIC_LASER_BUCKETS]);


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
        include: ["acne scars", "acne scar", "aknearr", "akneärr", "akne arr", "scar", "scars", "ärr", "arr"],
        exclude: []
      },
      redness: {
        strict: false,
        include: ["redness", "rodhet", "rödhet", "rosacea", "vascular", "blood vessels", "rodnad", "blodkärl", "kärl", "ytliga blodkärl"],
        exclude: []
      },
      loose_skin: {
        strict: false,
        include: ["loose skin", "slapp hud", "skin tightening", "hud tightening", "tightening", "sagging", "firming", "huduppstramning", "huduppstramande", "slapphet", "fasthet"],
        exclude: []
      },
      dark_circles: {
        strict: false,
        include: [
          "dark circles", "under eye", "under eyes", "tear trough", "morka ringar", "mörka ringar",
          "under ögon", "under ögonen", "underögon", "påsar under ögonen", "påsar under ögon",
          "trötta ögon", "blå under ögonen", "mörka ringar under ögonen"
        ],
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
        include: ["laser", "laser treatment", "laserbehandling", "laserbehandling", "laser hair removal", "laser pigmentation"],
        exclude: ["non laser", "not laser", "without laser"]
      },
      ipl: {
        strict: true,
        include: ["ipl"],
        exclude: []
      },
      pico: {
        strict: true,
        include: ["pico", "picosecond"],
        exclude: []
      },
      alexandrite: {
        strict: true,
        include: ["alexandrite"],
        exclude: []
      },
      thulium: {
        strict: true,
        include: ["thulium"],
        exclude: []
      },
      co2: {
        strict: true,
        include: ["co2", "co 2", "carbon dioxide"],
        exclude: []
      },
      erbium: {
        strict: true,
        include: ["erbium", "er:yag", "eryag"],
        exclude: []
      },
      ndyag: {
        strict: true,
        include: ["nd:yag", "ndyag", "n d yag"],
        exclude: []
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

const BUILTIN_INTENT_BUCKETS = {
  under_eye: {
    strict: false,
    include: ["dark circles", "mörka ringar", "morka ringar", "under eye", "under eyes", "eye bags"],
    exclude: []
  },
  laser: {
    strict: true,
    include: ["laser", "laser treatment", "laserbehandling", "laserbehandling", "laser hair removal", "laser pigmentation", "fotona", "morpheus8", "prp", "lasermd", "clarity ii", "candela nordlys"],
    exclude: []
  }
};

const ENV_INTENT_BUCKETS = buildIntentBuckets();

export const INTENT_BUCKETS = {
  ...ENV_INTENT_BUCKETS,
  ...Object.fromEntries(
    Object.entries(BUILTIN_INTENT_BUCKETS).filter(([key]) => !ENV_INTENT_BUCKETS[key])
  )
};
if (Object.keys(INTENT_BUCKETS).length === 0) {
  console.warn("[search] INTENT_BUCKETS is empty. Set SEARCH_INTENT_BUCKETS_JSON.");
}

const NEGATION_PATTERNS = parseJsonRegexListEnv(process.env.SEARCH_NEGATION_PATTERNS_JSON);
const NEGATION_RULES = parseJsonNegationRulesEnv(process.env.SEARCH_NEGATION_RULES_JSON);
if (NEGATION_PATTERNS.length === 0) {
  NEGATION_PATTERNS.push(/\b(?:non|not|without|exclude|avoid|no|anti)\b[\s-]*laser\b/i);
  NEGATION_PATTERNS.push(/\blaser[\s-]*(?:free|less)\b/i);
}
if (NEGATION_RULES.length === 0) {
  NEGATION_RULES.push({ pattern: /\b(?:non|not|without|exclude|avoid|no|anti)\b[\s-]*laser\b/i, excludes: ["laser"] });
  NEGATION_RULES.push({ pattern: /\blaser[\s-]*(?:free|less)\b/i, excludes: ["laser"] });
}

const NEGATION_TARGET_DEFS = [
  {
    target: "laser",
    keywords: ["laser", "ipl", "pico", "picosecond", "alexandrite", "thulium", "fotona", "clarity ii", "candela nordlys", "lasermd", "lase md", "nd:yag", "nd yag", "n d yag"]
  },
  {
    target: "rf",
    keywords: ["rf", "radiofrequency", "radio frequency", "radiofrekvens", "microneedling rf", "secret rf", "genius rf", "vivace rf"]
  },
  {
    target: "hifu",
    keywords: ["hifu", "high intensity focused ultrasound", "ultrasound", "ultraljud", "ultherapy", "ultraformer"]
  },
  {
    target: "microneedling",
    keywords: ["microneedling", "microneedl", "skinpen", "dermapen", "micro needling", "morpheus", "morpheus8", "morpheus 8"]
  },
  {
    target: "filler",
    keywords: ["filler", "fillers", "ha filler", "hyaluronic", "restylane", "juvederm", "juvéderm", "belkyra"]
  },
  {
    target: "hair_removal",
    keywords: ["hair removal", "laser hair removal", "hair reduction", "hårborttagning", "harborttagning", "soprano", "gentlemax", "lightsheer"]
  }
];

const NEGATION_PREFIX_PATTERN = /\b(?:non|not|without|exclude|avoid|no|anti)\b[\s-]*/i;
const NEGATION_SUFFIX_PATTERN = /[\s-]*(?:free|less)\b/i;

function buildNegationTargets(normalized = "") {
  const targets = [];
  const cleaned = normalizeSearchText(normalized);

  for (const rule of NEGATION_TARGET_DEFS) {
    const keywordHit = (rule.keywords || []).some((kw) => {
      const normalizedKeyword = normalizeSearchText(kw);
      return includesPhrase(cleaned, normalizedKeyword) ||
        hasTokenCompatibleMatch(cleaned, normalizedKeyword);
    });

    if (!keywordHit) continue;

    const isNegated =
      NEGATION_PREFIX_PATTERN.test(cleaned) ||
      NEGATION_SUFFIX_PATTERN.test(cleaned) ||
      /\b(?:non|not|without|exclude|avoid|no|anti)\b[\s-]*\S+/i.test(cleaned);

    if (isNegated) targets.push(rule.target);
  }

  return Array.from(new Set(targets));
}

function buildNegationSearchHint(targets = []) {
  const uniqueTargets = Array.from(new Set((targets || []).map((value) => String(value || "").trim()).filter(Boolean)));
  if (!uniqueTargets.length) return "";

  const map = {
    laser: "non laser treatments",
    rf: "non rf treatments",
    hifu: "non hifu treatments",
    microneedling: "non microneedling treatments",
    filler: "non filler treatments",
    hair_removal: "non hair removal treatments"
  };

  return uniqueTargets.map((target) => map[target] || `non ${target} treatments`).join(" ");
}

const DEFAULT_TOKEN_REWRITE = {
  "dark circles": "dark circles under eye",
  "mörka ringar": "mörka ringar dark circles under eye",
  "morka ringar": "morka ringar dark circles under eye",
  "under eye": "under eye dark circles",
  "under eyes": "under eyes under eye dark circles",
  "laserbehandling": "laserbehandling laser treatment",
  "laser behandling": "laser behandling laser treatment",
  "laser pigmentering": "laser pigmentering laser pigmentation",
  "laser hair removal": "laser hair removal hair reduction",
  "zelda": "zelda"
};
const TOKEN_REWRITE = {
  ...DEFAULT_TOKEN_REWRITE,
  ...parseJsonStringMapEnv(process.env.SEARCH_TOKEN_REWRITE_JSON)
};

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const NORMALIZE_TEXT_CACHE = new Map();

export function normalizeSearchText(value = "") {
  const cacheKey = String(value || "");
  if (NORMALIZE_TEXT_CACHE.has(cacheKey)) {
    return NORMALIZE_TEXT_CACHE.get(cacheKey);
  }

  const { protectedText, map } = protectTermsInText(cacheKey);
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
  const result = restoreProtectedTerms(out, map).toLowerCase();
  
  NORMALIZE_TEXT_CACHE.set(cacheKey, result);
  return result;
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

const INTENT_CACHE = new Map();

export function parseSearchIntent(rawSearch = "") {
  const cacheKey = String(rawSearch || "").trim().toLowerCase();
  if (INTENT_CACHE.has(cacheKey)) {
    return INTENT_CACHE.get(cacheKey);
  }

  const normalized = normalizeSearchText(rawSearch);
  const negationTargets = buildNegationTargets(normalized);
  const matchedNegationRules = NEGATION_RULES.filter((rule) => rule.pattern.test(normalized));
  const hasNegation = matchedNegationRules.length > 0 || negationTargets.length > 0 || NEGATION_PATTERNS.some((re) => re.test(normalized));
  const negationExcludes = Array.from(new Set(
    [
      ...matchedNegationRules.flatMap((rule) => rule.excludes || []).map((v) => normalizeSearchText(v)),
      ...negationTargets.map((v) => normalizeSearchText(v))
    ]
  ));
  const negationSearchHint = buildNegationSearchHint(negationTargets);
  const excludesLaser = hasNegation && (
    negationTargets.includes("laser") ||
    negationExcludes.includes("laser") ||
    /\b(?:non|not|without|exclude|avoid|no|anti)\b[\s-]*laser\b/i.test(normalized) ||
    /\blaser[\s-]*(?:free|less)\b/i.test(normalized)
  );
  const language = /[\u00e5\u00e4\u00f6]/i.test(rawSearch) ? "sv" : "en";

  let intentBucket = null;
  let confidence = 0;
  let matchedKeyword = "";

  for (const [bucket, def] of Object.entries(INTENT_BUCKETS)) {
    if (ALL_LASER_BUCKETS.has(bucket) && excludesLaser) continue;
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

  const result = {
    raw: rawSearch,
    normalized,
    language,
    hasNegation,
    intentType,
    canonicalIntent: intentBucket,
    intentBucket,
    intentConfidence: Number(confidence.toFixed(3)),
    matchedKeyword,
    negationExcludes,
    negationTargets,
    negationSearchHint
  };

  INTENT_CACHE.set(cacheKey, result);
  return result;
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
