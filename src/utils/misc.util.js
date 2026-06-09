import configs from "../config/config.js";
import db from "../config/db.js";
import { deleteGuestDataModel, getInvitedZynqUsers } from "../models/api.js";
import { zynqReminderEnglishTemplate, zynqReminderSwedishTemplate } from "./templates.js";
import { sendEmail } from "../services/send_email.js";
import { cosineSimilarity } from "./user_helper.js";
import axios from "axios";
import OpenAI from "openai";
import { googleTranslator } from "./user_helper.js";
import {
    PROTECTED_TERMS,
    containsProtectedTerm,
    restoreCanonicalBrandTerms,
} from "../search/protected_terms.js";

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const isEmpty = (value) => {
    if (value === null || value === undefined) return true;
    if (typeof value === 'boolean' || typeof value === 'number') return false;
    if (typeof value === 'string') return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    if (value instanceof Map || value instanceof Set) return value.size === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
};

// export const getTreatmentIDsByUserID = async (userID) => {
//     if (!userID) return [];

//     // Safe JSON parser
//     const safeJSONParse = (data) => {
//         try {
//             return JSON.parse(data);
//         } catch (err) {
//             console.error("JSON Parse Error:", err);
//             return null;
//         }
//     };

//     // Fetch the latest scan result
//     const result = await db.query(
//         `SELECT aiAnalysisResult 
//          FROM tbl_face_scan_results 
//          WHERE user_id = ? 
//          ORDER BY created_at DESC 
//          LIMIT 1`,
//         [userID]
//     );

//     if (!result || result.length === 0) return [];

//     const parsed = safeJSONParse(result[0].aiAnalysisResult);
//     if (!parsed || !Array.isArray(parsed.skinIssues)) return [];

//     let treatmentIDs = [];
//     // Loop all skinIssues and select IDs with % > 20
//     parsed.skinIssues.forEach(issue => {
//         if (issue.percentage && issue.percentage > 20 && Array.isArray(issue.recommendedTreatmentsIds)) {
//             treatmentIDs.push(...issue.recommendedTreatmentsIds);
//         }
//     });

//     // Unique IDs
//     treatmentIDs = [...new Set(treatmentIDs)];
//     return treatmentIDs;
// };

