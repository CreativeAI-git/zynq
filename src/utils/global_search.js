import configs from "../config/config.js";
import db from "../config/db.js";
import { openai } from "../../app.js"
import { deleteGuestDataModel, getInvitedZynqUsers } from "../models/api.js";
import { zynqReminderEnglishTemplate, zynqReminderSwedishTemplate } from "./templates.js";
import { cosineSimilarity } from "./user_helper.js";
import axios from "axios";
import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_KEY });
// 🔹 Levenshtein distance (edit distance)
const levenshteinDistance = (a, b) => {
  const m = a.length, n = b.length;
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
};

// 🔹 Fuzzy similarity between two words (1 → identical, 0 → very different)
const fuzzySimilarity = (a, b) => {
  if (!a || !b) return 0;
  const dist = levenshteinDistance(a, b);
  const maxLen = Math.max(a.length, b.length);
  return 1 - dist / maxLen;
};

const phraseMeaningSimilarity = (a, b) => {
  if (!a || !b) return 0;

  const aTokens = a.toLowerCase().split(/\s+/);
  const bTokens = b.toLowerCase().split(/\s+/);

  let total = 0;

  for (const aTok of aTokens) {
    let best = 0;
    for (const bTok of bTokens) {
      const sim = fuzzySimilarity(aTok, bTok);
      if (sim > best) best = sim;
    }
    total += best;
  }

  // Average across all search tokens
  return total / aTokens.length;
};

const STRICT_INTENT_SYNONYMS = {
  laser: [
    "laser",
    "laser treatment",
    "laser treatments",
    "laserbehandling",
    "laserbehandlingar",
    "laserbehandlingen",
    "nd yag",
    "ndyag",
    "ipl laser"
  ],
  botox: ["botox", "botulinum toxin", "botulinum", "bo tox"],
  filler: ["filler", "fillers", "dermal filler", "dermal fillers"],
  prp: ["prp", "platelet rich plasma", "vampire facial"],
  hydrafacial: ["hydrafacial", "hydra facial", "hydrafacial treatment"],
  morpheus8: ["morpheus8", "morpheus 8", "morpheus-eight"],
  emsella: ["emsella", "em-sella"],
  skinbooster: ["skinbooster", "skin booster", "skinboosters", "skin boosters"],
  facial: ["facial", "facials", "ansiktsbehandling", "ansiktsbehandlingar"]
};

const BROAD_CONCERN_SYNONYMS = {
  acne: ["acne", "akne", "breakout", "breakouts", "pimple", "pimples"],
  wrinkles: ["wrinkle", "wrinkles", "fine lines", "linjer"],
  pigmentation: ["pigmentation", "pigmentering", "melasma", "dark spots"],
  skin_tightening: ["skin tightening", "huduppstramning", "tightening", "firming"],
  hair_removal: ["hair removal", "harborttagning", "h\u00e5rborttagning"]
};

const NEGATIVE_PATTERNS = [
  /\bnon[\s-]?laser\b/i,
  /\bnot[\s-]?laser\b/i,
  /\bwithout[\s-]?laser\b/i,
  /\blaser[\s-]?free\b/i,
  /\binte[\s-]?laser\b/i,
  /\butan[\s-]?laser\b/i
];

const TOKEN_REWRITE = {
  "morpheus 8": "morpheus8",
  "nd:yag": "nd yag",
  "n d yag": "nd yag",
  "laserbehandling": "laser treatment",
  "ansiktsbehandling": "facial treatment",
  "harborttagning": "hair removal",
  "h\u00e5rborttagning": "hair removal",
  "pigmentering": "pigmentation",
  "akne": "acne",
  "huduppstramning": "skin tightening"
};

