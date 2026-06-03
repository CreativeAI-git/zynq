function normalizeForSort(value = "") {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function defaultScoreSelector(row = {}) {
  const score = row.score ?? row.final_score ?? row.lexical_score ?? 0;
  return Number.isFinite(Number(score)) ? Number(score) : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function tokenizeGraphText(value = "") {
  return normalizeForSort(value)
    .replace(/[^a-z0-9_\s:+-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function parseWeightConfig() {
  try {
    const parsed = JSON.parse(process.env.SEARCH_GRAPH_LEVEL_WEIGHTS_JSON || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const GRAPH_LEVEL_WEIGHTS = {
  direct_entity: 1,
  linked_service: 0.88,
  linked_device: 0.82,
  linked_concern: 0.78,
  linked_metadata: 0.72,
  clinical_related: 0.62,
  ...parseWeightConfig()
};

export function computeGraphTextRelevance(text = "", query = "") {
  const normalizedText = normalizeForSort(text);
  const normalizedQuery = normalizeForSort(query);
  if (!normalizedText || !normalizedQuery) return 0;

  if (normalizedText === normalizedQuery) return 1;
  if (normalizedText.includes(normalizedQuery)) return 0.92;

  const queryTokens = tokenizeGraphText(normalizedQuery);
  if (!queryTokens.length) return 0;

  const textTokens = new Set(tokenizeGraphText(normalizedText));
  const overlap = queryTokens.filter((token) => textTokens.has(token)).length / queryTokens.length;
  return clamp(overlap, 0, 1);
}

export function buildGraphRelationMeta({
  level = "linked_metadata",
  relationSource = "metadata_relation",
  relationText = "",
  query = "",
  queryProfile = {}
} = {}) {
  const queryRelevance = computeGraphTextRelevance(relationText, query);
  const levelWeight = Number(GRAPH_LEVEL_WEIGHTS[level] ?? GRAPH_LEVEL_WEIGHTS.linked_metadata);
  const specificity = Number(queryProfile?.specificity ?? 0.5);
  const specificityWeight = clamp(0.86 + (specificity * 0.18), 0.86, 1.04);
  const relationshipStrength = clamp(queryRelevance * levelWeight * specificityWeight, 0, 1);

  let priority = 4;
  if (relationshipStrength >= 0.9) priority = 1;
  else if (relationshipStrength >= 0.72) priority = 2;
  else if (relationshipStrength >= 0.56) priority = 3;

  return {
    relationship_source: relationSource,
    relationship_level: level,
    query_relevance: Number(queryRelevance.toFixed(3)),
    relationship_strength: Number(relationshipStrength.toFixed(3)),
    relation_priority: priority,
    relation_match_type: relationSource
  };
}

export function getGraphExpansionThreshold(queryProfile = {}, options = {}) {
  const base = Number(options.base ?? 0.52);
  const specificity = Number(queryProfile?.specificity ?? 0.5);
  const broadPenalty = queryProfile?.broad_intent ? 0.08 : 0;
  const partialPenalty = queryProfile?.typo_or_partial_intent ? 0.08 : 0;
  const narrowDiscount = queryProfile?.narrow_intent ? -0.04 : 0;
  return Number(clamp(base + broadPenalty + partialPenalty + narrowDiscount + ((0.5 - specificity) * 0.08), 0.46, 0.74).toFixed(3));
}

export function mergeGraphAwareResults(primary = [], related = [], options = {}) {
  const {
    keySelector = (row) => row?.id ?? row?.treatment_id ?? row?.device_id,
    nameSelector = (row) => row?.name ?? row?.device_name ?? "",
    scoreSelector = defaultScoreSelector,
    primaryPriority = 1,
    relatedDefaultPriority = 2
  } = options;

  const merged = new Map();

  const upsert = (row, sourcePriority) => {
    const key = keySelector(row);
    if (key === undefined || key === null || key === "") return;

    const normalizedKey = String(key);
    const score = scoreSelector(row);
    const relationPriority = Number(row?.relation_priority) || sourcePriority || relatedDefaultPriority;
    const matchType = row?.relation_match_type || (sourcePriority === 1 ? "exact" : "direct_relation");

    const candidate = {
      ...row,
      relation_priority: relationPriority,
      relation_match_type: matchType,
      _sort_score: score,
      _sort_name: normalizeForSort(nameSelector(row))
    };

    const existing = merged.get(normalizedKey);
    if (!existing) {
      merged.set(normalizedKey, candidate);
      return;
    }

    // Keep strongest priority. If equal priority, keep higher score.
    if (candidate.relation_priority < existing.relation_priority) {
      merged.set(normalizedKey, { ...existing, ...candidate });
      return;
    }

    if (
      candidate.relation_priority === existing.relation_priority &&
      (candidate._sort_score > existing._sort_score)
    ) {
      merged.set(normalizedKey, { ...existing, ...candidate });
    }
  };

  primary.forEach((row) => upsert(row, primaryPriority));
  related.forEach((row) => upsert(row, relatedDefaultPriority));

  return Array.from(merged.values())
    .sort((a, b) => {
      if ((a.relation_priority ?? 99) !== (b.relation_priority ?? 99)) {
        return (a.relation_priority ?? 99) - (b.relation_priority ?? 99);
      }

      if ((b._sort_score ?? 0) !== (a._sort_score ?? 0)) {
        return (b._sort_score ?? 0) - (a._sort_score ?? 0);
      }

      return (a._sort_name || "").localeCompare(b._sort_name || "");
    })
    .map(({ _sort_score, _sort_name, ...rest }) => rest);
}
