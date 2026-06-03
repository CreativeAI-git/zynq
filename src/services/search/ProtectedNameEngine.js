// Pre-defined list of brand names and protected entities
const BRAND_NAMES = [
    "Clarity II",
    "Icoone",
    "Candela Nordlys",
    "SkinPen",
    "Morpheus8",
    "Dioxium",
    "Emsella",
    "Fotona StarWalker",
    "LaseMD",
    "ND:YAG",
    "Genius RF",
    "Secret RF",
    "Dermapen"
];

class ProtectedNameEngine {
    /**
     * Detects branded entities and freezes them so they are excluded from translation
     * @param {string} query The raw user query
     * @returns {object} { normalizedQuery, protectedTerms: [] }
     */
    static process(query) {
        let normalizedQuery = query;
        const protectedTerms = [];

        // Simple approach: look for protected names and replace them with placeholders
        BRAND_NAMES.forEach(brand => {
            const regex = new RegExp(`\\b${brand}\\b`, 'gi');
            if (regex.test(query)) {
                // For this implementation, we just extract them to know they exist
                // and should be queried EXACTLY as they are.
                protectedTerms.push(brand);
                
                // Alternatively, we could replace with a token e.g., __PROTECTED_0__
                // and restore it after normalization.
            }
        });

        return {
            originalQuery: query,
            protectedTerms
        };
    }
}

export default ProtectedNameEngine;