function normalizeText(value = "") {
  let out = String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s:+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const [from, to] of Object.entries(TOKEN_REWRITE)) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${escaped}\\b`, "g"), to);
  }

  return out.replace(/\s+/g, " ").trim();
}

function includesPhrase(haystack, phrase) {
  if (!haystack || !phrase) return false;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
}

function detectCanonicalIntent(rawSearch = "") {
  const normalized = normalizeText(rawSearch);
  const hasNegation = NEGATIVE_PATTERNS.some((re) => re.test(normalized));

  let strictIntent = null;
  let strictMatchedPhrase = "";
  for (const [intent, synonyms] of Object.entries(STRICT_INTENT_SYNONYMS)) {
    for (const synonym of synonyms) {
      const normSyn = normalizeText(synonym);
      if (includesPhrase(normalized, normSyn) && normSyn.length > strictMatchedPhrase.length) {
        strictIntent = intent;
        strictMatchedPhrase = normSyn;
      }
    }
  }

  let broadIntent = null;
  let broadMatchedPhrase = "";
  for (const [intent, synonyms] of Object.entries(BROAD_CONCERN_SYNONYMS)) {
    for (const synonym of synonyms) {
      const normSyn = normalizeText(synonym);
      if (includesPhrase(normalized, normSyn) && normSyn.length > broadMatchedPhrase.length) {
        broadIntent = intent;
        broadMatchedPhrase = normSyn;
      }
    }
  }

  const language = /[\u00e5\u00e4\u00f6]/i.test(rawSearch) ? "sv" : "en";
  const intentType = strictIntent
    ? "strict_category"
    : broadIntent
      ? "broad_concern"
      : "general";

  return {
    raw: rawSearch,
    normalized,
    language,
    intentType,
    strictIntent,
    broadIntent,
    hasNegation,
    canonicalIntent: strictIntent || broadIntent || null
  };
}

function buildTreatmentMatchText(row = {}) {
  return normalizeText([
    row.name,
    row.swedish,
    row.classification_type,
    row.description_en,
    row.description_sv,
    row.like_wise_terms,
    row.like_wise_terms_swedish,
    row.device_name,
    row.device_name_swedish,
    row.benefits_en,
    row.benefits_sv
  ].filter(Boolean).join(" "));
}

function computeLexicalScore(text, queryInfo, row = {}) {
  const q = queryInfo.normalized;
  if (!q) return 0;

  const nameNorm = normalizeText(row.name || "");
  const swedishNorm = normalizeText(row.swedish || "");

  let score = 0;
  if (nameNorm === q || swedishNorm === q) score = Math.max(score, 1);
  else if (nameNorm.startsWith(q) || swedishNorm.startsWith(q)) score = Math.max(score, 0.9);
  else if (includesPhrase(nameNorm, q) || includesPhrase(swedishNorm, q)) score = Math.max(score, 0.82);
  else if (includesPhrase(text, q)) score = Math.max(score, 0.72);

  const qTokens = q.split(/\s+/).filter(Boolean);
  const textTokens = new Set(text.split(/\s+/).filter(Boolean));
  const tokenOverlap = qTokens.length
    ? qTokens.filter((t) => textTokens.has(t)).length / qTokens.length
    : 0;
  score = Math.max(score, tokenOverlap * 0.75);

  const fuzzy = phraseMeaningSimilarity(q, nameNorm || text);
  score = Math.max(score, fuzzy * 0.7);

  return Math.min(score, 1);
}

function isRowInIntentCategory(text, row, queryInfo) {
  const intent = queryInfo.strictIntent;
  if (!intent) return true;

  const synonyms = STRICT_INTENT_SYNONYMS[intent] || [];
  const hit = synonyms.some((s) => includesPhrase(text, normalizeText(s)));
  if (!hit) return false;

  if (queryInfo.hasNegation && intent === "laser") return false;
  return true;
}

function isRowExcludedByNegation(text, queryInfo) {
  if (!queryInfo.hasNegation) return false;
  return includesPhrase(text, "laser");
}

const TREATMENT_SEARCH_CACHE = new Map();
const TREATMENT_CACHE_TTL_MS = 5 * 60 * 1000;

function hashString(value = "") {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function getRowsSignature(rows = []) {
  const ids = rows
    .map((r) => String(r.treatment_id || ""))
    .filter(Boolean)
    .sort()
    .join("|");

  return `${rows.length}:${hashString(ids)}`;
}

function buildTreatmentCacheKey(queryInfo, rows, threshold) {
  return [
    "treatment",
    queryInfo.normalized,
    queryInfo.hasNegation ? "neg:1" : "neg:0",
    `th:${Number(threshold || 0).toFixed(2)}`,
    `sig:${getRowsSignature(rows)}`
  ].join("::");
}

function getCachedTreatmentRankings(cacheKey) {
  const entry = TREATMENT_SEARCH_CACHE.get(cacheKey);
  if (!entry) return null;

  if ((Date.now() - entry.ts) > TREATMENT_CACHE_TTL_MS) {
    TREATMENT_SEARCH_CACHE.delete(cacheKey);
    return null;
  }

  return entry.rankings;
}

function setCachedTreatmentRankings(cacheKey, rankings) {
  TREATMENT_SEARCH_CACHE.set(cacheKey, {
    ts: Date.now(),
    rankings
  });
}

function treatmentTieBreaker(a, b) {
  if ((b.score ?? 0) !== (a.score ?? 0)) return (b.score ?? 0) - (a.score ?? 0);
  if ((b.lexical_score ?? 0) !== (a.lexical_score ?? 0)) return (b.lexical_score ?? 0) - (a.lexical_score ?? 0);
  if ((b.exact_match ?? 0) !== (a.exact_match ?? 0)) return (b.exact_match ?? 0) - (a.exact_match ?? 0);

  const aName = normalizeText(a.name || a.swedish || "");
  const bName = normalizeText(b.name || b.swedish || "");
  return aName.localeCompare(bName);
}

// --------------------------------------
// 4️⃣ Final boost logic (only based on name)
// --------------------------------------
function getHybridScore(nameScore, fullScore) {

  // 1️⃣ Strong exact/near match → name dominates
  if (nameScore >= 0.80) {
    let hybrid =
      (nameScore * 0.85) +
      (fullScore * 0.10) +
      0.05;

    return Math.min(hybrid, 1);
  }

  // 2️⃣ If nameScore is weak (< 0.50), give ZERO weight to nameScore
  if (nameScore < 0.50) {
    return fullScore;   // ❗ Only semantic score matters
  }

  // 3️⃣ Adaptive Hybrid Weighting (middle range 0.50 - 0.79)
  const diff = Math.abs(fullScore - nameScore);
  let nameWeight = 0.50;
  let fullWeight = 0.50;

  if (diff >= 0.20) {
    nameWeight = 0.35;
    fullWeight = 0.65;
  } else if (diff >= 0.10) {
    nameWeight = 0.45;
    fullWeight = 0.55;
  } else {
    nameWeight = 0.60;
    fullWeight = 0.40;
  }

  return (nameScore * nameWeight) + (fullScore * fullWeight);
}




// export const getTreatmentsVectorResult = async (
//   rows,
//   search,
//   threshold = 0.4,
//   topN = null,
//   language = 'en',
//   actualSearch
// ) => {
//   if (!search?.trim()) return rows;

//   const normalized_search = search.trim().toLowerCase();

//   // 1️⃣ Get embedding for the search term
//   const queryEmbedRes = await axios.post(
//     "http://localhost:11434/api/embeddings",
//     {
//       model: "nomic-embed-text",
//       prompt: normalized_search
//     }
//   );

//   const queryEmbedding = queryEmbedRes.data.embedding;

//   let results = [];

//   for (const row of rows) {
//     if (!row.embeddings) continue;

//     // ----------------------------
//     // Full semantic embeddings
//     // ----------------------------
//     const fullEmbedding = Array.isArray(row.embeddings)
//       ? row.embeddings
//       : JSON.parse(row.embeddings);

//     const fullScore = cosineSimilarity(queryEmbedding, fullEmbedding);

//     // ----------------------------
//     // Name-only embeddings (optional)
//     // ----------------------------
//     let nameScore = 0;

//     if (row.name_embeddings) {
//       const nameEmbedding = Array.isArray(row.name_embeddings)
//         ? row.name_embeddings
//         : JSON.parse(row.name_embeddings);

//       nameScore = cosineSimilarity(queryEmbedding, nameEmbedding);
//     }

// const hybridScore = getHybridScore(nameScore, fullScore);

//     if (hybridScore >= threshold) {
//       const { embeddings, name_embeddings, ...rest } = row;

//       results.push({
//         ...rest,
//         score: hybridScore,
//         fullScore,
//         nameScore
//       });
//     }
//   }

//   // Sort high → low
//   results.sort((a, b) => b.score - a.score);

//   // Translate fields
//   results = results.map((result) => ({
//     ...result,
//     name: language === "en" ? result.name : result.swedish,
//     benefits: language === "en" ? result.benefits_en : result.benefits_sv,
//     description: language === "en" ? result.description_en : result.description_sv,
//   }));

//   return topN ? results.slice(0, topN) : results;
// };


export const getTreatmentsAIResult = async (
  rows,
  search,
  threshold = 0.40,
  topN = null,
  language = "en"
) => {
  if (!search?.trim()) return rows;

  const queryInfo = detectCanonicalIntent(search);
  const cacheKey = buildTreatmentCacheKey(queryInfo, rows, threshold);
  const cachedRankings = getCachedTreatmentRankings(cacheKey);

  if (cachedRankings?.length) {
    const rowsById = new Map(rows.map((r) => [r.treatment_id, r]));
    const cachedResolved = cachedRankings
      .map((item) => {
        const base = rowsById.get(item.treatment_id);
        if (!base) return null;
        return {
          ...base,
          score: item.score,
          lexical_score: item.lexical_score,
          semantic_score: item.semantic_score,
          exact_match: item.exact_match,
          is_fallback: item.is_fallback,
          match_stage: item.match_stage
        };
      })
      .filter(Boolean);

    const translatedFromCache = cachedResolved.map((result) => ({
      ...result,
      name: language === "en" ? result.name : result.swedish,
      benefits: language === "en" ? result.benefits_en : result.benefits_sv,
      description: language === "en" ? result.description_en : result.description_sv
    }));

    return topN ? translatedFromCache.slice(0, topN) : translatedFromCache;
  }

  const prepared = rows.map((row) => {
    const matchText = buildTreatmentMatchText(row);
    const lexicalScore = computeLexicalScore(matchText, queryInfo, row);
    const normalizedQuery = queryInfo.normalized;
    const rowName = normalizeText(row.name || "");
    const rowSwedish = normalizeText(row.swedish || "");
    const exactMatch = (rowName === normalizedQuery || rowSwedish === normalizedQuery) ? 1 : 0;
    return {
      ...row,
      _matchText: matchText,
      _lexicalScore: lexicalScore,
      _exactMatch: exactMatch
    };
  });

  let guarded = prepared
    .filter((row) => !isRowExcludedByNegation(row._matchText, queryInfo))
    .filter((row) => isRowInIntentCategory(row._matchText, row, queryInfo));

  // If strict intent has no guarded candidates, keep it strict and avoid cross-category leakage.
  if (!guarded.length && queryInfo.intentType !== "strict_category") {
    guarded = prepared.filter((row) => !isRowExcludedByNegation(row._matchText, queryInfo));
  }

  const gptCandidates =
    queryInfo.intentType === "strict_category"
      ? guarded.filter((r) => r._lexicalScore >= 0.45)
      : guarded;

  const scoreResults = gptCandidates.length
    ? await batchGPTSimilarity(gptCandidates, queryInfo.normalized)
    : [];

  const scoreMap = new Map(scoreResults.map((r) => [r.id, r.score]));

  const scored = guarded.map((r) => {
    const gptScore = scoreMap.get(r.treatment_id) ?? 0;
    const lexical = r._lexicalScore;
    const finalScore = queryInfo.intentType === "strict_category"
      ? (0.75 * lexical) + (0.25 * gptScore)
      : (0.45 * lexical) + (0.55 * gptScore);

    const exactCategoryHit = queryInfo.strictIntent && isRowInIntentCategory(r._matchText, r, queryInfo);

    return {
      ...r,
      lexical_score: lexical,
      semantic_score: gptScore,
      exact_match: r._exactMatch,
      score: Math.min(finalScore + (exactCategoryHit ? 0.08 : 0), 1)
    };
  });

  const primaryThreshold = queryInfo.intentType === "strict_category"
    ? Math.max(0.55, threshold)
    : Math.max(0.45, threshold);

  const primary = scored
    .filter((r) => r.score >= primaryThreshold || r._lexicalScore >= 0.78)
    .map((r) => ({ ...r, is_fallback: false, match_stage: "primary" }))
    .sort(treatmentTieBreaker);

  // Fallback is only for broad/general intents and always appended after primary.
  const fallback = (queryInfo.intentType === "strict_category" || primary.length > 0)
    ? []
    : scored
      .filter((r) => r.score >= 0.32)
      .sort(treatmentTieBreaker)
      .slice(0, 8)
      .map((r) => ({ ...r, is_fallback: true, match_stage: "fallback" }));

  const filtered = [...primary, ...fallback];

  setCachedTreatmentRankings(
    cacheKey,
    filtered.map((r) => ({
      treatment_id: r.treatment_id,
      score: r.score ?? 0,
      lexical_score: r.lexical_score ?? 0,
      semantic_score: r.semantic_score ?? 0,
      exact_match: r.exact_match ?? 0,
      is_fallback: Boolean(r.is_fallback),
      match_stage: r.match_stage || "primary"
    }))
  );

  const translated = filtered.map(result => ({
    ...result,
    name: language === "en" ? result.name : result.swedish,
    benefits: language === "en" ? result.benefits_en : result.benefits_sv,
    description: language === "en"
      ? result.description_en
      : result.description_sv
  }));

  return topN ? translated.slice(0, topN) : translated;
};

export const getSubTreatmentsAIResult = async (
  rows,
  search,
  threshold = 0.40,
  topN = null,
  language = "en"
) => {
  if (!search?.trim()) return rows;

  const queryInfo = detectCanonicalIntent(search);
  const normalizedSearch = queryInfo.normalized;

  // ----- Step 1: GPT similarity -----
  const gptScoreResults = await batchGPTSimilaritySubTreatments(rows, normalizedSearch);

  const gptScoreMap = new Map();
  gptScoreResults.forEach(r => gptScoreMap.set(r.id, r.score));

  // ----- Step 2: Manual lexical match score -----
  const scoredRows = rows.map(r => {
    const nameEn = normalizeText(r.name || "");
    const treatmentEn = normalizeText(r.treatment_name || "");
    const treatmentSv = normalizeText(r.treatment_swedish || "");
    const text = normalizeText(`${nameEn} ${treatmentEn} ${treatmentSv}`);

    const nameScore = computeLexicalScore(text, queryInfo, {
      name: r.name,
      swedish: r.swedish
    });
    const gptScore = gptScoreMap.get(r.sub_treatment_id) || 0;

    const categoryHit = queryInfo.strictIntent
      ? isRowInIntentCategory(text, r, queryInfo)
      : true;
    const negationExcluded = isRowExcludedByNegation(text, queryInfo);

    // ----- Step 3: Combine scores (weight: 60% GPT, 40% manual) -----
    const final_score = queryInfo.intentType === "strict_category"
      ? (0.7 * nameScore) + (0.3 * gptScore)
      : (0.55 * gptScore) + (0.45 * nameScore);

    return {
      ...r,
      gpt_score: gptScore,
      name_score: nameScore,
      final_score,
      _categoryHit: categoryHit,
      _negationExcluded: negationExcluded
    };
  });

  // ----- Step 4: Filter by threshold -----
  const filtered = scoredRows
    .filter(r => !r._negationExcluded)
    .filter(r => r._categoryHit)
    .filter(r => queryInfo.intentType === "strict_category"
      ? (r.final_score >= Math.max(0.52, threshold) || r.name_score >= 0.78)
      : r.final_score >= Math.max(0.40, threshold))
    .sort((a, b) => b.final_score - a.final_score);

  // ----- Step 5: Translate if needed -----
  const translated = filtered.map(r => ({
    ...r,
    name: language === "en" ? r.name : r.swedish,
    treatment_name: language === "en" ? r.treatment_name : r.treatment_swedish,
  }));

  // ----- Step 6: Limit top N if requested -----
  return topN ? translated.slice(0, topN) : translated;
};


// export const getSubTreatmentsAIResult = async (
//   rows,
//   search,
//   threshold = 0.40,
//   topN = null,
//   language = "en"
// ) => {
//   if (!search?.trim()) return rows;

//   const normalized = search.trim().toLowerCase();

//   const scoreResults = await batchGPTSimilaritySubTreatments(rows, normalized);

//   const scoreMap = new Map(scoreResults.map(r => [r.id, r.score]));

//   const filtered = rows
//     .map(r => ({
//       ...r,
//       score: scoreMap.get(r.treatment_id) ?? 0
//     }))
//     .filter(r => r.score >= threshold)
//     .sort((a, b) => b.score - a.score);

//   const translated = filtered.map(result => ({
//     ...result,
//     name: language === "en" ? result.name : result.swedish,
//     treatment_name: language === "en" ? result.treatment_name : result.treatment_swedish,

//   }));

//   return topN ? translated.slice(0, topN) : translated;
// };


export const getDoctorsVectorResult = async (rows, search, threshold = 0.4, topN = null) => {
  if (!search?.trim()) return rows;

  const normalized_search = search.toLowerCase().replace(/^dr\.?\s*/, "").trim();

  // 1️⃣ Get embedding for the search term
  const response = await axios.post("http://localhost:11434/api/embeddings", {
    model: "nomic-embed-text",
    prompt: normalized_search,
  });
  const queryEmbedding = response.data.embedding;

  // 2️⃣ Compute similarity for each row
  let results = [];

  for (const row of rows) {
    if (!row.embeddings) continue;

    const dbEmbedding = Array.isArray(row.embeddings)
      ? row.embeddings
      : JSON.parse(row.embeddings);

    const doctorName = (row.name || "").toLowerCase().replace(/^dr\.?\s*/, "").trim();
    const doctorTokens = doctorName.split(/\s+/);
    const searchTokens = normalized_search.split(/\s+/);

    // 🔸 Compute fuzzy overlap
    let maxFuzzyScore = 0;
    for (const s of searchTokens) {
      for (const d of doctorTokens) {
        const sim = fuzzySimilarity(s, d);
        if (sim > maxFuzzyScore) maxFuzzyScore = sim;
      }
    }

    // 🔹 Keyword boost based on fuzzy match (e.g., “Karlson” vs “Karlsson” → still boosted)
    const keywordBoost = maxFuzzyScore > 0.7 ? 0.15 * maxFuzzyScore : 0;

    const score = cosineSimilarity(queryEmbedding, dbEmbedding);
    const hybridScore = score + keywordBoost;

    if (hybridScore >= threshold) {
      const { embeddings, ...rest } = row;
      results.push({ ...rest, score: hybridScore });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return topN && topN > 0 ? results.slice(0, topN) : results;
};

export const getDoctorsAIResult = async (rows, search, language = "en") => {
  const normalizedSearch = (search || '').trim().toLowerCase();

  const rowsWithText = rows.map(r => {
    const doctorFullName = `${r.name || ''} ${r.last_name || ''}`.trim();

    const sections = [
      // 🔥 Doctor name repeated to boost GPT attention
      `Primary Doctor Name: ${doctorFullName}`,
      `This Doctor is called ${doctorFullName}`,
      // 📍 Location
      r.clinic_address ? `Doctor Location: ${r.clinic_address}` : '',
      // 💉 Treatments
      r.treatments
        ? `Medical and cosmetic treatments provided at ${doctorFullName}: ${r.treatments}`
        : '',
      // 🧪 Devices
      r.devices
        ? `Medical devices and technology used at ${doctorFullName}: ${r.devices}`
        : ''
    ].filter(Boolean);


    return {
      ...r,
      combined_text: sections.join('. ') + '.'
    };
  });

  // ----- Step 1: GPT similarity -----
  const gptScoreResults = await runGPTSimilarity(rowsWithText, search, {
    idField: "doctor_id",
    textFields: ["combined_text"],
    batchSize: 200
  });

  // Map GPT scores by doctor_id
  const gptScoreMap = new Map();
  if (gptScoreResults?.length) {
    gptScoreResults.forEach(r => {
      gptScoreMap.set(r.doctor_id, r.score);
    });
  }

  // ----- Step 2: Lexical name match score -----
// ----- Step 2: Lexical name + address match score -----
const finalResults = rowsWithText.map(r => {
  const doctorFullName = `${r.name || ''} ${r.last_name || ''}`
    .trim()
    .toLowerCase();

  const addressLower = (r.clinic_address || '').toLowerCase();

  let nameScore = 0;
  let addressScore = 0;

  // ---- NAME SCORING (highest priority) ----
  if (doctorFullName === normalizedSearch) {
    nameScore = 1.0;
  } else if (doctorFullName.startsWith(normalizedSearch)) {
    nameScore = 0.95;
  } else if (doctorFullName.includes(normalizedSearch)) {
    nameScore = 0.85;
  }

  // ---- ADDRESS SCORING (secondary priority) ----
  if (addressLower) {
    if (addressLower === normalizedSearch) {
      addressScore = 0.7;
    } else if (addressLower.startsWith(normalizedSearch)) {
      addressScore = 0.6;
    } else if (addressLower.includes(normalizedSearch)) {
      addressScore = 0.5;
    }
  }

  const gptScore = gptScoreMap.get(r.doctor_id) || 0;

  // ----- Step 3: Combine scores -----
  const final_score =
    (0.45 * nameScore) +
    (0.25 * addressScore) +
    (0.30 * gptScore);

  return {
    ...r,
    gpt_score: gptScore,
    name_score: nameScore,
    address_score: addressScore,
    final_score
  };
});


  // ----- Step 4: Sort by final_score descending -----
  const sortedResults = finalResults.sort((a, b) => b.final_score - a.final_score);

  return sortedResults;
};

// export const getDoctorsAIResult = async (rows, search, language = "en") => {

//   const rowsWithText = rows.map(r => {

//     const sections = [
//       // 🔥 Clinic name repeated to boost GPT attention
//       `Primary Doctor Name: ${r.name} ${r.last_name ? r.last_name : ''}`,
//       `This Doctor is called ${r.name} ${r.last_name ? r.last_name : ''}`,
//       // 📍 Location
//       r.clinic_address ? `Doctor Location: ${r.clinic_address}` : '',
//       // 💉 Treatments
//       r.treatments
//         ? `Medical and cosmetic treatments provided at ${r.name} ${r.last_name ? r.last_name : ''}: ${r.treatments}`
//         : '',
//       // 🧪 Devices
//       r.devices
//         ? `Medical devices and technology used at ${r.name} ${r.last_name ? r.last_name : ''}: ${r.devices}`
//         : ''
//     ].filter(Boolean);



//     return {
//       ...r,
//       // combined_text: `
//       //   Doctor ${r.name || ''} 
//       //   treats ${r.treatments || r.treatment_names || ''} 
//       //   and practices at ${r.clinic_address || ''}.
//       // `.trim()
//       combined_text: sections.join('. ') + '.'
//     }
//   });

