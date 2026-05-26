
import { gemini, openai } from "../../../app.js";
import configs from "../../config/config.js";
import { addConsentModel, getLegalDocumentsForUsers, updateLegalDocumentsService } from "../../models/api.js";
import { asyncHandler, handleError, handleSuccess, } from "../../utils/responseHandler.js";
import { isEmpty } from "../../utils/user_helper.js";
import axios from "axios";

export const getLegalDocuments = asyncHandler(async (req, res) => {
  const { language = "en", role } = req.user;
  const legalDocuments = await getLegalDocumentsForUsers(role, language);
  if (isEmpty(legalDocuments)) return handleError(res, 404, "en", "DOCUMENTS_NOT_FOUND");
  return handleSuccess(res, 200, 'en', "DOCUMENTS_FETCHED_SUCCESSFULLY", legalDocuments);
});

export const updateLegalDocuments = asyncHandler(async (req, res) => {
  const { TERMS_CONDITIONS, PRIVACY_POLICY, TERMS_CONDITIONS_SV, PRIVACY_POLICY_SV } = req.body;
  const result = await updateLegalDocumentsService({ TERMS_CONDITIONS, PRIVACY_POLICY, TERMS_CONDITIONS_SV, PRIVACY_POLICY_SV });
  if (!result || result.affectedRows === 0) return handleError(res, 404, "en", "DOCUMENTS_NOT_FOUND");
  return handleSuccess(res, 200, 'en', "DOCUMENTS_UPDATED_SUCCESSFULLY");
});

function sanitizeMessageContent(content) {
  if (typeof content !== "string") return "";
  return content
    .replace(/\n{3,}/g, '\n\n')   // collapse 3+ newlines into 2
    .replace(/[ \t]+/g, ' ')      // collapse tabs/spaces
    .trim();
}

export const openAIBackendEndpoint = asyncHandler(async (req, res) => {
  try {
    const { payload } = req.body;

    // Ensure payload is JSON
    let parsedPayload;
    if (typeof payload === "string") {
      try {
        parsedPayload = JSON.parse(payload);
      } catch (err) {
        return handleError(res, 400, "en", "INVALID_PAYLOAD", { error: "Payload must be valid JSON string" });
      }
    } else if (typeof payload === "object") {
      parsedPayload = payload;
    } else {
      return handleError(res, 400, "en", "INVALID_PAYLOAD", { error: "Payload must be an object or JSON string" });
    }

    // --- Retry Logic (1 extra attempt) ---
    let attempt = 0;
    let openAIResponse;
    const maxAttempts = 2;

    while (attempt < maxAttempts) {
      try {
        openAIResponse = await axios.post(
          "https://api.openai.com/v1/chat/completions",
          parsedPayload,
          {
            headers: {
              "Content-Type": "application/json",
              "Authorization": `bearer ${configs.openaiKey}`,
            },
          }
        );
        break; // success → exit retry loop
      } catch (error) {
        attempt++;
        if (attempt >= maxAttempts) throw error; // retry only once
        console.warn(`OpenAI request failed (attempt ${attempt}). Retrying...`);
        await new Promise((r) => setTimeout(r, 500)); // small delay
      }
    }

    return handleSuccess(res, openAIResponse.status, "en", "OPENAI_RESPONSE", openAIResponse.data);

  } catch (error) {
    // Axios-specific error handling
    if (error.response) {
      return handleError(
        res,
        error.response.status,
        "en",
        error.response.data.error.message,
      );
    } else if (error.request) {
      return handleError(res, 502, "en", "OPENAI_NO_RESPONSE", { error: "No response from OpenAI" });
    } else {
      return handleError(res, 500, "en", "OPENAI_PROXY_ERROR", { error: error.message });
    }
  }
});

export const openAIBackendEndpointV2 = asyncHandler(async (req, res) => {
  try {
    console.log("API RAN");

    const { payload } = req.body;

    // Ensure payload is JSON
    let parsedPayload;
    if (typeof payload === "string") {
      try {
        parsedPayload = JSON.parse(payload);
      } catch (err) {
        return handleError(res, 400, "en", "INVALID_PAYLOAD", { error: "Payload must be valid JSON string" });
      }
    } else if (typeof payload === "object") {
      parsedPayload = payload;
    } else {
      return handleError(res, 400, "en", "INVALID_PAYLOAD", { error: "Payload must be an object or JSON string" });
    }


    // Call OpenAI
    const openAIResponse = await openai.responses.create({
      model: parsedPayload.model,
      input: parsedPayload.messages
    });

    return handleSuccess(res, 200, "en", "OPENAI_RESPONSE", openAIResponse);

  } catch (error) {
    if (error.response) {
      return handleError(
        res,
        error.response.status,
        "en",
        "OPENAI_ERROR",
        { error }
      );
    } else if (error.request) {
      return handleError(res, 502, "en", "OPENAI_NO_RESPONSE", { error: "No response from OpenAI" });
    } else {
      console.log(error);
      return handleError(res, 500, "en", "OPENAI_PROXY_ERROR", { error: error.message });
    }
  }
});

