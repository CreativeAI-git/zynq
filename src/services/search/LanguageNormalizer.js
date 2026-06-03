class LanguageNormalizer {
    /**
     * Normalizes Swedish and mixed-language queries to English search intent
     * @param {string} query 
     * @param {Array} protectedTerms 
     * @returns {string} The normalized query
     */
    static normalize(query, protectedTerms = []) {
        let normalizedQuery = query.toLowerCase().trim();

        // Basic dictionary mapping for demonstration. 
        // In production, this might use a translation API or a more extensive dictionary.
        const swedishToEnglishDict = {
            'hårborttagning': 'hair removal',
            'pigmentering': 'pigmentation',
            'laserbehandling': 'laser treatment',
            'hudpenna': 'skinpen', // Even though it's protected, just an example
            'akneärr': 'acne scars',
            'huduppstramning': 'skin tightening',
            'mörka ringar': 'dark circles'
        };

        // Typo corrections (Fuzzy mapping base)
        const typosDict = {
            'morfeus': 'Morpheus8',
            'microneedl': 'Microneedling',
            'pigmentering': 'pigmentation' // handles partial match conceptually
        };

        // Apply Typo corrections
        for (const [typo, correct] of Object.entries(typosDict)) {
            const regex = new RegExp(`\\b${typo}\\b`, 'gi');
            normalizedQuery = normalizedQuery.replace(regex, correct.toLowerCase());
        }

        // Apply Swedish to English normalization
        for (const [sw, en] of Object.entries(swedishToEnglishDict)) {
            const regex = new RegExp(`\\b${sw}\\b`, 'gi');
            normalizedQuery = normalizedQuery.replace(regex, en.toLowerCase());
        }

        // Ensure protected terms remain perfectly cased if they were somehow altered
        protectedTerms.forEach(term => {
            const regex = new RegExp(`\\b${term}\\b`, 'gi');
            normalizedQuery = normalizedQuery.replace(regex, term);
        });

        return normalizedQuery;
    }
}

export default LanguageNormalizer;