//   const scoreResults = await runGPTSimilarity(rowsWithText, search, {
//     idField: "doctor_id",
//     textFields: ["combined_text"]
//   });

//   // ⛔ GPT returned no matches → return empty array
//   if (!scoreResults || scoreResults.length === 0) {
//     console.warn("⚠️ GPT returned no similarity matches");
//     return [];
//   }

//   // Apply similarity threshold
//   let results = applyAISimilarity(rows, scoreResults, {
//     idField: "doctor_id",
//     threshold: 0.40,
//   });

//   // ⛔ After threshold filtering, no results → return empty array
//   if (!results || results.length === 0) {
//     console.warn("⚠️ Similarity threshold removed all results");
//     return [];
//   }

//   return results;
// };

export const getClinicsAIResult = async (rows, search, language = "en") => {
  const normalizedSearch = (search || '').trim().toLowerCase();

  const rowsWithText = rows.map(r => {
    // ---- Treatments ----
    const treatmentNames = Array.isArray(r.treatments)
      ? r.treatments.map(t => t?.name).filter(Boolean)
      : [];

    // ---- Devices ----
    const deviceNames = Array.isArray(r.devices)
      ? r.devices.filter(Boolean)
      : [];

    const clinicName = r.clinic_name || '';

    const sections = [
      // 🔥 Clinic name repeated to boost GPT attention
      `Primary Clinic Name: ${clinicName}`,
      `This clinic is called ${clinicName}`,
      // 📍 Location
      r.address ? `Clinic Location: ${r.address}` : '',
      // 📄 Description
      r.clinic_description ? `Clinic Description: ${r.clinic_description}` : '',

      // 💉 Treatments
      treatmentNames.length
        ? `Medical and cosmetic treatments provided at ${clinicName}: ${treatmentNames.join(', ')}`
        : '',
      // 🧪 Devices
      deviceNames.length
        ? `Medical devices and technology used at ${clinicName}: ${deviceNames.join(', ')}`
        : ''
    ].filter(Boolean);

    return {
      ...r,
      combined_text: sections.join('. ') + '.'
    };
  });

  // ----- Step 1: GPT similarity -----
  const gptScoreResults = await runGPTSimilarity(rowsWithText, search, {
    idField: "clinic_id",
    textFields: ["combined_text"],
    batchSize: 200
  });

  // Map GPT scores by clinic_id
  const gptScoreMap = new Map();
  if (gptScoreResults?.length) {
    gptScoreResults.forEach(r => {
      gptScoreMap.set(r.clinic_id, r.score);
    });
  }

  // ----- Step 2: Lexical name match score -----
// ----- Step 2: Lexical name + address match score -----
const finalResults = rowsWithText.map(r => {
  const nameLower = (r.clinic_name || '').toLowerCase();
  const addressLower = (r.address || '').toLowerCase();

  let nameScore = 0;
  let addressScore = 0;

  // ---- NAME SCORING (highest priority) ----
  if (nameLower === normalizedSearch) {
    nameScore = 1.0;
  } else if (nameLower.startsWith(normalizedSearch)) {
    nameScore = 0.95;
  } else if (nameLower.includes(normalizedSearch)) {
    nameScore = 0.85;
  }

  // ---- ADDRESS SCORING (secondary priority) ----
  if (addressLower) {
    if (addressLower === normalizedSearch) {
      addressScore = 0.7;
    } else if (addressLower.startsWith(normalizedSearch)) {
      addressScore = 0.6;
    } else if (addressLower.includes(normalizedSearch)) {
      addressScore = 0.5;
    }
  }

  const gptScore = gptScoreMap.get(r.clinic_id) || 0;

  // ---- FINAL SCORE (weighted) ----
  const final_score =
    (0.45 * nameScore) +
    (0.25 * addressScore) +
    (0.30 * gptScore);

  return {
    ...r,
    gpt_score: gptScore,
    name_score: nameScore,
    address_score: addressScore,
    final_score
  };
});


  // ----- Step 4: Sort by final_score descending -----
  const sortedResults = finalResults.sort((a, b) => b.final_score - a.final_score);

  return sortedResults;
};

