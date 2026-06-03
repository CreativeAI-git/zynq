class RelationshipEngine {
    /**
     * Mock representation of database expansion.
     * In production, this queries the `SearchRelationships` table.
     * @param {string} intent 
     * @param {string} entityType 
     */
    static async expand(intent, entityType) {
        // Mock static database for Phase 1 architectural proof
        const dbMock = {
            'morpheus8': [
                { name: 'Microneedling RF', type: 'TREATMENT', relationship_score: 95, isMappedRelation: true, category: 'RF' },
                { name: 'Skin Tightening', type: 'TREATMENT', relationship_score: 80, isMappedRelation: true, category: 'Anti-Aging' }
            ],
            'microneedling rf': [
                { name: 'Morpheus8', type: 'DEVICE', relationship_score: 95, isMappedRelation: true, category: 'RF' },
                { name: 'Genius RF', type: 'DEVICE', relationship_score: 90, isMappedRelation: true, category: 'RF' },
                { name: 'Secret RF', type: 'DEVICE', relationship_score: 85, isMappedRelation: true, category: 'RF' }
            ]
        };

        const key = intent.toLowerCase();
        
        if (dbMock[key]) {
            return dbMock[key];
        }

        return [];
    }
}

export default RelationshipEngine;