export const getTreatmentIDsByUserID = async (userID) => {
    if (!userID) return [];

    const safeJSONParse = (data) => {
        try {
            return JSON.parse(data);
        } catch {
            return null;
        }
    };

    const result = await db.query(
        `SELECT aiAnalysisResult, scoreInfo
         FROM tbl_face_scan_results
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [userID]
    );

    if (!result?.length) return [];



    const { aiAnalysisResult, scoreInfo } = result[0];
    const { skinConcernMap, mapping } = configs;
    const SCORE_THRESHOLD = 25;

    // STEP 1: SCORE INFO (PRIMARY PRIORITY)
    const parsedScoreInfo = safeJSONParse(scoreInfo);


    if (parsedScoreInfo && mapping && skinConcernMap) {

        const concernIDs = [];

        for (const key in mapping) {
            const value = parseFloat(parsedScoreInfo[key]);


            if (value > SCORE_THRESHOLD) {
                const concernName = mapping[key];
                const concernID = skinConcernMap[concernName];
                if (concernID) concernIDs.push(concernID);
            }
        }

        if (concernIDs.length > 0) {
            const placeholders = concernIDs.map(() => "?").join(",");
            const treatmentsResult = await db.query(
                `SELECT DISTINCT treatment_id
                 FROM tbl_treatment_concerns
                 WHERE concern_id IN (${placeholders})`,
                concernIDs
            );

            if (treatmentsResult?.length > 0) {
                return [...new Set(treatmentsResult.map((r) => r.treatment_id))];
            }
        }
    }

    // STEP 2: AI ANALYSIS RESULT (SECOND PRIORITY)
    const AIAnalysisResult = safeJSONParse(aiAnalysisResult);
    if (!AIAnalysisResult?.skinIssues?.length) return [];

    // STEP 2A: Direct recommended treatments
    const aiTreatmentIDs = [
        ...new Set(
            AIAnalysisResult.skinIssues.flatMap(
                (issue) => issue?.recommendedTreatmentsIds || []
            )
        ),
    ];
    if (aiTreatmentIDs.length > 0) return aiTreatmentIDs;

    // STEP 2B: Fallback using concernId
    const concernIDs = AIAnalysisResult.skinIssues
        .map((issue) => issue?.concernId)
        .filter(Boolean);

    if (concernIDs.length > 0) {
        const placeholders = concernIDs.map(() => "?").join(",");
        const treatmentsResult = await db.query(
            `SELECT DISTINCT treatment_id
             FROM tbl_treatment_concerns
             WHERE concern_id IN (${placeholders})`,
            concernIDs
        );

        if (treatmentsResult?.length > 0) {
            return [...new Set(treatmentsResult.map((r) => r.treatment_id))];
        }
    }

    // STEP 3: Nothing worked
    return [];
};

export const getLatestFaceScanReportIDByUserID = async (userID) => {
    try {

        const result = await db.query(`
            SELECT face_scan_result_id
            FROM tbl_face_scan_results 
            WHERE user_id = ? 
            ORDER BY created_at DESC 
            LIMIT 1
        `, [userID]);

        if (!result?.length) {
            return null;
        }

        return result[0].face_scan_result_id || null;
    } catch (error) {
        console.error("getLatestFaceScanReportIDByUserID error:", error);
        return null;
    }
};


export const extractUserData = (userData) => {
    if (!userData || !userData.role) {
        throw new Error("Invalid user data");
    }

    const role = userData.role;
    const token = userData.fcm_token || null;

    let user_id, full_name;

    switch (role) {
        case 'DOCTOR':
        case 'SOLO_DOCTOR':
            user_id = userData?.doctorData?.doctor_id;
            full_name = userData?.doctorData?.name || "Someone";
            break;

        case 'CLINIC':
            user_id = userData?.clinicData?.clinic_id;
            full_name = userData?.clinicData?.clinic_name || "Someone";
            break;

        case 'USER':
            user_id = userData?.user_id;
            full_name = userData?.full_name || "Someone";
            break;

        case 'ADMIN':
            user_id = userData?.admin_id;
            full_name = userData?.full_name || "Someone";
            break;

        default:
            throw new Error("Unsupported role");
    }

    if (!user_id) {
        throw new Error(`${role} ID not found in userData`);
    }

    return { user_id, role, full_name, token };
};

export const formatBenefitsOnLang = (rows = [], lang = 'en') => {
    return rows.map(row => {
        let localizedBenefits = [];

        try {
            const parsed = typeof row.benefits === 'string' ? JSON.parse(row.benefits) : row.benefits;
            localizedBenefits = Object.values(parsed).map(b => b?.[lang] || '');
        } catch (e) {
            console.error(`Failed to parse benefits for treatment_id: ${row.treatment_id}`, e.message);
        }

        return {
            ...row,
            benefits: localizedBenefits
        };
    });
};

export const formatBenefitsUnified = (rows = [], lang = 'en') => {
    return rows.map(row => {
        if (row.source === 'old' && row.benefits) {
            try {
                const parsed = typeof row.benefits === 'string'
                    ? JSON.parse(row.benefits)
                    : row.benefits;
                return {
                    ...row,
                    benefits: Object.values(parsed).map(b => b?.[lang] || '').filter(Boolean)
                };
            } catch {
                return { ...row, benefits: [] };
            }
        }

        if (row.source === 'new' || row.source === null) {
            const raw = lang === 'sv' ? row.benefits_sv : row.benefits_en;
            if (!raw) return { ...row, benefits: [] };

            // Split on bullets, semicolons, or commas, then clean up
            const benefits = raw
                .split(/•|;|,/)
                .map(s => s.replace(/^\s*[,\.•]+/, '').trim()) // remove leading punctuation
                .filter(Boolean); // remove empty strings

            return { ...row, benefits };
        }

        return { ...row, benefits: [] };
    });
};

export async function translateFAQ(question, answer) {
    const fallback = {
        ques_en: question,
        ans_en: answer,
        ques_sv: null,
        ans_sv: null,
    };

    if (!openai) return fallback;

    const prompt = `
                Translate the following FAQ into both English and Swedish. 
                The input FAQ can be in both english or swedish, 
                You dont have to generate answers, simply translate.

                Return a valid JSON object with:
                {
                "ques_en": "...",
                "ans_en": "...",
                "ques_sv": "...",
                "ans_sv": "..."
                }
                Question: "${question}"
                Answer: "${answer}"
                `;

    try {

        const res = await openai.chat.completions.create(
            {
                model: "gpt-4.1-mini",
                temperature: 0,
                messages: [{ role: "user", content: prompt }],
                response_format: { type: "json_object" },
            }
        );

        const content = res?.choices?.[0]?.message?.content;

        return content ? JSON.parse(content) : fallback;
    } catch (err) {
        console.error("OpenAI translation failed:", err);
        return fallback;
    }
}

export function normalizeCategory(inputCategory) {
    if (!inputCategory) return null;

    const match = configs.faq_categories.find(
        cat => cat.en === inputCategory || cat.sv === inputCategory
    );

    // Always return English (since DB stores English)
    return match ? match.en : null;
}

export async function sendInvitationEmail(user) {
    try {
        if (!user?.email) return;

        const emailTemplate = user?.language === "sv" ? zynqReminderEnglishTemplate : zynqReminderSwedishTemplate

        const recipient_name = user.name || "";
        const roleKey = user.role || "";
        const { subject, body } = emailTemplate({ recipient_name: recipient_name, roleKey: roleKey });

        await sendEmail({
            to: user.email,
            subject: subject,
            html: body,
        });

    } catch (error) {
        console.error(`❌ Failed to send invitation email to ${user.email}:`, error.message);
    }
}

export async function sendInvitationReminders() {
    try {

        const users = await getInvitedZynqUsers();
        if (!users.length) {
            return;
        }

        const nowUTC = new Date();
        const reminderSchedule = [3, 7, 14];

        const toUpdateClinics = [];
        const toUpdateDoctors = [];
        const toImportClinics = [];
        const toImportDoctors = [];

        for (const user of users) {
            if (!user.invited_date) continue;

            const invitedDate = new Date(user.invited_date);
            const diffDays = Math.floor((nowUTC - invitedDate) / (1000 * 60 * 60 * 24));

            const nextReminderDay = reminderSchedule[user.invitation_email_count] ?? null;

            if (!nextReminderDay) {
                // After 14 days → mark imported
                if (diffDays > 14) {
                    if (user.role === "CLINIC") toImportClinics.push(user.id);
                    else toImportDoctors.push(user.id);
                }
                continue;
            }

            // If time for next reminder email
            if (diffDays >= nextReminderDay) {
                await sendInvitationEmail(user);

                if (user.role === "CLINIC") toUpdateClinics.push(user.id);
                else toUpdateDoctors.push(user.id);

            }
        }

        // --- BULK UPDATE: increment invitation_email_count ---
        const bulkUpdate = async (table, idField, ids) => {
            if (!ids.length) {
                return;
            }
            const placeholders = ids.map(() => "?").join(",");
            await db.query(
                `UPDATE ${table}
                 SET invitation_email_count = invitation_email_count + 1
                 WHERE ${idField} IN (${placeholders})`,
                ids
            );
        };

        await Promise.all([
            bulkUpdate("tbl_clinics", "clinic_id", toUpdateClinics),
            bulkUpdate("tbl_doctors", "doctor_id", toUpdateDoctors)
        ]);

        const bulkImport = async (table, idField, ids) => {
            if (!ids.length) {
                return;
            }
            const placeholders = ids.map(() => "?").join(",");
            await db.query(
                `UPDATE ${table}
                 SET profile_status = 'IMPORTED'
                 WHERE ${idField} IN (${placeholders})`,
                ids
            );
        };

        await Promise.all([
            bulkImport("tbl_clinics", "clinic_id", toImportClinics),
            bulkImport("tbl_doctors", "doctor_id", toImportDoctors)
        ]);

    } catch (error) {
        console.error("sendInvitationReminders: error:", error);
    }
}

export async function deleteGuestData() {
    await deleteGuestDataModel()
}

const GOOGLE_TRANSLATE_KEY = process.env.GOOGLE_TRANSLATE_KEY
const TRANSLATION_CACHE = new Map();

function isMostlyAsciiText(value = "") {
    return /^[\x00-\x7F]*$/.test(String(value || ""));
}

// export async function translator(question, targetLang) {
//     try {
//         // return question
//         const url = `https://translation.googleapis.com/language/translate/v2?key=${GOOGLE_TRANSLATE_KEY}`;
//         const body = {
//             q: question,
//             target: targetLang,
//             format: 'text'
//         };

//         const resp = await axios.post(url, body);
//         const translated = resp.data.data.translations[0].translatedText;
//         return translated;
//     } catch (err) {
//         console.error('Translate error:', err.response?.data || err.message);
//         // throw err;
//         return question
//     }
// };

export const getTopSimilarRows = async (rows, search, threshold = 0.4, topN = null) => {
    if (!search?.trim()) return rows;

    const normalized_search = await translator(search, 'en');

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

        const score = cosineSimilarity(queryEmbedding, dbEmbedding);

        if (score >= threshold) {
            const { embeddings, ...rest } = row; // exclude embeddings
            results.push({ ...rest, score });
        }
    }

    // 3️⃣ Sort descending by similarity
    results.sort((a, b) => b.score - a.score);

    // 4️⃣ Return all above threshold or topN if specified
    if (topN && topN > 0) {
        return results.slice(0, topN);
    }
    return results;
};
export const getTopSimilarRowsWithoutTranslate = async (rows, search, threshold = 0.4, topN = null) => {
    if (!search?.trim()) return rows;

    const normalized_search = search;


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

        const score = cosineSimilarity(queryEmbedding, dbEmbedding);

        if (score >= threshold) {
            const { embeddings, ...rest } = row; // exclude embeddings
            results.push({ ...rest, score });
        }
    }

    // 3️⃣ Sort descending by similarity
    results.sort((a, b) => b.score - a.score);

    // 4️⃣ Return all above threshold or topN if specified
    if (topN && topN > 0) {
        return results.slice(0, topN);
    }
    return results;
};