// export const getClinicsAIResult = async (rows, search, language = "en") => {

//   const rowsWithText = rows.map(r => {

//     // ---- Treatments ----
//     const treatmentNames = Array.isArray(r.treatments)
//       ? r.treatments
//           .map(t => t?.name)
//           .filter(Boolean)
//       : [];

//     // ---- Devices ----
//     const deviceNames = Array.isArray(r.devices)
//       ? r.devices.filter(Boolean)
//       : [];

//    const clinicName = r.clinic_name || '';

// const sections = [
//   // 🔥 NAME — repeated & explicitly weighted
//   `Primary Clinic Name: ${clinicName}`,
//   `This clinic is called ${clinicName}`,

//   // 📄 Description
//   r.clinic_description
//     ? `Clinic Description: ${r.clinic_description}`
//     : '',

//   // 📍 Location
//   r.address
//     ? `Clinic Location: ${r.address}`
//     : '',

//   // 💉 Treatments
//   treatmentNames.length
//     ? `Medical and cosmetic treatments provided at ${clinicName}: ${treatmentNames.join(', ')}`
//     : '',

//   // 🧪 Devices
//   deviceNames.length
//     ? `Medical devices and technology used at ${clinicName}: ${deviceNames.join(', ')}`
//     : ''
// ].filter(Boolean);

