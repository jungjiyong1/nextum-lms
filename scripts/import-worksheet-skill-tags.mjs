// 유형교재(gaeppul) 문제에 문제은행 유형(analysis_skill) 태그를 부여한다.
// 근거 데이터: grade-app의 유형 매칭표를 변환한 scripts/data/*.json.
// 이 태그가 있어야 유형교재 풀이 이력이 학습 증거·학습지 추천에 반영된다.
//
// 기본은 미리보기(preview)이며 --apply를 붙여야 원격 DB에 쓴다.
// 모든 태그는 source_kind 'import' + source_ref 'gaeppul-type-matching-v1'로
// 기록되어 필요 시 일괄 회수할 수 있다. 이미 태그가 있는 문제는 건드리지
// 않는다 (문제은행 수동 태그 보존).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createClient } from '@supabase/supabase-js';
import { loadEnvFiles } from './_load-env.mjs';

loadEnvFiles();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const SOURCE_REF = 'gaeppul-type-matching-v1';
const MATCHING_FILE = process.argv.find((arg) => arg.startsWith('--matching='))?.slice(11)
  || join('scripts', 'data', 'gaeppul-math2-2-power-skill-matching.json');

// 섹션명 기반 난이도 근사 (문제별 난이도 데이터가 없어 파일럿용으로 사용)
const DIFFICULTY_BANDS = {
  '쏙쏙 다시 개념 익히기': 1,
  '핵심 유형 문제': 2,
  '실력 UP 문제': 3,
  '실전 테스트': 3,
};
const DEFAULT_BAND = 2;

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const content = supabase.schema('content');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/[\s??!()\[\]{}·;:,.'"“”‘’~\-⑴⑵⑶⑷]/g, '')
    .toLowerCase();
}