export const paginateRows = (rows, limit, page) => {
    if (!Array.isArray(rows)) return [];

    // If limit or page is not provided, return all rows
    if (limit == null || page == null) return rows;

    const total = rows.length;
    const totalPages = Math.ceil(total / limit);

    // ensure page is within bounds
    const currentPage = Math.min(Math.max(page, 1), totalPages || 1);

    const startIndex = (currentPage - 1) * limit;
    const endIndex = startIndex + limit;

    return rows.slice(startIndex, endIndex);
};

export const rankSimilarRows = async (rows, search, threshold = 0, topN = null) => {
    if (!rows?.length) return [];
    if (!search?.trim()) return rows;

    // 1️⃣ Fetch embedding for search term
    const { data } = await axios.post("http://localhost:11434/api/embeddings", {
        model: "nomic-embed-text",
        prompt: search,
    });
    const queryEmbedding = data.embedding;

    // 2️⃣ Compute similarity scores for all rows
    const scoredResults = rows.map(row => {
        if (!row.embeddings) return { ...row, score: 0 };

        const dbEmbedding = Array.isArray(row.embeddings)
            ? row.embeddings
            : JSON.parse(row.embeddings);

        const score = cosineSimilarity(queryEmbedding, dbEmbedding);
        return { ...row, score };
    });

    // 3️⃣ Sort all rows by descending similarity
    scoredResults.sort((a, b) => b.score - a.score);

    // 4️⃣ Optionally apply threshold or topN
    const filtered = threshold > 0
        ? scoredResults.filter(r => r.score >= threshold)
        : scoredResults;

    return topN && topN > 0 ? filtered.slice(0, topN) : filtered;
};