//     return {
//       ...r,
//       combined_text: sections.join('. ') + '.'
//     };
//   });

//   const scoreResults = await runGPTSimilarity(rowsWithText, search, {
//     idField: "clinic_id",
//     textFields: ["combined_text"],
//     batchSize: 200
//   });

//   if (!scoreResults || scoreResults.length === 0) {
//     console.warn("⚠️ GPT returned no similarity matches");
//     return [];
//   }

//   let results = applyAISimilarity(rows, scoreResults, {
//     idField: "clinic_id",
//     threshold: 0.45
//   });

//   if (!results || results.length === 0) {
//     console.warn("⚠️ Similarity threshold removed all results");
//     return [];
//   }

//   return results;
// };

function computeDeviceNameScore(deviceName, search) {
  if (!deviceName || !search) return 0;

  const name = deviceName.toLowerCase();
  const query = search.toLowerCase();

  // Normalize plurals
  const normalize = str =>
    str.replace(/\bdevices\b/g, 'device').trim();

  const nameNorm = normalize(name);
  const queryNorm = normalize(query);

  if (nameNorm === queryNorm) return 1.0;

  if (nameNorm.startsWith(queryNorm)) return 0.95;

  if (nameNorm.includes(queryNorm)) return 0.85;

  // Word-level token match
  const nameTokens = new Set(nameNorm.split(/\s+/));
  const queryTokens = queryNorm.split(/\s+/);

  const matched = queryTokens.filter(t => nameTokens.has(t));

  if (matched.length > 0) return 0.75;

  return 0;
}


