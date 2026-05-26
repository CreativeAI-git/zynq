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
