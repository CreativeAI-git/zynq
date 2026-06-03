async function detectSearchIntent(searchQuery) {
    console.log("🔍 Raw search query:", searchQuery);

    const trimmed = (searchQuery || "").trim().toLowerCase();

    // ✅ Special handling for "dr" or similar inputs
    if (["dr", "dr.", "doctor", "daktar"].includes(trimmed)) {
        console.log("⚙️ Detected doctor keyword — prioritizing Doctor ranking");
        return {
            type: "valid_medical",
            ranking: ["Doctor", "Clinic", "Treatment", "Sub Treatment", "Devices",]
        };
    }

    // ✅ Special handling for queries implying expert → prioritize doctors
    if (["expert", "skin expert", "hair expert", "face expert", "derma expert"].includes(trimmed)) {
        console.log("⚙️ Detected expert keyword — prioritizing Doctor ranking");
        return {
            type: "valid_medical",
            ranking: ["Doctor", "Clinic", "Treatment", "Sub Treatment", "Devices"]
        };
    }


    // 🛑 Short queries fallback
    if (trimmed.length <= 3) {
        console.log("⚙️ Skipping AI — short query, returning default valid_medical");
        return {
            type: "valid_medical",
            ranking: ["Treatment", "Sub Treatment", "Doctor", "Clinic", "Devices"]
        };
    }

    const prompt = `
    You are an intelligent and context-aware AI assistant that classifies user search queries for a medical platform.
    
    Your goal is to analyze the query and always output a pure JSON object with exactly these two fields:
    {
      "type": "valid_medical" | "non_medical",
      "ranking": ["Doctor","Clinic","Treatment","Sub Treatment","Devices"] (in the most contextually correct order)
    }
    
    ---
    
    ### RULES & LOGIC
    
    #### 1️⃣ General behavior
    - Always return a valid JSON object — no markdown or explanations.
    - Case-insensitive and tolerant of spelling errors (“wrinckle”, “daktar”, etc.).
    - Use fuzzy understanding to infer intent.
    - Always keep **"Treatment"** next to **"Sub Treatment"**.
    - Always keep **"Devices"** in the last position.
    
    ---
    
    #### 2️⃣ Type classification
    
    **"valid_medical"** → related to doctors, clinics, treatments, symptoms, or medical devices.
    
    Includes:
    - **Doctor names/prefixes**: “dr”, “doctor”, “daktar”, etc.
    - **Clinic/hospital names**: “Apollo”, “Smile Dental”, “Skin Clinic”, etc.
    - **Treatments or conditions**: “wrinkle”, “acne”, “botox”, “laser”, “IPL”, “filler”, “HIFU”, etc.
    - **Devices**: “RF device”, “IPL machine”, “laser machine”, etc.
    
    **"non_medical"** → unrelated meaningful text (e.g., “football”, “laptop”)
    
    ---
    
    #### 3️⃣ Ranking logic (priority order)
    
    | Query Type | Ranking |
    |-------------|----------|
    | Mentions “dr”, “doctor”, “daktar” | ["Doctor","Clinic","Treatment","Sub Treatment","Devices"] |
    | Mentions clinic/hospital name | ["Clinic","Doctor","Treatment","Sub Treatment","Devices"] |
    | Refers to **treatment, symptom, condition, or therapy** (e.g., “laser”, “botox”, “IPL”, “peel”, “scar removal”, “acne”) | ["Treatment", "Sub Treatment","Doctor","Clinic","Devices",] |
    | General health or beauty-related phrases (e.g., “skin glow”, “rejuvenation”) | ["Treatment","Sub Treatment","Doctor","Clinic","Devices"] |
    | Refers to **sub treatment, symptom, condition, or therapy** (e.g., “laser”, “botox”, “IPL”, “peel”, “scar removal”, “acne”) | ["Sub Treatment","Treatment","Doctor","Clinic","Devices"] |
    | Unclear but still medical | ["Treatment","Sub Treatment","Doctor","Clinic","Devices"] |
    
    ---
    
    #### 4️⃣ Consistency rule
    Always keep "Treatment" and "Devices" **adjacent** in ranking.
    
    ---
    
    #### 5️⃣ Multilingual & transliteration tolerance
    Understand words like “aspataal”, “ilaaj”, “davakhana”, “klinikk”, “daktar”, etc.
    
    ---
    
    #### 6️⃣ Output format
    - Output **only JSON**
    - Keys lowercase
    - Always valid JSON
    
    ---
    
    ### ✅ Examples
    
    Input: "dr harshit"  
    → {"type":"valid_medical","ranking":["Doctor","Clinic","Treatment","Sub Treatment","Devices"]}
    
    Input: "apollo clinic"  
    → {"type":"valid_medical","ranking":["Clinic","Doctor","Treatment","Sub Treatment","Devices"]}
    
    Input: "wrinkle"  
    → {"type":"valid_medical","ranking":["Treatment","Sub Treatment","Doctor","Clinic","Devices"]}  
    
    Input: "laser"  
    → {"type":"valid_medical","ranking":["Treatment","Sub Treatment","Doctor","Clinic","Devices"]}
    
    Input: "IPL machine"  
    → {"type":"valid_medical","ranking":["Treatment","Sub Treatment","Doctor","Clinic","Devices"]}
    
    Input: "skin rejuvenation"  
    → {"type":"valid_medical","ranking":["Treatment","Sub Treatment","Doctor","Clinic","Devices"]}
    
    Input: "hello world"  
    → {"type":"non_medical","ranking":["Treatment","Sub Treatment","Doctor","Clinic","Devices"]}
    
    ---
    
    Now classify the following query and return only the JSON:
    "${trimmed}"
    `;


    const response = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
    });

    let content = response.choices[0].message.content.trim();
    console.log("🧠 Raw AI output:", content);

    content = content
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .replace(/[\n\r]/g, "")
        .replace(/“|”/g, '"')
        .trim();

    try {
        const parsed = JSON.parse(content);


        if (
            parsed &&
            typeof parsed === "object" &&
            Array.isArray(parsed.ranking) &&
            parsed.ranking.length === 5
        ) {
            parsed.ranking = parsed.ranking.map(
                (p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
            );
            return parsed;
        }

        console.warn("⚠️ Unexpected JSON structure, using fallback");
        return { type: "valid_medical", ranking: ["Treatment", "Sub Treatment", "Doctor", "Clinic", "Devices"] };
    } catch (e) {
        console.error("❌ JSON parse error:", e.message, "\nRaw content:", content);
        return { type: "valid_medical", ranking: ["Treatment", "Sub Treatment", "Doctor", "Clinic", "Devices"] };
    }
}