export const getDevicesAIResult = async (
  rows,
  search,
  threshold = 0.40,
  topN = null
) => {
  if (!search?.trim()) return rows;

  const normalizedSearch = search.trim().toLowerCase();

  const gptScoreResults = await batchDeviceGPTSimilarity(rows, normalizedSearch);
  const gptScoreMap = new Map(gptScoreResults.map(r => [r.id, r.score]));

  const scored = rows.map(r => {
    const gptScore = gptScoreMap.get(r.id) ?? 0;
    const nameScore = computeDeviceNameScore(r.device_name, normalizedSearch);

    let final_score;
    if (nameScore >= 0.8) {
      final_score = Math.max(gptScore, nameScore);
    } else {
      final_score = 0.6 * gptScore + 0.4 * nameScore;
    }

    return {
      ...r,
      gpt_score: gptScore,
      name_score: nameScore,
      final_score
    };
  });

  const filtered = scored
    .filter(r => r.final_score >= threshold || r.name_score >= 0.8)
    .sort((a, b) => b.final_score - a.final_score);

  return topN ? filtered.slice(0, topN) : filtered;
};


// export const getDevicesAIResult = async (
//   rows,
//   search,
//   threshold = 0.40,
//   topN = null,
//   language = "en"
// ) => {
//   if (!search?.trim()) return rows;

//   const normalized = search.trim().toLowerCase();

//   const scoreResults = await batchDeviceGPTSimilarity(rows, normalized);
//   const scoreMap = new Map(scoreResults.map(r => [r.id, r.score]));

//   const filtered = rows
//     .map(r => ({
//       ...r,
//       score: scoreMap.get(r.id) ?? 0
//     }))
//     .filter(r => r.score >= threshold)
//     .sort((a, b) => b.score - a.score);

//   const translated = filtered.map(result => ({
//     ...result,
//     device_name: result.device_name,
//     treatment_name: result.treatment_name
//   }));

//   return topN ? translated.slice(0, topN) : translated;
// };


export const getClinicsVectorResult = async (rows, search, threshold = 0.4, topN = null) => {
  if (!search?.trim()) return rows;

  const normalized_search = search.toLowerCase().replace(/^dr\.?\s*/, "").trim();

  // 1️⃣ Get embedding for the search term
  const response = await axios.post("http://localhost:11434/api/embeddings", {
    model: "nomic-embed-text",
    prompt: normalized_search,
  });
  const queryEmbedding = response.data.embedding;

  // 2️⃣ Compute similarity for each row
  const results = [];

  for (const row of rows) {
    if (!row.embeddings) continue;

    const dbEmbedding = Array.isArray(row.embeddings)
      ? row.embeddings
      : JSON.parse(row.embeddings);

    const clinicName = (row.clinic_name || "").toLowerCase().replace(/^dr\.?\s*/, "").trim();
    const clinicTokens = clinicName.split(/\s+/);
    const searchTokens = normalized_search.split(/\s+/);

    // 🔸 Compute fuzzy overlap
    let maxFuzzyScore = 0;
    for (const s of searchTokens) {
      for (const d of clinicTokens) {
        const sim = fuzzySimilarity(s, d);
        if (sim > maxFuzzyScore) maxFuzzyScore = sim;
      }
    }

    // 🔹 Keyword boost based on fuzzy match (e.g., “Karlson” vs “Karlsson” → still boosted)
    const keywordBoost = maxFuzzyScore > 0.7 ? 0.15 * maxFuzzyScore : 0;

    const score = cosineSimilarity(queryEmbedding, dbEmbedding);
    const hybridScore = score + keywordBoost;

    if (hybridScore >= threshold) {
      const { embeddings, ...rest } = row;
      results.push({ ...rest, score: hybridScore });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return topN && topN > 0 ? results.slice(0, topN) : results;
};

function parseSimilarityResponse(raw, context = "similarity") {
  if (typeof raw !== "string" || !raw.trim()) {
    console.error(`[${context}] Empty or invalid model response`);
    return [];
  }

  const normalizeJSON = (value) => value
    .replace(/^\uFEFF/, "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");

  const candidates = [];
  const trimmed = raw.trim();
  candidates.push(trimmed);

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch?.[0]) candidates.push(objectMatch[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(normalizeJSON(candidate));
      if (!Array.isArray(parsed?.results)) continue;

      return parsed.results
        .filter((row) => row && row.id !== undefined && row.score !== undefined)
        .map((row) => ({
          id: String(row.id),
          score: Number.isFinite(Number(row.score)) ? Number(row.score) : 0,
        }));
    } catch {
      // Try next candidate variant
    }
  }

  console.error(`[${context}] Failed to parse model JSON response`);
  return [];
}

async function batchGPTSimilarity(rows, searchQuery) {

  // const list = rows.map(r => ({
  //   id: r.treatment_id,
  //   text: `${safeString(r.name)} - ${safeString(r.concern_en)} ${safeString(r.description_en)} ${safeString(r.like_wise_terms)}`.trim() 
  // }));

  const list = rows.map(r => ({
    id: r.treatment_id,
    text: `
Treatment Name: ${safeString(r.name)}
Sub Treatment Name : ${safeString(r.sub_treatment_name_en) || ''}
Primary Concern: ${safeString(r.concern_en) || ''}
Description: ${safeString(r.description_en) || ''}
Related Terms: ${safeString(r.like_wise_terms) || ''}
  `.trim()
  }));


//   const prompt = `
// You are a STRICT treatment similarity engine.

// Your task:
// Compare the Search Query with the ITEM LIST
// and score ONLY by direct treatment relevance.

// Search Query: "${searchQuery}"

// Return ONLY this exact JSON:
// {
//   "results": [
//     { "id": string, "score": number }
//   ]
// }

// IMPORTANT RULES ABOUT IDs:
// • You MUST ONLY return IDs from the ITEM LIST.
// • Never invent or modify an ID.
// • IDs are strings (UUIDs), NOT numbers.
// • If unsure, return lower score, not a fake ID.

// STRICT MATCHING RULES:
// • Exact treatment category match = high score
// • Different treatment categories = low score
// • Do NOT match only because both are cosmetic/aesthetic treatments
// • Botox, fillers, laser, RF, microneedling, peeling are DIFFERENT categories
// • If query is "laser", then botox/fillers should score below 0.30
// • If query is "botox", laser treatments should score below 0.30

// SCORING:
// • 0.90 – 1.00 = nearly exact match
// • 0.75 – 0.89 = strong related treatment
// • 0.40 – 0.60 = partial similarity only
// • Below 0.40 = weak match

// NEGATION RULE:
// If query contains:
//   - "non laser"
//   - "not laser"
//   - "without laser"
// Then:
//   a) Exclude laser-related treatments
//   b) Match alternative non-laser treatments

// VERY IMPORTANT:
// • Never give medium/high score to unrelated treatment technologies
// • Treatment technology matters more than cosmetic purpose
// • Prefer precision over broad semantic similarity

// ITEM LIST:
// ${JSON.stringify(list)}

// ALLOWED IDs:
// ${JSON.stringify(rows.map(r => r.treatment_id))}
// `;

const prompt = `
You are a strict similarity scoring engine.
Your task is to compare each item in the ITEM LIST against the Search Query and assign an accurate similarity score based on intent, keywords, and semantic meaning.
Search Query: "${searchQuery}"
Return ONLY this exact JSON format:
{
 "results": [
   { "id": string, "score": number }
 ]
}
IMPORTANT RULES ABOUT IDs:
• You MUST ONLY return IDs that exist in the ITEM LIST
• Never invent, generate, edit, or modify any ID
• IDs are strings (UUIDs), NOT numbers
• If unsure, return a lower score instead of guessing
• Every returned ID must exactly match an ID from the ITEM LIST
SCORING RULES:
• 0.85 – 1.00 = strong match
• 0.60 – 0.84 = good match
• 0.40 – 0.59 = medium match
• 0.20 – 0.39 = weak match
• 0.01 – 0.19 = very weak relation
• Never return 0 unless the item is completely unrelated
MATCHING RULES:
• Exact intent match is MORE important than broad semantic similarity
• Do NOT match items only because they belong to the same category
• Understand spelling mistakes, abbreviations, and Swedish-English variations
• Prefer exact treatment technology matches over generic cosmetic similarity
• Penalize mismatched technologies heavily
• Broad category similarity alone is NOT enough for a high score
STRICT TECHNOLOGY RULES:
• Laser treatments ≠ non-laser treatments
• Facial treatments ≠ laser treatments
• RF / EMS / ultrasound / massage / facial / skin tightening treatments are NOT laser unless explicitly stated
• Only treat something as laser if the item clearly indicates laser-based technology
LASER QUERY RULE:
If the Search Query contains:
• "laser"
Then:
• Prioritize explicitly laser-based treatments
• Strong laser matches should score 0.85+
• Non-laser treatments must score below 0.35
NEGATION RULE:
If the Search Query contains:
• "non laser"
• "not laser"
• "without laser"
Then:
• Laser-related treatments MUST score below 0.20
• Prefer explicitly non-laser treatments
• Non-laser alternatives may score normally
• Do NOT return laser treatments as strong or good matches
MATCHING LOGIC:
• Exact keyword + exact intent + semantic relevance = highest score
• Partial relevance = medium or weak score
• Similar category but different technology = low score
• If uncertain, prefer lower scores over aggressive matching
ITEM LIST:
${JSON.stringify(list)}
ALLOWED IDs:
${JSON.stringify(rows.map(r => r.treatment_id))}
`;

  const res = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You output ONLY valid JSON. No extra text. No markdown."
      },
      {
        role: "user",
        content: prompt
      }
    ]
  });

  const raw = res.choices[0].message.content;


  return parseSimilarityResponse(raw, "batchGPTSimilarity");
}

