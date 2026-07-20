const GAEPPUL_HIGH_TYPE_BOOK_KEY = /^gaeppul_high_.+_type$/u;
const TYPE_NUMBER = /^유형\s*0*([0-9]+)/u;

export function parseGaeppulTypeNumber(value) {
  if (typeof value !== 'string') return null;
  const match = TYPE_NUMBER.exec(value.trim());
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function validateGaeppulHighTypeUnitBoundaries(
  exportJson,
  { includeUnverified = false } = {},
) {
  if (!GAEPPUL_HIGH_TYPE_BOOK_KEY.test(String(exportJson?.book_id || ''))) return;

  const units = (exportJson.parts || []).flatMap((part) => part.units || []);
  if (units.length === 0) {
    throw new Error(`${exportJson.book_id}: high-school type workbook has no units`);
  }

  let previousUnitLastType = null;
  for (const [unitIndex, unit] of units.entries()) {
    const problems = (unit.problems || []).filter(
      (problem) => includeUnverified || problem.verified !== false,
    );
    const typeNames = [];
    for (const problem of problems) {
      const typeName = typeof problem.type_name === 'string' ? problem.type_name.trim() : '';
      if (!typeName) {
        throw new Error(`${exportJson.book_id}/${unit.unit_id || unitIndex}: problem is missing type_name`);
      }
      if (typeNames[typeNames.length - 1] !== typeName) typeNames.push(typeName);
    }

    if (typeNames.length === 0) {
      throw new Error(`${exportJson.book_id}/${unit.unit_id || unitIndex}: unit has no importable problems`);
    }
    if (previousUnitLastType === typeNames[0]) {
      throw new Error(
        `${exportJson.book_id}/${unit.unit_id || unitIndex}: type "${typeNames[0]}" crosses a unit boundary`,
      );
    }

    for (const [typeIndex, typeName] of typeNames.entries()) {
      const actualNumber = parseGaeppulTypeNumber(typeName);
      const expectedNumber = typeIndex + 1;
      if (actualNumber !== expectedNumber) {
        throw new Error(
          `${exportJson.book_id}/${unit.unit_id || unitIndex}: expected 유형${expectedNumber}, `
          + `found ${actualNumber === null ? `"${typeName}"` : `유형${actualNumber}`}`,
        );
      }
    }

    previousUnitLastType = typeNames[typeNames.length - 1];
  }
}
