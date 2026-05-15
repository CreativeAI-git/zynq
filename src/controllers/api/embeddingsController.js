import dotenv from "dotenv";

import * as apiModels from "../../models/api.js";
import { asyncHandler, handleError, handleSuccess } from "../../utils/responseHandler.js";
import { queryTreatments } from "../../utils/vectorIndex.js";
import dbOperations from '../../models/common.js';
import { cosineSimilarity } from "../../utils/user_helper.js";
dotenv.config();
import axios from 'axios';
const APP_URL = process.env.APP_URL;
import { v4 as uuidv4 } from 'uuid';
import { translator } from "../../utils/misc.util.js";

function cleanTreatmentName(name = "") {
  return name
    .replace(/[()]/g, " ")           // remove brackets
    .replace(/\btreatment\b/gi, " ") // remove the word "treatment"
    .replace(/\s+/g, " ")            // compress spaces
    .trim();
}
export const generateTreatmentEmbeddings = async (req, res) => {
  try {

    const rows = await apiModels.getTreatmentEmbeddingsText();

    if (!rows || rows.length === 0) {
      return handleError(res, 404, 'en', "No Data found");
    }


    for (const row of rows) {
      const combinedText = row.embedding_text;

      if (!combinedText || !combinedText.trim()) continue;

      try {
        const response = await axios.post("http://localhost:11434/api/embeddings", {
          model: "nomic-embed-text",
          prompt: combinedText
        });

        const vector = response.data.embedding;
        const vectorJson = JSON.stringify(vector);


        await dbOperations.updateData(
          "tbl_treatments",
          { embeddings: vectorJson },
          `WHERE treatment_id = '${row.treatment_id}'`
        );

        console.log(`✅ Embedding updated for Treatment ID: ${row.treatment_id}`);
      } catch (embedErr) {
        console.error(`❌ Error generating embedding for ID ${row.treatment_id}:`, embedErr.message);
      }
    }

    return handleSuccess(res, 200, "en", "All Treatment embeddings updated successfully");
  } catch (err) {
    console.error("Error generating embeddings:", err);
    return handleError(res, 500, "en", "Internal Server Error");
  }
};

export const generateProductsEmbedding = async (req, res) => {
  try {
    const rows = await dbOperations.getProductsWithTreatments()

    if (!rows || rows.length === 0) {
      return handleError(res, 404, "en", "No data found");
    }

    for (const row of rows) {

      const combinedText = row.embedding_text;

      if (!combinedText.trim()) continue;

      try {
        const response = await axios.post("http://localhost:11434/api/embeddings", {
          model: "nomic-embed-text",
          prompt: combinedText
        });

        const vector = response.data.embedding;
        const vectorJson = JSON.stringify(vector);

        await dbOperations.updateData(
          "tbl_products",
          { embeddings: vectorJson },
          `WHERE product_id = '${row.product_id}'`
        );

        console.log(` Embedding updated for product ID: ${row.product_id}`);
      } catch (embedErr) {
        console.error(`Error generating embedding for ID ${row.product_id}:`, embedErr.message);
      }
    }

    return handleSuccess(res, 200, "en", "All product embeddings updated successfully");
  } catch (err) {
    console.error("Error generating embeddings:", err);
    return handleError(res, 500, "en", "Internal Server Error");
  }
};

