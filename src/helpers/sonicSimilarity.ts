export function calculateCoveragePercent(
  indexSize: number | undefined,
  totalAnalyzed: number | undefined,
): number | null {
  if (
    indexSize === undefined ||
    totalAnalyzed === undefined ||
    totalAnalyzed <= 0
  ) {
    return null;
  }
  return Math.min(100, Math.round((indexSize / totalAnalyzed) * 100));
}