function containsSafeTerm(text) {
    return containsProtectedTerm(text);
}

export async function translator(question, targetLang = "en") {
    try {
        if (!question || !question.trim()) return question;
        if (containsSafeTerm(question) || (targetLang === "en" && isMostlyAsciiText(question))) {
            return restoreCanonicalBrandTerms(question);
        }

        // 🧩 Step 1: Detect language first
        const detectUrl = `https://translation.googleapis.com/language/translate/v2/detect?key=${GOOGLE_TRANSLATE_KEY}`;
        const detectResp = await axios.post(detectUrl, { q: question }, { timeout: 3000 });
        const detectedLang = detectResp.data?.data?.detections?.[0]?.[0]?.language || "en";

        //   // ✅ Step 2: Skip translation if English or already known term
        //   if (detectedLang === "en" || shouldSkipTranslation(question)) {
        //     console.log("Skipping translation: English or known brand term");
        //     return question;
        //   }

        // 🌍 Step 3: Only translate if it’s Swedish or other non-English
        // ⚠️  DO NOT manually call protectTermsInText/restoreProtectedTerms here.
        //     googleTranslator() already does that internally.
        //     Double-protecting causes tokens like __protected_term_0__ to reach
        //     Google Translate and come back as __skyddad_term_0__ (Swedish for
        //     "protected"), which then leaks into the UI unchanged.
        if (["sv", "da", "no", "de", "fr", "it", "es"].includes(detectedLang)) {
            const translated = await googleTranslator(question, targetLang);
            return translated;
        }

        // Otherwise, return unchanged
        return question;
    } catch (err) {
        const errMsg = err?.code || err?.message || "unknown";
        console.error(`Translate error [${errMsg}]: "${String(question).slice(0, 50)}"`);
        return question;
    }
}