export const generateDoctorsEmbedding = async (req, res) => {
  try {
    const rows = await apiModels.getDoctorEmbeddingTextAllV2();

    if (!rows || rows.length === 0) {
      return handleError(res, 404, "en", "No data found");
    }

    for (const row of rows) {
      // 🛑 Skip if doctor_name is null
      if (!row.doctor_name || !row.doctor_name.trim()) {
        console.log(`⏭️ Skipped doctor with ID ${row.doctor_id} (no name)`);
        continue;
      }

      // 🧠 Combine available non-null fields into a natural language text
      const fields = [];

      fields.push(`Doctor Name: ${row.doctor_name}`);

      if (row.educations)
        fields.push(`Education: ${row.educations}`);

      if (row.treatments)
        fields.push(`Treatments offered: ${row.treatments}`);

      if (row.concerns)
        fields.push(`Specializes in treating: ${row.concerns}`);

      if (row.skin_types)
        fields.push(`Experienced with skin types or areas like: ${row.skin_types}`);

      const combinedText = fields.join(". ") + "."; // Natural readable text

      // 🛑 Skip empty text
      if (!combinedText.trim()) continue;

      try {
        // 🔍 Generate embedding vector from Ollama or embedding API
        const response = await axios.post("http://localhost:11434/api/embeddings", {
          model: "nomic-embed-text",
          prompt: combinedText,
        });

        const vector = response.data.embedding;
        const vectorJson = JSON.stringify(vector);

        // 💾 Save to DB
        await dbOperations.updateData(
          "tbl_doctors",
          { embeddings: vectorJson },
          `WHERE doctor_id = '${row.doctor_id}'`
        );

        console.log(`✅ Embedding updated for doctor ID: ${row.doctor_id}`);
      } catch (embedErr) {
        console.error(`❌ Error generating embedding for ID ${row.doctor_id}:`, embedErr.message);
      }
    }

    return handleSuccess(res, 200, "en", "All doctor embeddings updated successfully");
  } catch (err) {
    console.error("Error generating embeddings:", err);
    return handleError(res, 500, "en", "Internal Server Error");
  }
};


export const generateClinicEmbedding = async (req, res) => {
  try {
    // Fetch clinics with treatments
    const rows = await apiModels.getClinicEmbeddingTextByAllV2();

    if (!rows || rows.length === 0) {
      return handleError(res, 404, 'en', "No Data found");
    }

    for (const row of rows) {
          // 🛑 Skip if doctor_name is null
          if (!row.clinic_name || !row.clinic_name.trim()) {
            console.log(`⏭️ Skipped clinic with ID ${row.clinic_id} (no name)`);
            continue;
          }
    
          // 🧠 Combine available non-null fields into a natural language text
          const fields = [];
    
          fields.push(`Clinic Name: ${row.clinic_name}`);
    
          if (row.address)
            fields.push(`Address: ${row.address}`);
    
          const combinedText = fields.join(". ") + "."; // Natural readable text
    
          // 🛑 Skip empty text
          if (!combinedText.trim()) continue;

          console.log(combinedText);

      try {
        // Generate embedding from Ollama
        const response = await axios.post("http://localhost:11434/api/embeddings", {
          model: "nomic-embed-text",
          prompt: combinedText.trim(),
        });

        const vector = response.data.embedding;

        if (!Array.isArray(vector) || !vector.length) {
          console.warn(`⚠️ Empty embedding for clinic ID ${row.clinic_id}`);
          continue;
        }


        await dbOperations.updateData(
          "tbl_clinics",
          { embeddings: JSON.stringify(vector) },
          `WHERE clinic_id = '${row.clinic_id}'`
        );

        console.log(`✅ Embedding updated for clinic ID: ${row.clinic_id}`);
      } catch (embedErr) {
        console.error(`❌ Error generating embedding for ID ${row.clinic_id}:`, embedErr.message);
      }
    }

    return handleSuccess(res, 200, "en", "All clinic embeddings updated successfully");
  } catch (err) {
    console.error("Error generating embeddings:", err);
    return handleError(res, 500, "en", "Internal Server Error");
  }
};


