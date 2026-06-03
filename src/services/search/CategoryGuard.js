class CategoryGuard {
    /**
     * Prevents leakage of unrelated categories unless explicitly permitted by strong relationships.
     * @param {Array} results Current result set
     * @param {string} intentCategory The primary category of the search intent
     * @returns {Array} Filtered results
     */
    static enforce(results, intentCategory) {
        // Definitions of which categories should NOT mix
        const RESTRICTED_CROSSOVERS = {
            'PRP': ['Laser', 'IPL', 'HIFU'],
            'Hair Removal': ['Hair Loss'],
            'Facial': ['Body Tightening'],
            'Botox': ['Laser Devices']
        };

        if (!RESTRICTED_CROSSOVERS[intentCategory]) {
            return results; // No strict restrictions for this category
        }

        const restrictedTargets = RESTRICTED_CROSSOVERS[intentCategory];

        return results.filter(result => {
            // Check if the result belongs to a restricted category
            const isRestricted = restrictedTargets.includes(result.category);

            if (isRestricted) {
                // If restricted, ONLY allow if it's an extremely strong, explicit database mapping
                // meaning someone explicitly linked them despite the category boundaries.
                return result.relationship_score > 90;
            }

            return true;
        });
    }
}

export default CategoryGuard;