async function runSubTreatmentSimilarityBatch(batch, searchQuery) {
  const list = batch.map(r => ({
    id: r.sub_treatment_id,
    text: `
Sub Treatment Name: ${safeString(r.name)}
Treatment Name: ${safeString(r.treatment_name)}
    `.trim()
  }));

  const prompt = `
You are a similarity scoring engine.
Compare each item in the list to the search query.

Search Query: "${searchQuery}"

Return ONLY this exact JSON:
{
  "results": [
    { "id": string, "score": number }
  ]
}

IMPORTANT RULES ABOUT IDs:
• You MUST ONLY return IDs from the ITEM LIST.
• Never invent or modify an ID.
• IDs are strings (UUIDs), NOT numbers.
• If unsure, return lower score, not a fake ID.

SCORING RULES:
• 0.85 – 1.0 strong match
• 0.60 – 0.85 good match
• 0.40 – 0.60 medium match
• Medium similarity MUST stay in 0.40–0.60
• Understand spelling errors & Swedish–English variants
• Never output 0 unless 100% unrelated

NEGATION RULE:
If query contains:
  - "non laser"
  - "not laser"
  - "without laser"
Then:
  a) Exclude laser-related treatments
  b) Still match best semantic alternatives

ITEM LIST:
${JSON.stringify(list)}

ALLOWED IDs:
${JSON.stringify(batch.map(r => r.sub_treatment_id))}
`;

  const res = await client.chat.completions.create({
    model: "gpt-5-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You output ONLY valid JSON. No extra text. No markdown." },
      { role: "user", content: prompt }
    ]
  });

  const raw = res.choices[0].message.content;

  return parseSimilarityResponse(raw, "runSubTreatmentSimilarityBatch");
}

export async function batchGPTSimilaritySubTreatments(rows, searchQuery, batchSize = 100) {
  const batches = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    batches.push(rows.slice(i, i + batchSize));
  }

  // console.log(`Processing ${batches.length} batches in parallel...`);

  // Run all batches in parallel
  const batchPromises = batches.map(batch =>
    runSubTreatmentSimilarityBatch(batch, searchQuery)
  );

  const results = await Promise.all(batchPromises);

  // Optional debugging
  results.forEach((partial, idx) => {
  });

  return results.flat();
}


export async function batchDeviceGPTSimilarity(rows, searchQuery, batchSize = 100) {
  const batches = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    batches.push(rows.slice(i, i + batchSize));
  }

  // console.log(`Processing ${batches.length} batches in parallel...`);

  // Process all batches in parallel
  const batchPromises = batches.map(batch =>
    runDeviceSimilarityBatch(batch, searchQuery)
  );

  const results = await Promise.all(batchPromises);

  // Log each partial result
  results.forEach(partial => {
    // console.log("partial device", partial);
  });

  return results.flat();
}



/**
 * 🧠 Runs GPT similarity on a *single batch*
 */
