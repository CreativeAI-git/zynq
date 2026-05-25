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

  const normalized = search.trim().toLowerCase();

  const scoreResults = await batchGPTSimilarity(rows, normalized);

  const scoreMap = new Map(scoreResults.map(r => [r.id, r.score]));

  const filtered = rows
    .map(r => ({
      ...r,
      score: scoreMap.get(r.treatment_id) ?? 0
    }))
    .filter(r => r.score >= threshold)
    .sort((a, b) => b.score - a.score);

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

  console.log("search", search);

  const normalizedSearch = search.trim().toLowerCase();

  // ----- Step 1: GPT similarity -----
  const gptScoreResults = await batchGPTSimilaritySubTreatments(rows, normalizedSearch);

  const gptScoreMap = new Map();
  gptScoreResults.forEach(r => gptScoreMap.set(r.id, r.score));

  // ----- Step 2: Manual lexical match score -----
  const scoredRows = rows.map(r => {
    const nameEn = (r.name || '').toLowerCase();
    const treatmentEn = (r.treatment_name || '').toLowerCase();

    let nameScore = 0;

    if (nameEn === normalizedSearch || treatmentEn === normalizedSearch) {
      nameScore = 1.0; // exact match
    } else if (nameEn.startsWith(normalizedSearch) || treatmentEn.startsWith(normalizedSearch)) {
      nameScore = 0.7; // prefix match
    } else if (nameEn.includes(normalizedSearch) || treatmentEn.includes(normalizedSearch)) {
      nameScore = 0.5; // contains
    }

    const gptScore = gptScoreMap.get(r.treatment_id) || 0;

    // ----- Step 3: Combine scores (weight: 60% GPT, 40% manual) -----
    const final_score = 0.6 * gptScore + 0.4 * nameScore;

    return {
      ...r,
      gpt_score: gptScore,
      name_score: nameScore,
      final_score
    };
  });

  // ----- Step 4: Filter by threshold -----
  const filtered = scoredRows
    .filter(r => r.final_score >= threshold)
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
${JSON.stringify(rows.map(r => r.treatment_id))}
`;

  const res = await client.chat.completions.create({
    model: "gpt-5-mini",
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


  try {
    const match = raw.match(/{[\s\S]*}/);
    if (!match) return [];
    return JSON.parse(match[0]).results || [];
  } catch (err) {
    console.error(err);
    return [];
  }
}

async function runSubTreatmentSimilarityBatch(batch, searchQuery) {
  const list = batch.map(r => ({
    id: r.treatment_id,
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
${JSON.stringify(batch.map(r => r.treatment_id))}
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

  try {
    const match = raw.match(/{[\s\S]*}/);
    if (!match) return [];
    return JSON.parse(match[0]).results || [];
  } catch (err) {
    console.error(err);
    return [];
  }
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

  try {
    const match = raw.match(/{[\s\S]*}/);
    if (!match) {
      console.error("NO JSON RETURNED:", raw);
      return [];
    }

    return JSON.parse(match[0]).results || [];

  } catch (err) {
    console.error("JSON Parse Error:", err);
    console.log("RAW OUTPUT:", raw);
    return [];
  }
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

  try {
    return JSON.parse(raw).results || [];
  } catch (err) {
    console.error("JSON parse failed:", raw);
    return [];
  }
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

