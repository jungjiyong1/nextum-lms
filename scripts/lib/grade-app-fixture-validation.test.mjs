import { describe, expect, it } from 'vitest';
import {
  parseGaeppulTypeNumber,
  validateGaeppulHighTypeUnitBoundaries,
} from './grade-app-fixture-validation.mjs';

function problem(typeName, options = {}) {
  return {
    type_name: typeName,
    verified: options.verified ?? true,
  };
}

function highTypeBundle(units) {
  return {
    book_id: 'gaeppul_high_calculus1_type',
    parts: [{
      part_id: 'type',
      units: units.map((problems, index) => ({
        unit_id: `unit-${index + 1}`,
        problems,
      })),
    }],
  };
}

describe('grade-app high-school type workbook validation', () => {
  it('accepts units whose distinct type sequence restarts at 유형1', () => {
    const bundle = highTypeBundle([
      [problem('유형01: 첫 유형'), problem('유형01: 첫 유형'), problem('유형02: 둘째 유형')],
      [problem('유형1: 새 단원'), problem('유형2: 다음 유형'), problem('유형3: 마지막 유형')],
    ]);

    expect(() => validateGaeppulHighTypeUnitBoundaries(bundle)).not.toThrow();
    expect(parseGaeppulTypeNumber('유형007: 제목')).toBe(7);
  });

  it('rejects a following unit type that leaked into the previous unit', () => {
    const bundle = highTypeBundle([
      [problem('유형1: 첫 유형'), problem('유형2: 둘째 유형'), problem('유형1: 다음 단원 유형')],
      [problem('유형2: 다음 단원의 둘째 유형')],
    ]);

    expect(() => validateGaeppulHighTypeUnitBoundaries(bundle))
      .toThrow('expected 유형3, found 유형1');
  });

  it('rejects a unit whose first imported type does not start at 유형1', () => {
    const bundle = highTypeBundle([
      [problem('유형1: 첫 유형')],
      [problem('유형2: 잘못 이어진 유형')],
    ]);

    expect(() => validateGaeppulHighTypeUnitBoundaries(bundle))
      .toThrow('expected 유형1, found 유형2');
  });

  it('validates the same verified-only subset that the importer will store', () => {
    const bundle = highTypeBundle([
      [problem('유형1: 제외됨', { verified: false }), problem('유형2: 저장됨')],
    ]);

    expect(() => validateGaeppulHighTypeUnitBoundaries(bundle))
      .toThrow('expected 유형1, found 유형2');
    expect(() => validateGaeppulHighTypeUnitBoundaries(bundle, { includeUnverified: true }))
      .not.toThrow();
  });

  it('does not impose this workbook-specific convention on other fixtures', () => {
    const bundle = {
      book_id: 'another_workbook',
      parts: [{ units: [{ unit_id: 'unit-1', problems: [] }] }],
    };

    expect(() => validateGaeppulHighTypeUnitBoundaries(bundle)).not.toThrow();
  });
});