export const geminiBackendEndpoint = asyncHandler(async (req, res) => {
  try {
    console.log("⚡ Gemini API triggered");

    const { payload } = req.body;
    if (!payload) {
      return handleError(res, 400, "en", "MISSING_PAYLOAD");
    }

    // ✅ Parse payload safely
    let parsedPayload;
    if (typeof payload === "string") {
      try {
        parsedPayload = JSON.parse(payload);
      } catch {
        return handleError(res, 400, "en", "INVALID_PAYLOAD");
      }
    } else if (typeof payload === "object") parsedPayload = payload;
    else {
      return handleError(res, 400, "en", "INVALID_PAYLOAD");
    }

    const { model, messages = [], temperature = 0.7, top_p = 0.9 } = parsedPayload;
    if (!model) return handleError(res, 400, "en", "MISSING_MODEL");

    // ✅ Build prompt
    let prompt = "";
    if (Array.isArray(messages) && messages.length > 0) {
      prompt = messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n");
    } else if (parsedPayload.prompt) {
      prompt = parsedPayload.prompt;
    } else {
      return handleError(res, 400, "en", "MISSING_PROMPT");
    }

    // ✅ Gemini API Call
    const response = await gemini.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      // generationConfig: { temperature, topP: top_p },
    });

    const responseText = response?.candidates[0].content;

    if (!responseText) return handleError(res, 500, "en", "EMPTY_RESPONSE");

    return handleSuccess(res, 200, "en", "GEMINI_RESPONSE", responseText);

  } catch (error) {
    // ✅ Specific Gemini API error
    if (error.name === "ApiError") {
      let parsedError;
      try {
        parsedError = JSON.parse(error.message || "{}")?.error || {};
      } catch {
        parsedError = { message: error.message };
      }

      console.error(`❌ Gemini API Error [${parsedError.code}]: ${parsedError.message}`);

      // 🔹 Use handleSuccess to still return a structured JSON with details
      return handleSuccess(res, error.status || 500, "en", "GEMINI_API_ERROR", {
        success: false,
        type: "GEMINI_API_ERROR",
        code: parsedError.code || "UNKNOWN",
        status: parsedError.status || error.status || 500,
        message: parsedError.message || "Gemini API returned an unknown error",
        details: parsedError.details || null,
      });
    }

    // ✅ Fallback generic error
    console.error("❌ Unexpected Gemini Error:", error.message);
    return handleSuccess(res, 500, "en", "GEMINI_UNHANDLED_ERROR", {
      success: false,
      type: "GEMINI_UNHANDLED_ERROR",
      message: error.message || "Unexpected error occurred",
    });
  }
});

export const addConsent = asyncHandler(async (req, res) => {
  const { device_id } = req.body;
  const user_id = req?.user?.user_id ?? null;

  if (!user_id && isEmpty(device_id)) {
    return handleError(res, 400, "en", "DEVICE_OR_USER_REQUIRED");
  }

  await addConsentModel({
    user_id,
    device_id: user_id ? null : device_id
  });

  return handleSuccess(res, 200, "en", "CONSENT_ADDED_SUCCESSFULLY");
});

export const generateAIResponse = async ({
  prompt,
  base64Image,
  model = "gpt-4.1-mini",
  expectJson = true,
}) => {
  try {
    const input = [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...(base64Image
            ? [{ type: "image", image_url: `data:image/jpeg;base64,${base64Image}` }]
            : []),
        ],
      },
    ];

    const response = await openai.responses.create({
      model,
      input,
      response_format: expectJson ? { type: "json_object" } : undefined,
    });

    const outputText = response.output[0]?.content?.[0]?.text || "";

    if (expectJson) {
      try {
        return JSON.parse(outputText);
      } catch {
        console.warn("⚠️ Failed to parse JSON output from model.");
        return { raw_output: outputText };
      }
    }

    return outputText;
  } catch (error) {
    console.error("❌ OpenAI call failed:", error);
    throw new Error("AI request failed: " + (error.message || "Unknown error"));
  }
};