import { isTextAllowedForIntent, normalizeSearchText, parseSearchIntent } from "./intent_taxonomy.js";
import { normalizeProtectedAlias } from "./protected_terms.js";
import dotenv from "dotenv";

dotenv.config();

function parseJsonArrayEnv(rawValue) {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeList(list = []) {
  return list
    .map((v) => normalizeSearchText(String(v || "")))
    .filter(Boolean);
}

const DEVICE_ALLOWED_ENTITY_TYPES = new Set(
  normalizeList(parseJsonArrayEnv(process.env.SEARCH_DEVICE_ALLOWED_ENTITY_TYPES_JSON))
);

function getBucketRoot(bucket = "") {
  const normalized = normalizeSearchText(bucket);
  if (!normalized) return "";
  return normalized.split("_")[0] || normalized;
}

function inferCanonicalCategory(text = "", fallbackCategory = "") {
  const fromFallback = normalizeSearchText(fallbackCategory);
  if (fromFallback) return fromFallback;
  const parsed = parseSearchIntent(text);
  return normalizeSearchText(parsed?.intentBucket || "generic");
}

function inferEntityType(row = {}) {
  const provided = normalizeSearchText(row.entity_type || "");
  if (provided) return provided;

  if (row.device_id && (row.device_name || row.device_swedish)) return "device";
  if (row.treatment_id || row.treatment_name || row.name) return "service_variant";
  return "unknown";
}

function inferRelationshipSource(row = {}) {
  if (row.relationship_source) return row.relationship_source;
  if (row.relation_match_type === "exact_match") return "exact_mapping";
  if (row.relation_match_type === "direct_relation") return "direct_mapping";
  if (Number(row.relation_priority || 99) <= 2) return "mapped_relation";
  if ((row.semantic_score ?? row.gpt_score ?? 0) > 0) return "semantic";
  return "lexical";
}

function getRelationshipStrength(row = {}) {
  if (Number(row.relationship_strength) > 0) return Number(row.relationship_strength);
  if (row.relation_match_type === "exact_match") return 1;
  if (row.relation_match_type === "direct_relation") return 0.86;
  if (Number(row.relation_priority || 99) <= 2) return 0.8;
  if ((row.exact_match ?? 0) > 0) return 1;
  const score = Number(row.final_score ?? row.score ?? row.name_score ?? 0);
  if (Number.isFinite(score)) return Math.max(0, Math.min(1, score));
  return 0;
}

function evaluateTechnologyCompatibility(queryInfo = {}, rowText = "") {
  const queryBucket = normalizeSearchText(queryInfo?.intentBucket || "");
  if (!queryBucket) return true;

  const rowBucket = normalizeSearchText(parseSearchIntent(rowText)?.intentBucket || "");
  if (!rowBucket) return true;

  if (queryBucket === rowBucket) return true;
  return getBucketRoot(queryBucket) === getBucketRoot(rowBucket);
}

function isSemanticOnlyCandidate(row = {}) {
  const exact = (row.exact_match ?? 0) > 0;
  const mapped = Number(row.relation_priority || 99) <= 2 || row.relation_match_type === "exact_match" || row.relation_match_type === "direct_relation";
  const lexical = Number(row.name_score ?? row.lexical_score ?? 0);
  const semantic = Number(row.semantic_score ?? row.gpt_score ?? 0);
  return !exact && !mapped && semantic > 0.45 && lexical < 0.55;
}

function compact(value = "") {
  return normalizeProtectedAlias(value).replace(/\s+/g, "");
}

const IGNORED_ENTITY_TOKENS = new Set([
  "manual", "manuell", "automatic", "automatisk",
  "treatment", "behandling", "device", "apparat", "apparatus",
  "machine", "maskin", "system", "facial", "peel", "peeling",
  "skin", "hud", "care", "vard", "vård", "body", "kropp", "therapy", "terapi",
  "with", "med", "without", "utan", "needling", "nalning", "nålning"
]);

function getQueryEntityTokens(queryInfo = {}) {
  const queryTokens = normalizeSearchText(queryInfo?.normalized || queryInfo?.raw || "")
    .split(/\s+/)
    .filter((token) => token.length >= 4);
  const intentTokens = normalizeSearchText(queryInfo?.matchedKeyword || "")
    .split(/\s+/)
    .filter(Boolean);
  const intentTokenSet = new Set(intentTokens);

  return queryTokens
    .filter((token) => !intentTokenSet.has(token))
    .filter((token) => !IGNORED_ENTITY_TOKENS.has(token));
}

function hasQueryEntityTokenMatch(row = {}, queryInfo = {}) {
  const entityTokens = getQueryEntityTokens(queryInfo);
  if (!entityTokens.length) return false;

  const deviceText = normalizeSearchText([
    row.device_name,
    row.device_swedish,
    row.name,
    row.swedish
  ].filter(Boolean).join(" "));
  const deviceTokens = deviceText.split(/\s+/).filter(Boolean);

  return entityTokens.some((queryToken) => deviceTokens.some((deviceToken) => (
    deviceToken === queryToken ||
    deviceToken.startsWith(queryToken) ||
    queryToken.startsWith(deviceToken)
  )));
}

function isAliasOrExactMatch(row = {}, queryInfo = {}) {
  const q = normalizeSearchText(queryInfo?.normalized || queryInfo?.raw || "");
  if (!q) return false;
  const qCompact = compact(q);

  const names = [
    row.device_name,
    row.device_swedish,
    row.name,
    row.swedish
  ].filter(Boolean);

  return names.some((name) => {
    const norm = normalizeSearchText(name);
    const normCompact = compact(name);
    return norm === q || normCompact === qCompact;
  });
}

function buildDeviceText(row = {}) {
  return normalizeSearchText([
    row.device_name,
    row.device_swedish,
    row.treatment_name,
    row.treatment_swedish,
    row.classification_type
  ].filter(Boolean).join(" "));
}

export function enforceDeviceSectionCandidates(rows = [], queryInfo = {}, options = {}) {
  const minStrength = Number(options?.minRelationshipStrength ?? 0.62);
  const phase = options?.phase || "section_assignment";
  const isCandidateGeneration = phase === "candidate_generation";
  const accepted = [];
  const rejected = [];

  rows.forEach((row) => {
    const entityType = inferEntityType(row);
    const configuredDeviceType = DEVICE_ALLOWED_ENTITY_TYPES.size > 0
      ? DEVICE_ALLOWED_ENTITY_TYPES.has(entityType)
      : (entityType === "device");
    const allowedSections = configuredDeviceType ? ["devices"] : ["services"];
    const rowText = buildDeviceText(row);
    const canonicalCategory = inferCanonicalCategory(rowText, row.canonical_category);
    const relationshipSource = inferRelationshipSource(row);
    const relationshipStrength = getRelationshipStrength(row);
    const typedFilterPassed = allowedSections.includes("devices");
    const intentCompatible = isTextAllowedForIntent(rowText, queryInfo);
    const technologyCompatible = evaluateTechnologyCompatibility(queryInfo, rowText);
    const semanticOnly = isSemanticOnlyCandidate(row);
    const exactOrAlias = isAliasOrExactMatch(row, queryInfo);
    const entityTokenMatch = hasQueryEntityTokenMatch(row, queryInfo);
    const explicitlyMapped = Number(row.relation_priority || 99) <= 2 || row.relation_match_type === "exact_match" || row.relation_match_type === "direct_relation";
    const passesRelationship = relationshipStrength >= minStrength;
    const strictCategoryIntent = queryInfo?.intentType === "strict_category";
    const passesStrictDeviceRule = isCandidateGeneration
      ? (typedFilterPassed && ((intentCompatible && technologyCompatible) || entityTokenMatch))
      : (typedFilterPassed && (exactOrAlias || entityTokenMatch || explicitlyMapped || (passesRelationship && !strictCategoryIntent)));

    let rejectionReason = null;
    if (!typedFilterPassed) rejectionReason = "entity_type_not_allowed_for_devices";
    else if (!intentCompatible && !entityTokenMatch) rejectionReason = "canonical_intent_mismatch";
    else if (!technologyCompatible && !entityTokenMatch) rejectionReason = "technology_boundary_mismatch";
    else if (!isCandidateGeneration && semanticOnly && !explicitlyMapped && !exactOrAlias) rejectionReason = "semantic_only_candidate_rejected";
    else if (!passesStrictDeviceRule) rejectionReason = "strict_device_rule_failed";

    const annotated = {
      ...row,
      entity_type: entityType,
      canonical_category: row.canonical_category || canonicalCategory,
      parent_relationships: Array.isArray(row.parent_relationships)
        ? row.parent_relationships
        : [row.treatment_id].filter(Boolean),
      allowed_sections: allowedSections,
      relationship_source: relationshipSource,
      relationship_strength: relationshipStrength,
      typed_filter_passed: !rejectionReason,
      semantic_rejected: Boolean(semanticOnly && rejectionReason),
      section_assignment_reason: rejectionReason ? null : (explicitlyMapped ? "explicit_mapping" : ((exactOrAlias || entityTokenMatch) ? "entity_name_match" : "strong_device_candidate")),
      rejection_reason: rejectionReason,
    };

    if (rejectionReason) rejected.push(annotated);
    else accepted.push(annotated);
  });

  return { accepted, rejected };
}