export const generateTreatmentEmbeddings2 = async (req, res) => {
  try {
    const rows = await dbOperations.getData('tbl_treatments', `where approval_status = 'APPROVED'`);

    if (!rows || rows.length === 0) {
      return handleError(res, 404, 'en', "No Data found");
    }

    for (const row of rows) {

      // -------------------------------------------------------
      // 1️⃣ Combined full-text block
      // -------------------------------------------------------
      const combinedText = `
        ${row.name || ''} is a treatment designed to address ${row.concern_en || 'various skin indications'}.
        ${row.description_en || 'This treatment helps rejuvenate and enhance the skin.'}
        It commonly uses devices like ${row.device_name || 'advanced medical-grade technology'}.
      `.trim();

      if (!combinedText) continue;

      try {
        // -------------------------------------------------------
        // 🧠 Embedding 1: Full text
        // -------------------------------------------------------
        const fullEmbedRes = await axios.post(
          "http://localhost:11434/api/embeddings",
          {
            model: "nomic-embed-text",
            prompt: combinedText
          }
        );

        const fullVectorJson = JSON.stringify(fullEmbedRes.data.embedding);


        // -------------------------------------------------------
        // 🧠 Embedding 2: Name only
        // -------------------------------------------------------
        const cleanName = cleanTreatmentName(row.name || "");

        let nameVectorJson = null;
        
        if (cleanName.length > 0) {
          const nameEmbedRes = await axios.post(
            "http://localhost:11434/api/embeddings",
            {
              model: "nomic-embed-text",
              prompt: cleanName
            }
          );
        
          nameVectorJson = JSON.stringify(nameEmbedRes.data.embedding);
        }

        console.log(`Embedding created → name: ${cleanName}, hasNameEmbed: ${!!nameVectorJson}`);

        // -------------------------------------------------------
        // 💾 Save both embeddings
        // -------------------------------------------------------
        await dbOperations.updateData(
          "tbl_treatments",
          {
            embeddings: fullVectorJson,
            name_embeddings: nameVectorJson
          },
          `WHERE treatment_id = '${row.treatment_id}'`
        );

        console.log(`✅ Updated embeddings for Treatment ID: ${row.treatment_id}`);

      } catch (embedErr) {
        console.error(`❌ Error generating embedding for ID ${row.treatment_id}:`, embedErr.message);
      }
    }

    return handleSuccess(res, 200, "en", "All Treatment embeddings updated successfully");
  } catch (err) {
    console.error("Error generating embeddings:", err);
    return handleError(res, 500, "en", "Internal Server Error");
  }
};

export const generateTreatmentEmbeddingsV2 = async (id) => {
  try {
    const rows = await dbOperations.getData(
      "tbl_treatments",
      `WHERE treatment_id = '${id}' AND approval_status = 'APPROVED'`
    );

    if (!rows || rows.length === 0) {
      return console.log("❌ No data found");
    }

    for (const row of rows) {
      // -------------------------------------------------------
      // 🧹 CLEANUP HELPER (for name only)
      // -------------------------------------------------------
      const clean = (txt = "") => {
        return txt
          .replace(/\(.*?\)/g, " ")        // remove text inside ()
          .replace(/\btreatment\b/gi, " ") // remove the word "treatment"
          .replace(/[^a-zA-Z0-9\s]/g, " ") // remove non-letters
          .replace(/\s+/g, " ")            // collapse spaces
          .trim();
      };

      // -------------------------------------------------------
      // 🧠 FULL combined text (your original)
      // -------------------------------------------------------
      const combinedText = `
${row.name || ''} is a treatment designed to address ${row.concern_en || 'various skin indications'}.
${row.description_en || 'This treatment helps rejuvenate and enhance the skin.'}
It commonly uses devices like ${row.device_name || 'advanced medical-grade technology'}.
      `;

      // -------------------------------------------------------
      // 🧠 NAME-only (cleaned)
      // -------------------------------------------------------
      const cleanName = clean(row.name || "");

      try {
        // -------------------------------------------------------
        // 🔵 Embedding 1: Full semantic text
        // -------------------------------------------------------
        const fullEmbedRes = await axios.post(
          "http://localhost:11434/api/embeddings",
          {
            model: "nomic-embed-text",
            prompt: combinedText,
          }
        );

        const fullVectorJson = JSON.stringify(fullEmbedRes.data.embedding);

        // -------------------------------------------------------
        // 🔵 Embedding 2: Name-only cleaned
        // -------------------------------------------------------
        let nameVectorJson = null;
        if (cleanName.length > 0) {
          const nameEmbedRes = await axios.post(
            "http://localhost:11434/api/embeddings",
            {
              model: "nomic-embed-text",
              prompt: cleanName,
            }
          );

          nameVectorJson = JSON.stringify(nameEmbedRes.data.embedding);
        }

        // -------------------------------------------------------
        // 🟢 Update DB with both embeddings
        // -------------------------------------------------------
        await dbOperations.updateData(
          "tbl_treatments",
          {
            embeddings: fullVectorJson,
            name_embeddings: nameVectorJson,
          },
          `WHERE treatment_id = '${row.treatment_id}'`
        );

        console.log(`✅ Embeddings updated for treatment: ${row.name}`);

      } catch (embedErr) {
        console.error(`❌ Embedding error for ${row.name}:`, embedErr.message);
      }
    }
    console.log("✅ All embeddings updated successfully");
  } catch (err) {
    console.error("❌ Server error in embedding generator:", err);
  }
};