export async function localizeTextValue(value, language = "en") {
    if (value === null || value === undefined) return value;
    const text = typeof value === "string" ? value.trim() : String(value);
    if (!text) return value;

    try {
        const target = String(language || "en").toLowerCase();
        const cacheKey = `${target}:${text}`;
        if (TRANSLATION_CACHE.has(cacheKey)) return TRANSLATION_CACHE.get(cacheKey);
        if (containsSafeTerm(text) || (target === "en" && isMostlyAsciiText(text))) {
            const restored = restoreCanonicalBrandTerms(text);
            TRANSLATION_CACHE.set(cacheKey, restored);
            return restored;
        }

        const translated = target === "sv"
            ? await googleTranslator(text, "sv")
            : await googleTranslator(text, "en");

        const restored = restoreCanonicalBrandTerms(translated);
        TRANSLATION_CACHE.set(cacheKey, restored);
        return restored;
    } catch (error) {
        const errMsg = error?.code || error?.message || "unknown";
        console.error(`localizeTextValue error [${errMsg}]: "${String(value).slice(0, 50)}"`);
        return value;
    }
}

// 🧠 Only skip if text *is exactly or mostly* a brand name, not if it just contains one
function shouldSkipTranslation(text) {
    const lowerText = text.toLowerCase().trim();
    return PROTECTED_TERMS.some(term => {
        const lowerTerm = term.toLowerCase();
        return (
            lowerText === lowerTerm || // exact match
            lowerText.split(/\s+/).includes(lowerTerm) // appears as separate word
        );
    });
}

