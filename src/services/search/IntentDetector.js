class IntentDetector {
    /**
     * Identifies the Primary Entity Type and Confidence Score from a normalized query
     * @param {string} query 
     * @returns {object} { intent, entityType, confidenceScore }
     */
    static detect(query) {
        const lowerQuery = query.toLowerCase();

        // Dictionary to map terms to entity types.
        // In a real application, this might query the database or an in-memory cache of all known terms.
        const entityMappings = {
            // Devices
            'morpheus8': 'DEVICE',
            'clarity ii': 'DEVICE',
            'emsella': 'DEVICE',
            'dermapen': 'DEVICE',
            'icoone': 'DEVICE',
            'skinpen': 'DEVICE',
            'candela nordlys': 'DEVICE',
            'dioxium': 'DEVICE',
            'fotona starwalker': 'DEVICE',
            'lasemd': 'DEVICE',
            'nd:yag': 'DEVICE',
            'genius rf': 'DEVICE',
            'secret rf': 'DEVICE',

            // Treatments
            'microneedling rf': 'TREATMENT',
            'microneedling': 'TREATMENT',
            'laser hair removal': 'TREATMENT',
            'hair removal': 'TREATMENT',
            'pigmentation': 'TREATMENT',
            'hair loss': 'TREATMENT',
            'acne scars': 'TREATMENT',
            'skin tightening': 'TREATMENT',
            'dark circles': 'TREATMENT',

            // Sub Treatments
            'hifu jawline': 'SUB_TREATMENT',
            'hifu neck': 'SUB_TREATMENT',
            'hifu eyes': 'SUB_TREATMENT',
        };

        let entityType = 'GENERAL';
        let confidenceScore = 0;
        let detectedIntent = query;

        // Exact Match Strategy
        for (const [term, type] of Object.entries(entityMappings)) {
            if (lowerQuery.includes(term)) {
                entityType = type;
                confidenceScore = lowerQuery === term ? 100 : 80;
                detectedIntent = term; // Extract the core intent
                break;
            }
        }

        // Broad fallback heuristics if no exact match is found
        if (entityType === 'GENERAL') {
            if (lowerQuery.includes('laser') || lowerQuery.includes('machine')) {
                entityType = 'DEVICE';
                confidenceScore = 50;
            } else if (lowerQuery.includes('treatment') || lowerQuery.includes('therapy')) {
                entityType = 'TREATMENT';
                confidenceScore = 50;
            }
        }

        return {
            intent: detectedIntent,
            entityType: entityType,
            confidenceScore: confidenceScore,
            originalNormalizedQuery: query
        };
    }
}

export default IntentDetector;