async function loadAllRows(table, columns, filter) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let query = content.from(table).select(columns).range(from, from + 999);
    query = filter(query);
    const { data, error } = await query;
    if (error) fail(`${table} 조회 실패: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

const matching = JSON.parse(readFileSync(MATCHING_FILE, 'utf8'));
console.log(`매칭표: ${MATCHING_FILE} (${matching.rows.length}행, 교재 ${matching.bookKey})`);

const { data: book, error: bookError } = await content
  .from('books').select('id,title').eq('book_key', matching.bookKey).maybeSingle();
if (bookError || !book) fail(`교재 ${matching.bookKey}를 찾지 못했습니다.`);
console.log(`교재: ${book.title}`);

const { data: revision, error: revisionError } = await content
  .from('analysis_taxonomy_revisions')
  .select('id,revision_number')
  .eq('status', 'published')
  .order('revision_number', { ascending: false })
  .limit(1)
  .maybeSingle();
if (revisionError || !revision) fail('발행된 taxonomy revision이 없습니다.');

const units = await loadAllRows('units', 'id,name', (q) => q.eq('book_id', book.id));
const types = await loadAllRows('problem_types', 'id,name,unit_id', (q) => q.eq('book_id', book.id));
// gaeppul 교재에서 "유형N: ..." 이름의 유형 행은 type_id가 가리킨다
// (problem_type_id는 유형명만 있는 병행 행을 가리킬 수 있음).
const problems = await loadAllRows('problems', 'id,type_id,problem_type_id,difficulty_hint', (q) => q.eq('book_id', book.id));
const skillsRaw = await loadAllRows('analysis_skills', 'id,name,metadata', (q) => q.eq('grade', matching.skillGrade).eq('active', true));
// 고교 선택과목은 grade가 공유되므로 part_key로 좁힌다 (예: calculus1).
const skills = matching.skillPartKey
  ? skillsRaw.filter((skill) => skill.metadata?.part_key === matching.skillPartKey)
  : skillsRaw;
console.log(`단원 ${units.length} · 유형 ${types.length} · 문제 ${problems.length} · 스킬 ${skills.length}`);

// 단원은 "N. 대단원 / MM 소단원"의 번호 쌍으로 매칭한다 (명칭 표기 차이 흡수).
function unitNumbers(value) {
  const match = String(value ?? '').match(/^\s*(\d+)\.[^/]*\/\s*(\d+)/);
  return match ? `${Number(match[1])}-${Number(match[2])}` : null;
}
// 유형은 단원 내 "유형N" 번호로 매칭한다 (유형 번호는 단원마다 1부터 시작).
function typeNumber(value) {
  const match = String(value ?? '').match(/^유형\s*0*(\d+)\s*:/);
  return match ? Number(match[1]) : null;
}

const unitByNumbers = new Map();
const unitByNormName = new Map();
for (const unit of units) {
  const key = unitNumbers(unit.name);
  if (key) unitByNumbers.set(key, unit.id);
  unitByNormName.set(normalizeName(unit.name), unit.id);
}
const skillByName = new Map(skills.map((skill) => [normalizeName(skill.name), skill]));
const typeByUnitNumber = new Map();
for (const type of types) {
  const number = typeNumber(type.name);
  if (number !== null) typeByUnitNumber.set(`${type.unit_id}|${number}`, type);
}

// 유형(typeNo)당 첫 매칭 행의 pat를 대표 스킬로 사용한다.
// (태그는 문제당 1개만 허용되므로 다중 pat 유형은 대표 1개로 근사)
const firstRowByType = new Map();
for (const row of matching.rows) {
  const key = `${row.unitName}|${row.typeName}`;
  if (!firstRowByType.has(key)) firstRowByType.set(key, row);
}

const skillByTypeId = new Map();
const unmatched = [];
for (const [, row] of firstRowByType) {
  if (row.patName === '직접 매칭 없음') {
    unmatched.push({ ...row, reason: 'no_pat_mapping' });
    continue;
  }
  const unitId = unitByNumbers.get(unitNumbers(row.unitName) ?? '')
    ?? unitByNormName.get(normalizeName(row.unitName));
  if (!unitId) {
    unmatched.push({ ...row, reason: 'unit_not_found' });
    continue;
  }
  const rowTypeNumber = typeNumber(row.typeName);
  const type = rowTypeNumber === null ? null : typeByUnitNumber.get(`${unitId}|${rowTypeNumber}`);
  if (!type) {
    unmatched.push({ ...row, reason: 'type_not_found' });
    continue;
  }
  const skill = skillByName.get(normalizeName(row.patName));
  if (!skill) {
    unmatched.push({ ...row, reason: 'skill_not_found' });
    continue;
  }
  skillByTypeId.set(type.id, skill);
}
console.log(`유형 매칭: ${skillByTypeId.size}/${firstRowByType.size} (미매칭 ${unmatched.length})`);
for (const miss of unmatched) {
  console.log(`  - [${miss.reason}] ${miss.unitName} / ${miss.typeName} (pat: ${miss.patName})`);
}

const problemIds = problems.map((problem) => problem.id);
const existingTagged = new Set();
for (let index = 0; index < problemIds.length; index += 200) {
  const chunk = problemIds.slice(index, index + 200);
  const { data, error } = await content
    .from('problem_analysis_tags')
    .select('problem_id')
    .eq('taxonomy_revision_id', revision.id)
    .in('problem_id', chunk);
  if (error) fail(`기존 태그 조회 실패: ${error.message}`);
  for (const tag of data ?? []) existingTagged.add(tag.problem_id);
}

const now = new Date().toISOString();
const inserts = [];
let skippedExisting = 0;
let skippedNoSkill = 0;
const bandCounts = {};
for (const problem of problems) {
  if (existingTagged.has(problem.id)) {
    skippedExisting += 1;
    continue;
  }
  const linkedTypeId = problem.type_id ?? problem.problem_type_id;
  const skill = linkedTypeId ? skillByTypeId.get(linkedTypeId) : null;
  if (!skill) {
    skippedNoSkill += 1;
    continue;
  }
  const band = DIFFICULTY_BANDS[problem.difficulty_hint] ?? DEFAULT_BAND;
  bandCounts[band] = (bandCounts[band] ?? 0) + 1;
  inserts.push({
    problem_id: problem.id,
    analysis_skill_id: skill.id,
    taxonomy_revision_id: revision.id,
    challenge_band: band,
    // 동형 정보가 없으므로 문제 자체를 임시 동형 그룹으로 둔다 (학습지 정책과 동일)
    equivalence_key: problem.id,
    source_kind: 'import',
    source_ref: SOURCE_REF,
    review_status: 'approved',
    reviewed_at: now,
    metadata: { matching_source: matching.source },
  });
}

console.log('');
console.log(`태그 생성 대상: ${inserts.length}문제`);
console.log(`  기존 태그 보존: ${skippedExisting} · 매칭 유형 없음: ${skippedNoSkill}`);
console.log(`  난이도 분포: ${JSON.stringify(bandCounts)}`);

if (!APPLY) {
  console.log('');
  console.log('미리보기 모드입니다. 실제 적용은 --apply를 붙여 실행하세요.');
  process.exit(0);
}

let written = 0;
for (let index = 0; index < inserts.length; index += 200) {
  const chunk = inserts.slice(index, index + 200);
  const { error } = await content.from('problem_analysis_tags').insert(chunk);
  if (error) fail(`태그 삽입 실패(${written}건 적용 후): ${error.message}`);
  written += chunk.length;
}
console.log(`적용 완료: ${written}건 (source_ref='${SOURCE_REF}'로 일괄 조회·회수 가능)`);