export const applyLanguageOverwrite = (data, lang = "en") => {
    // recursive function
    const transform = (obj) => {
        if (Array.isArray(obj)) {
            return obj.map(transform);
        }
        // recursive function
        const transform = (obj) => {
            if (Array.isArray(obj)) {
                return obj.map(transform);
            }

            if (obj && typeof obj === "object") {
                const newObj = { ...obj };
                if (obj && typeof obj === "object") {
                    const newObj = { ...obj };

                    for (const key in newObj) {
                        const value = newObj[key];
                        for (const key in newObj) {
                            const value = newObj[key];

                            // Recurse deeper
                            if (typeof value === "object" && value !== null) {
                                newObj[key] = transform(value);
                            }
                        }
                        // Recurse deeper
                        if (typeof value === "object" && value !== null) {
                            newObj[key] = transform(value);
                        }
                    }

                    // Auto-detect language key pairs inside this object
                    // const pairs = findLanguagePairs(newObj);
                    // Auto-detect language key pairs inside this object
                    const pairs = findLanguagePairs(newObj);

                    // Apply overwrite for each pair
                    pairs.forEach(({ keyBase, enKey, svKey }) => {
                        if (lang === "en" && enKey in newObj) {
                            newObj[keyBase] = newObj[enKey];
                        }
                        if (lang === "sv" && svKey in newObj) {
                            newObj[keyBase] = newObj[svKey];
                        }
                    });
                    // Apply overwrite for each pair
                    pairs.forEach(({ keyBase, enKey, svKey }) => {
                        if (lang === "en" && enKey in newObj) {
                            newObj[keyBase] = newObj[enKey];
                        }
                        if (lang === "sv" && svKey in newObj) {
                            newObj[keyBase] = newObj[svKey];
                        }
                    });

                    // Keep protected brand/device names canonical after language overwrite.
                    for (const key in newObj) {
                        if (typeof newObj[key] === "string") {
                            newObj[key] = restoreCanonicalBrandTerms(newObj[key]);
                        }
                    }
                    // Keep protected brand/device names canonical after language overwrite.
                    for (const key in newObj) {
                        if (typeof newObj[key] === "string") {
                            newObj[key] = restoreCanonicalBrandTerms(newObj[key]);
                        }
                    }

                    return newObj;
                }
                return newObj;
            }

            return obj;
        };
        return obj;
    };

    return transform(data);
    return transform(data);
};

// Detect matching language pairs automatically
const findLanguagePairs = (obj) => {
    // const keys = Object.keys(obj);
    // const pairs = [];
    const keys = Object.keys(obj);
    const pairs = [];

    keys.forEach((key) => {
        // Pattern 1: base + _en / _sv
        if (key.endsWith("_en")) {
            const base = key.replace("_en", "");
            const svKey = base + "_sv";
            if (obj.hasOwnProperty(svKey)) {
                pairs.push({ keyBase: base, enKey: key, svKey });
            }
        }
        keys.forEach((key) => {
            // Pattern 1: base + _en / _sv
            if (key.endsWith("_en")) {
                const base = key.replace("_en", "");
                const svKey = base + "_sv";
                if (obj.hasOwnProperty(svKey)) {
                    pairs.push({ keyBase: base, enKey: key, svKey });
                }
            }

            // Pattern 2: english / swedish
            if (key.toLowerCase() === "english") {
                if (obj.hasOwnProperty("swedish")) {
                    pairs.push({
                        keyBase: "name", // output field name
                        enKey: key,
                        svKey: "swedish",
                    });
                }
            }
            // Pattern 2: english / swedish
            if (key.toLowerCase() === "english") {
                if (obj.hasOwnProperty("swedish")) {
                    pairs.push({
                        keyBase: "name", // output field name
                        enKey: key,
                        svKey: "swedish",
                    });
                }
            }

            // Pattern 3: name + swedish
            if (key === "name" && obj.hasOwnProperty("swedish")) {
                pairs.push({
                    keyBase: "name",
                    enKey: "name",
                    svKey: "swedish",
                });
            }
            // Pattern 3: name + swedish
            if (key === "name" && obj.hasOwnProperty("swedish")) {
                pairs.push({
                    keyBase: "name",
                    enKey: "name",
                    svKey: "swedish",
                });
            }

            // Pattern 4: description_en / desc_sv
            if (key.endsWith("_en")) {
                const svKey = key.replace("_en", "_sv");
                if (obj.hasOwnProperty(svKey)) {
                    const base = key.replace("_en", "");
                    pairs.push({ keyBase: base, enKey: key, svKey });
                }
            }
        });
        // Pattern 4: description_en / desc_sv
        if (key.endsWith("_en")) {
            const svKey = key.replace("_en", "_sv");
            if (obj.hasOwnProperty(svKey)) {
                const base = key.replace("_en", "");
                pairs.push({ keyBase: base, enKey: key, svKey });
            }
        }
    });

    return pairs;
    return pairs;
};


const translateUrl = `https://translation.googleapis.com/language/translate/v2?key=${GOOGLE_TRANSLATE_KEY}`;

export const translateText = async (text, target = 'sv') => {
    if (!text) return text;

    const response = await fetch(translateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            q: text,
            target: target,
        }),
    });

    const data = await response.json();
    return data?.data?.translations?.[0]?.translatedText || text;
};