async function runDeviceSimilarityBatch(rows, searchQuery) {
  if (!rows || rows.length === 0) return [];

  const list = rows.map(r =>
    `${r.id}|${safeString(r.device_name)} ${safeString(r.treatment_name)}`
  );


  const prompt = `
You are a STRICT JSON similarity scoring engine for DEVICES ONLY.

Search Query: "${searchQuery}"

Return ONLY JSON in this format:
{
  "results": [
    { "id": "string", "score": number }
  ]
}

RULES:

1️⃣ DEVICE MATCHING
- If DEVICE NAME exactly matches the search query → score 0.85–1.0
- If DEVICE NAME partially matches the search query → score 0.6–0.85
- If TREATMENT NAME matches but DEVICE NAME does not → score 0.4–0.6
- If neither DEVICE NAME nor TREATMENT NAME matches → score 0.0–0.3

2️⃣ CATEGORY RULE (if query implies a category, e.g., "laser", "IPL", "RF", "HIFU", "LED", "injectable")
- Exact DEVICE NAME match → 0.85–1.0
- Partial DEVICE NAME match → 0.6–0.85
- TREATMENT NAME match only → 0.4–0.6
- Category mismatch → 0.0–0.3

3️⃣ NEGATION RULE
- If query contains "non laser", "not laser", "without laser":
  • LASER devices → 0.0–0.2
  • Non-laser devices → score normally

4️⃣ GENERAL RULES
- Only compare DEVICE NAME + TREATMENT NAME
- Never force a match if uncertain
- Never hallucinate IDs; only return IDs from the item list
- Queries unrelated to devices → all scores 0.0

SCORING SCALE:
- 0.85–1.0 strong match
- 0.60–0.85 good match
- 0.40–0.60 weak match
- 0.0–0.30 unrelated or category mismatch

ITEM LIST (id|text):
${list.join("\n")}
`;


  //   const prompt = `
  // You are a STRICT JSON similarity scoring engine for DEVICES ONLY.

  // Search Query: "${searchQuery}"

  // Return ONLY this JSON:
  // {
  //   "results": [
  //     { "id": "string", "score": number }
  //   ]
  // }

  // GENERAL RULES:
  // 1. If the search query is NOT about a device → all scores = 0.0
  // 2. If the query refers to clinics, doctors, people, cities, symptoms, body parts → all scores = 0.0
  // 3. Only compare DEVICE NAME + TREATMENT NAME.
  // 4. Never force a match if uncertain.
  // 5. Never hallucinate IDs. Only return IDs from the item list.

  // DEVICE CATEGORY RULE (MANDATORY):
  // If the search query implies a device category (e.g., “laser”, “IPL”, “RF”, “radiofrequency”, “ultrasound”, “HIFU”, “LED”, “injectable”):

  //   A. If DEVICE NAME exactly matches query → score 0.85–1.0, If DEVICE NAME partially matches query → score 0.6–0.85, If TREATMENT NAME matches but DEVICE NAME does not → score 0.4–0.6.

  //   B. Treatment name similarity CANNOT raise a score above 0.30
  //      if the device category does not match.

  //   C. If device category does NOT match the query:
  //         Score MUST be 0.0–0.30.

  // NEGATION RULE:
  // If query contains:
  //   • "non laser"
  //   • "not laser"
  //   • "without laser"

  //   Then:
  //     • All LASER devices MUST be scored 0.0–0.20
  //     • Non-laser devices may score normally

  // SCORING SCALE:
  // • 0.85–1.0 strong match (same device)
  // • 0.60–0.85 good match (same category)
  // • 0.40–0.60 weak match (same category, but further)
  // • 0.0–0.30 category mismatch or unrelated

  // ITEM LIST (id|text):
  // ${list.join("\n")}
  //   `;

  const res = await client.chat.completions.create({
    model: "gpt-5-mini",
    max_tokens: 4096,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Return ONLY pure JSON. No markdown." },
      { role: "user", content: prompt }
    ]
  });

  const raw = res.choices[0].message.content;

  return parseSimilarityResponse(raw, "runDeviceSimilarityBatch");
}



/**
 * 🔥 Universal GPT Similarity Engine
 * Works for doctors, clinics, devices, treatments, anything.
 */
export async function runGPTSimilarity(rows, searchQuery, options = {}) {
  const {
    idField = "id",
    textFields = [],
    batchSize = 200,
  } = options;

  if (!rows || rows.length === 0) return [];
  if (!searchQuery?.trim()) return [];

  // Split into batches
  const batches = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    batches.push(rows.slice(i, i + batchSize));
  }

  // ------------------------------
  // RUN ALL BATCHES IN PARALLEL
  // ------------------------------
  const results = await Promise.all(
    batches.map(batch =>
      runSingleBatch(batch, searchQuery, idField, textFields)
        .catch(err => {
          console.error("Batch failed:", err);
          return []; // return empty so other batches still succeed
        })
    )
  );

  // Flatten result arrays
  return results.flat();
}



/**
 * 🧠 Runs GPT similarity on a single batch
 */
async function runSingleBatch(batch, searchQuery, idField, textFields) {

  // compact "id|text" format
  const list = batch.map((row) => {
    const id = row[idField];
    const combinedText = textFields
      .map(f => safeString(row[f]))
      .filter(Boolean)
      .join(" ");

    return `${id}|${combinedText}`;
  });

  const prompt = `
You are a similarity scoring engine.
Compare each item with the search query.

Search Query: "${searchQuery}"

Return ONLY:
{
  "results": [
    { "id": string, "score": number }
  ]
}

SCORING:
• 0.85 – 1.0 strong  
• 0.60 – 0.85 good  
• 0.40 – 0.60 medium   
• 0.0–0.30 category mismatch or unrelated
• Never output 0 unless fully unrelated  

NEGATION RULE:
If query contains:
 - "non laser"
 - "not laser"
 - "without laser"
then downscore items related to "laser".

ITEM LIST (id|text):
${list.join("\n")}
`;

  const res = await client.chat.completions.create({
    model: "gpt-5-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Output ONLY JSON. No markdown." },
      { role: "user", content: prompt }
    ]
  });

  const raw = res.choices[0].message.content;

  return parseSimilarityResponse(raw, "runSingleBatch");
}

export function applyAISimilarity(rows, scoreResults, {
  idField = "id",
  threshold = 0.40,
  topN = null
}) {

  const scoreMap = new Map(scoreResults.map(r => [r.id, r.score]));

  const filtered = rows
    .map(r => ({ ...r, score: scoreMap.get(r[idField]) ?? 0 }))
    .filter(r => r.score >= threshold)
    .sort((a, b) => b.score - a.score);

  return topN ? filtered.slice(0, topN) : filtered;
}










function safeString(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

