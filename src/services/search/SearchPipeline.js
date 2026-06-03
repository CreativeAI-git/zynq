import ProtectedNameEngine from './ProtectedNameEngine.js';
import LanguageNormalizer from './LanguageNormalizer.js';
import IntentDetector from './IntentDetector.js';
import RelationshipEngine from './RelationshipEngine.js';
import CategoryGuard from './CategoryGuard.js';
import ScoringEngine from './ScoringEngine.js';

class SearchPipeline {
    constructor(query, targetRouterType) {
        this.rawQuery = query;
        this.targetRouterType = targetRouterType; // 'DEVICE', 'TREATMENT', 'SUB_TREATMENT', 'GENERAL'
    }

    async execute() {
        // Phase 1 & 7 & 8: Language & Protected Names
        const { protectedTerms } = ProtectedNameEngine.process(this.rawQuery);
        const normalizedQuery = LanguageNormalizer.normalize(this.rawQuery, protectedTerms);

        // Phase 1: Intent Detection
        const { intent, entityType, confidenceScore } = IntentDetector.detect(normalizedQuery);

        // Array to hold all raw results before ranking
        let rawResults = [];

        // Phase 2 & 3: Direct Match & Relationship Expansion
        // Here we mock the DB fetch for Direct Match
        if (this.targetRouterType === entityType || this.targetRouterType === 'GENERAL') {
            rawResults.push({
                name: intent, // Mock fetching actual DB record
                type: entityType,
                isDirectMatch: true,
                category: 'General' // Mock category
            });
        }

        // Fetch relationships regardless of router, because a search for "Morpheus8" (DEVICE) 
        // in the TREATMENT router should expand via RelationshipEngine
        const relatedEntities = await RelationshipEngine.expand(intent, entityType);
        
        // Add related entities that match the target router
        relatedEntities.forEach(relation => {
            if (this.targetRouterType === relation.type || this.targetRouterType === 'GENERAL') {
                rawResults.push(relation);
            }
        });

        // Phase 5: Category Guard
        // E.g., if intent was "PRP" (Primary Category: 'PRP'), restrict cross-overs
        const primaryCategory = rawResults.find(r => r.isDirectMatch)?.category || 'General';
        const guardedResults = CategoryGuard.enforce(rawResults, primaryCategory);

        // Phase 4 & 6: Scoring, Relevance, and Ranking
        const scoredResults = guardedResults.map(result => 
            ScoringEngine.score(result, confidenceScore)
        );

        const rankedResults = ScoringEngine.rank(scoredResults);

        return rankedResults;
    }
}

export default SearchPipeline;
