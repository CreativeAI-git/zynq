class ScoringEngine {
    /**
     * Calculates the relevance tier and total score for a search result
     * @param {object} result 
     * @param {number} intentConfidenceScore 
     * @returns {object} updated result with .total_score and .match_type
     */
    static score(result, intentConfidenceScore) {
        let matchType = 'FALLBACK';
        let totalScore = 0;

        if (result.isDirectMatch) {
            matchType = 'DIRECT_MATCH';
            // Tier 1
            totalScore = 90 + (intentConfidenceScore * 0.1); // Max 100
        } else if (result.isMappedRelation) {
            matchType = 'MAPPED_RELATION';
            // Tier 2: Relies on the relationship_score from the database
            totalScore = 70 + ((result.relationship_score || 0) * 0.19); // Scales 70 to 89
        } else if (result.isAssociatedRelation) {
            matchType = 'ASSOCIATED_RELATION';
            // Tier 3
            totalScore = 40 + ((result.relationship_score || 0) * 0.29); // Scales 40 to 69
        } else {
            // Tier 4: Fallback
            totalScore = result.keywordScore || 10; // 10 to 39
        }

        return {
            ...result,
            match_type: matchType,
            score: Math.round(totalScore)
        };
    }

    /**
     * Sorts an array of scored results by total_score descending
     */
    static rank(results) {
        return results.sort((a, b) => b.score - a.score);
    }
}

export default ScoringEngine;