export const getTreatmentsSuggestions = async (req, res) => {
  try {
    const { keyword } = req.body;
    if (!keyword) return handleError(res, 400, "Keyword is required");

    // 🔹 Step 1: Normalize and embed the search keyword
    const normalized_search = await translator(keyword, "en");
    console.log("Normalized:", normalized_search);

    const embedRes = await axios.post("http://localhost:11434/api/embeddings", {
      model: "nomic-embed-text",
      prompt: normalized_search,
    });
    const queryEmbedding = embedRes.data.embedding;

    // 🔹 Step 2: Fetch all treatments with embeddings
    const rows = await dbOperations.getData(
      "tbl_treatments",
      "WHERE embeddings IS NOT NULL"
    );
    if (!rows?.length) return handleError(res, 404, "No treatments found");

    // 🔹 Step 3: Compute cosine similarity + hybrid keyword boosting
    const results = [];

    for (const item of rows) {
      if (!item.embeddings) continue;

      const dbEmbedding = Array.isArray(item.embeddings)
        ? item.embeddings
        : JSON.parse(item.embeddings);

      // 🧠 Combined text for keyword relevance (used for boost)
      const combinedText = `
        Treatment Name: ${item.name || ""}
        Benefits: ${item.benefits_en || ""}
        Description: ${item.description_en || ""}
        Concern: ${item.concern_en || ""}
        Devices Used: ${item.device_name || ""}
      `.toLowerCase();

      const score = cosineSimilarity(queryEmbedding, dbEmbedding);

      // 🔹 Keyword match boosting (adds small score if keyword found)
      const keywordBoost =
        combinedText.includes(normalized_search.toLowerCase()) ? 0.15 : 0;

      const hybridScore = score + keywordBoost;

      if (hybridScore >= 0.35) {
        const { embeddings, ...rest } = item;
        results.push({ ...rest, score: hybridScore });
      }
    }

    // 🔹 Step 4: Sort and limit results
    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, 20);

    return res.json({ success: true, suggestions: top });
  } catch (err) {
    console.error("❌ Error generating treatment suggestions:", err);
    return handleError(res, 500, "EMBEDDINGS ERROR");
  }
};


