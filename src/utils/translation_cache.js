/**
 * Translation Cache — In-memory LRU with TTL
 * 
 * Eliminates redundant Google Translate API calls by caching
 * translated text keyed on `text:targetLang`.
 * 
 * - Max entries: 5000
 * - TTL: 1 hour (configurable)
 * - Auto-cleanup: every 10 minutes
 */

const MAX_ENTRIES = 5000;
const TTL_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

class TranslationCache {
    constructor() {
        /** @type {Map<string, {value: string, ts: number}>} */
        this._cache = new Map();
        this._hits = 0;
        this._misses = 0;

        // Periodic cleanup of expired entries
        this._cleanupTimer = setInterval(() => this._cleanup(), CLEANUP_INTERVAL_MS);
        // Allow Node to exit without waiting for this timer
        if (this._cleanupTimer.unref) this._cleanupTimer.unref();
    }

    /**
     * Build a cache key from text + target language.
     * Normalize to avoid near-duplicate entries.
     */
    _key(text, targetLang) {
        return `${String(targetLang || "en").toLowerCase()}::${String(text || "").trim()}`;
    }

    /**
     * Get a cached translation, or undefined if not cached / expired.
     */
    get(text, targetLang) {
        const key = this._key(text, targetLang);
        const entry = this._cache.get(key);

        if (!entry) {
            this._misses++;
            return undefined;
        }

        // Check TTL
        if (Date.now() - entry.ts > TTL_MS) {
            this._cache.delete(key);
            this._misses++;
            return undefined;
        }

        // Move to end for LRU (Map preserves insertion order)
        this._cache.delete(key);
        this._cache.set(key, entry);

        this._hits++;
        return entry.value;
    }

    /**
     * Store a translation in the cache.
     */
    set(text, targetLang, translatedValue) {
        const key = this._key(text, targetLang);

        // If already exists, delete first to update insertion order
        if (this._cache.has(key)) {
            this._cache.delete(key);
        }

        // Evict oldest entries if at capacity
        while (this._cache.size >= MAX_ENTRIES) {
            const oldestKey = this._cache.keys().next().value;
            this._cache.delete(oldestKey);
        }

        this._cache.set(key, { value: translatedValue, ts: Date.now() });
    }

    /**
     * Remove expired entries.
     */
    _cleanup() {
        const now = Date.now();
        for (const [key, entry] of this._cache) {
            if (now - entry.ts > TTL_MS) {
                this._cache.delete(key);
            }
        }
    }

    /**
     * Stats for monitoring.
     */
    stats() {
        return {
            size: this._cache.size,
            hits: this._hits,
            misses: this._misses,
            hitRate: this._hits + this._misses > 0
                ? ((this._hits / (this._hits + this._misses)) * 100).toFixed(1) + "%"
                : "N/A"
        };
    }

    /**
     * Clear the entire cache.
     */
    clear() {
        this._cache.clear();
        this._hits = 0;
        this._misses = 0;
    }
}

// Singleton instance — shared across the entire app
export const translationCache = new TranslationCache();