export const getProductSuggestions = async (req, res) => {
  try {
    const { keyword } = req.body;
    if (!keyword) return handleError(res, 400, "Keyword is required");


    const response = await axios.post("http://localhost:11434/api/embeddings", {
      model: "nomic-embed-text",
      prompt: keyword,
    });
    const qEmbedding = response.data.embedding;


    const rows = await dbOperations.getData(
      "tbl_products",
      "WHERE embeddings IS NOT NULL"
    );
    if (!rows?.length) return handleError(res, 404, "No Products found");


    const results = [];
    for (const item of rows) {
      const dbEmbedding = Array.isArray(item.embeddings)
        ? item.embeddings
        : JSON.parse(item.embeddings);

      const score = cosineSimilarity(qEmbedding, dbEmbedding);
      if (score >= 0.4) {
        // Exclude embeddings from the result
        const { embeddings, ...rest } = item;
        results.push({ ...rest, score });
      }
    }


    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, 20);

    return res.json({ success: true, suggestions: top });

  } catch (err) {
    console.error("❌ Error generating suggestions:", err);
    return handleError(res, 500, "EMBEDDINGS ERROR");
  }
};
export const getDoctorSuggestions = async (req, res) => {
  try {
    const { keyword } = req.body;
    if (!keyword) return handleError(res, 400, "Keyword is required");


    const response = await axios.post("http://localhost:11434/api/embeddings", {
      model: "nomic-embed-text",
      prompt: keyword,
    });
    const qEmbedding = response.data.embedding;


    const rows = await dbOperations.getData(
      "tbl_doctors",
      "WHERE embeddings IS NOT NULL"
    );
    if (!rows?.length) return handleError(res, 404, "No doctors found");


    const results = [];
    for (const item of rows) {
      const dbEmbedding = Array.isArray(item.embeddings)
        ? item.embeddings
        : JSON.parse(item.embeddings); // parse if stored as JSON string

      const score = cosineSimilarity(qEmbedding, dbEmbedding);
      if (score >= 0.45) {
        // Exclude embeddings from the result
        const { embeddings, ...rest } = item;
        results.push({ ...rest, score });
      }
    }


    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, 20);

    return res.json({ success: true, suggestions: top });

  } catch (err) {
    console.error("❌ Error generating suggestions:", err);
    return handleError(res, 500, "EMBEDDINGS ERROR");
  }
};
export const getClinicSuggestions = async (req, res) => {
  try {
    const { keyword } = req.body;
    if (!keyword) return handleError(res, 400, "Keyword is required");


    const response = await axios.post("http://localhost:11434/api/embeddings", {
      model: "nomic-embed-text",
      prompt: keyword,
    });
    const qEmbedding = response.data.embedding;


    const rows = await dbOperations.getData(
      "tbl_clinics",
      "WHERE embeddings IS NOT NULL"
    );

    if (!rows?.length) return handleError(res, 404, "No doctors found");


    const results = [];
    for (const item of rows) {
      const dbEmbedding = Array.isArray(item.embeddings)
        ? item.embeddings
        : JSON.parse(item.embeddings); // parse if stored as JSON string

      const score = cosineSimilarity(qEmbedding, dbEmbedding);
      if (score >= 0.42) {
        // Exclude embeddings from the result
        const { embeddings, ...rest } = item;
        results.push({ name: item.clinic_name, ...rest, score });
      }
    }


    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, 20);

    return res.json({ success: true, suggestions: top });

  } catch (err) {
    console.error("❌ Error generating suggestions:", err);
    return handleError(res, 500, "EMBEDDINGS ERROR");
  }
};

export const generateEmbeddingsForRows = async (rows, tableName, idField) => {
  for (const row of rows) {
    const combinedText = row.embedding_text;

    if (!combinedText || !combinedText.trim()) continue;

    try {
      const response = await axios.post("http://localhost:11434/api/embeddings", {
        model: "nomic-embed-text",
        prompt: combinedText.trim(),
      });

      const vector = response.data.embedding;
      if (!Array.isArray(vector) || !vector.length) continue;

      await dbOperations.updateData(
        tableName,
        { embeddings: JSON.stringify(vector) },
        `WHERE ${idField} = '${row[idField]}'`
      );

      console.log(`✅ Embedding updated for ${tableName} ID: ${row[idField]}`);
    } catch (err) {
      console.error(`❌ Error generating embedding for ID ${row[idField]}:`, err.message);
    }
  }
};



export const generateProductsEmbeddingsV2 = async (id) => {
  try {
    const rows = await apiModels.getProductWithTreatmentsById(id);
    if (!rows || !rows.length) return handleError(res, 404, "en", "No Data found");

    await generateEmbeddingsForRows(rows, "tbl_products", "product_id");
    // return handleSuccess(res, 200, "en", "All product embeddings updated successfully");
  } catch (err) {
    console.error("Error generating embeddings:", err);
    // return handleError(res, 500, "en", "Internal Server Error");
  }
};

export const generateDoctorsEmbeddingsV2 = async (id) => {
  try {

    const rows = await apiModels.getDoctorEmbeddingTextByIdV2(id);
    if (!rows || !rows.length) return handleError('', 404, "en", "No Data found");

    await generateDoctorsEmbeddingByIdV2(rows);
    // return handleSuccess(res, 200, "en", "All doctor embeddings updated successfully");
  } catch (err) {
    console.error("Error generating embeddings:", err);
    // return handleError(res, 500, "en", "Internal Server Error");
  }
};

export const generateClinicsEmbeddingsV2 = async (id) => {
  try {
    // const rows = await apiModels.getClinicEmbeddingTextById(id);
    // if (!rows || !rows.length) return handleError('', 404, 'en', "No Data found");

    // await generateEmbeddingsForRows(rows, "tbl_clinics", "clinic_id");
    // return handleSuccess(res, 200, "en", "All clinic embeddings updated successfully");
    return null;
  } catch (err) {
    console.error("Error generating embeddings:", err);
    // return handleError(res, 500, "en", "Internal Server Error");
  }
};


export const generateTreatmentDevices = async (req, res) => {
  try {
    // 1️⃣ Fetch all treatments from tbl_treatments
    const treatments = await dbOperations.getData("tbl_treatments", "");

    if (!treatments || treatments.length === 0) {
      return res.status(404).json({ success: false, message: "No treatments found" });
    }

    let insertedCount = 0;
    let skippedCount = 0;

    // 2️⃣ Loop through each treatment
    for (const treatment of treatments) {
      const { treatment_id, device_name } = treatment;

      if (!device_name) continue; // skip if no device listed

      // Split comma-separated devices & clean up whitespace
      const devices = device_name
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean);

      // 3️⃣ Loop through devices
      for (const device of devices) {
        // 🔍 Check if this device already exists for this treatment
        const existingDevice = await dbOperations.getSelectedColumn(
          "id",
          "tbl_treatment_devices",
          `WHERE treatment_id = '${treatment_id}' AND device_name = '${device}' LIMIT 1`
        );

        if (existingDevice && existingDevice.length > 0) {
          skippedCount++;
          continue;
        }
  
        // 4️⃣ Insert if not already present
        const deviceData = {
          id: uuidv4(),
          treatment_id,
          device_name: device,
        };

        await dbOperations.insertData("tbl_treatment_devices", deviceData);
        insertedCount++;
      }
    }

    // 5️⃣ Return summary
    return res.status(200).json({
      success: true,
      message: "Devices mapped successfully to treatments",
      inserted: insertedCount,
      skipped: skippedCount,
    });

  } catch (err) {
    console.error("❌ Error generating treatment devices:", err);
    return handleError(res, 500, "DEVICE GENERATION ERROR");
  }
};


export const generateDoctorsEmbeddingByIdV2 = async (rows) => {
  try {
    for (const row of rows) {
      // 🛑 Skip if doctor_name is null
      if (!row.doctor_name || !row.doctor_name.trim()) {
        console.log(`⏭️ Skipped doctor with ID ${row.doctor_id} (no name)`);
        continue;
      }

      // 🧠 Combine available non-null fields into a natural language text
      const fields = [];

      fields.push(`Doctor Name: ${row.doctor_name}`);

      if (row.educations)
        fields.push(`Education: ${row.educations}`);

      if (row.treatments)
        fields.push(`Treatments offered: ${row.treatments}`);

      if (row.concerns)
        fields.push(`Specializes in treating: ${row.concerns}`);

      if (row.skin_types)
        fields.push(`Experienced with skin types or areas like: ${row.skin_types}`);

      const combinedText = fields.join(". ") + "."; // Natural readable text

      // 🛑 Skip empty text
      if (!combinedText.trim()) continue;

      try {
        // 🔍 Generate embedding vector from Ollama or embedding API
        const response = await axios.post("http://localhost:11434/api/embeddings", {
          model: "nomic-embed-text",
          prompt: combinedText,
        });

        const vector = response.data.embedding;
        const vectorJson = JSON.stringify(vector);

        // 💾 Save to DB
        await dbOperations.updateData(
          "tbl_doctors",
          { embeddings: vectorJson },
          `WHERE doctor_id = '${row.doctor_id}'`
        );

        console.log(`✅ Embedding updated for doctor ID: ${row.doctor_id}`);
      } catch (embedErr) {
        console.error(`❌ Error generating embedding for ID ${row.doctor_id}:`, embedErr.message);
      }
    }

  } catch (err) {
    console.error("Error generating embeddings:", err);
  }
};

