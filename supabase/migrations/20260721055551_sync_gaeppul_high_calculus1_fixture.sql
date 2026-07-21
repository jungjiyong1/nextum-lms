-- The reviewed calculus-I type-workbook fixture contains all 386 problems,
-- but the legacy import left 48 reviewed answers unpublished and retained
-- OCR-era type labels. Keep every stable problem/type UUID, publish only the
-- explicitly audited rows, and restore canonical type labels/order.
do $migration$
declare
  target_book_id uuid;
  changed_at timestamptz := clock_timestamp();
  actual_count bigint;
begin
  perform set_config('lock_timeout', '5s', true);
  perform set_config('statement_timeout', '30s', true);
  perform pg_advisory_xact_lock(
    hashtextextended('content:sync-gaeppul-high-calculus1-fixture-v1', 0)
  );

  select book.id
  into target_book_id
  from content.books book
  where book.book_key = 'gaeppul_high_calculus1_type'
  for update;

  if target_book_id is null then
    raise notice 'gaeppul_high_calculus1_type is not imported; skipping fixture sync.';
    return;
  end if;

  perform 1
  from content.problem_types problem_type
  where problem_type.book_id = target_book_id
  order by problem_type.id
  for update;

  perform 1
  from content.problems problem
  where problem.book_id = target_book_id
  order by problem.id
  for update;

  select count(*) into actual_count
  from content.units unit_row
  where unit_row.book_id = target_book_id;
  if actual_count <> 14 then
    raise exception 'Expected 14 calculus-I units, found %', actual_count;
  end if;

  select count(*) into actual_count
  from content.problem_types problem_type
  where problem_type.book_id = target_book_id;
  if actual_count <> 107 then
    raise exception 'Expected 107 calculus-I problem types, found %', actual_count;
  end if;

  select count(*) into actual_count
  from content.problems problem
  where problem.book_id = target_book_id;
  if actual_count <> 386 then
    raise exception 'Expected 386 calculus-I problems, found %', actual_count;
  end if;

  create temporary table _calculus1_expected_types (
    unit_key text not null,
    type_number integer not null,
    canonical_name text not null,
    source_name_raw text not null,
    primary key (unit_key, type_number)
  ) on commit drop;

  insert into _calculus1_expected_types (
    unit_key, type_number, canonical_name, source_name_raw
  ) values
    ('p2-u01', 1, '유형1: x→a일 때의 함수의 수렴과 발산', '유형 01 x`! a일 때의 함수의 수렴과 발산'),
    ('p2-u01', 2, '유형2: x→∞, x→-∞일 때의 함수의 수렴과 발산', '유형 02 x`! E, x`! -E일 때의 함수의 수렴과 발산'),
    ('p2-u01', 3, '유형3: 그래프가 주어진 함수의 극한', '유형 03 그래프가 주어진 함수의 극한'),
    ('p2-u01', 4, '유형4: 함수의 극한값의 존재 ⑴', '유형 04 함수의 극한값의 존재 ⑴'),
    ('p2-u01', 5, '유형5: 함수의 극한값의 존재 ⑵', '유형 05 함수의 극한값의 존재 ⑵'),
    ('p2-u01', 6, '유형6: 합성함수의 극한', '유형 06 합성함수의 극한'),
    ('p2-u02', 1, '유형1: 함수의 극한에 대한 성질', '유형 01 함수의 극한에 대한 성질'),
    ('p2-u02', 2, '유형2: 0/0 꼴의 함수의 극한', '유형 02 0 0 꼴의 함수의 극한'),
    ('p2-u02', 3, '유형3: ∞/∞ 꼴의 함수의 극한', '유형 03 E E 꼴의 함수의 극한'),
    ('p2-u02', 4, '유형4: ∞-∞ 꼴의 함수의 극한', '유형 04 E-E 꼴의 함수의 극한'),
    ('p2-u02', 5, '유형5: ∞×0 꼴의 함수의 극한', '유형 05 E\0 꼴의 함수의 극한'),
    ('p2-u02', 6, '유형6: 극한값을 이용하여 미정계수 구하기', '유형 06 극한값을 이용하여 미정계수 구하기'),
    ('p2-u02', 7, '유형7: 극한값을 이용하여 함수의 식 구하기', '유형 07 극한값을 이용하여 함수의 식 구하기'),
    ('p2-u02', 8, '유형8: 함수의 극한의 대소 관계', '유형 08 함수의 극한의 대소 관계'),
    ('p2-u02', 9, '유형9: 함수의 극한의 활용', '유형 09 함수의 극한의 활용'),
    ('p2-u03', 1, '유형1: 함수의 연속과 불연속', '유형 01 함수의 연속과 불연속'),
    ('p2-u03', 2, '유형2: 함수의 그래프와 연속 ⑴', '유형 02 함수의 그래프와 연속 ⑴'),
    ('p2-u03', 3, '유형3: 함수의 그래프와 연속 ⑵', '유형 03 함수의 그래프와 연속 ⑵'),
    ('p2-u03', 4, '유형4: 함수가 연속일 조건', '유형 04 함수가 연속일 조건'),
    ('p2-u03', 5, '유형5: (x-a)f(x)=g(x) 꼴의 함수의 연속', '유형 05 {x-a}f{x}=g{x} 꼴의 함수의 연속'),
    ('p2-u03', 6, '유형6: 연속함수의 성질', '유형 06 연속함수의 성질'),
    ('p2-u03', 7, '유형7: 최대 · 최소 정리', '유형 07 최대 · 최소 정리'),
    ('p2-u03', 8, '유형8: 사잇값 정리', '유형 08 사잇값 정리'),
    ('p2-u04', 1, '유형1: 평균변화율과 미분계수', '유형 01 평균변화율과 미분계수'),
    ('p2-u04', 2, '유형2: 미분계수를 이용한 극한값의 계산 ⑴', '유형 02 미분계수를 이용한 극한값의 계산 ⑴'),
    ('p2-u04', 3, '유형3: 미분계수를 이용한 극한값의 계산 ⑵', '유형 03 미분계수를 이용한 극한값의 계산 ⑵'),
    ('p2-u04', 4, '유형4: 관계식이 주어진 경우의 미분계수', '유형 04 관계식이 주어진 경우의 미분계수'),
    ('p2-u04', 5, '유형5: 미분계수의 기하적 의미', '유형 05 미분계수의 기하적 의미'),
    ('p2-u04', 6, '유형6: 미분가능성과 연속성 ⑴', '유형 06 미분가능성과 연속성 ⑴'),
    ('p2-u04', 7, '유형7: 미분가능성과 연속성 ⑵', '유형 07 미분가능성과 연속성 ⑵'),
    ('p2-u05', 1, '유형1: 미분법', '유형 01 미분법'),
    ('p2-u05', 2, '유형2: 미분계수와 극한값', '유형 02 미분계수와 극한값'),
    ('p2-u05', 3, '유형3: 미분계수를 이용한 미정계수의 결정', '유형 03 미분계수를 이용한 미정계수의 결정'),
    ('p2-u05', 4, '유형4: 미분의 항등식에의 활용', '유형 04 미분의 항등식에의 활용'),
    ('p2-u05', 5, '유형5: 미분가능할 조건', '유형 05 미분가능할 조건'),
    ('p2-u05', 6, '유형6: 미분법과 다항식의 나눗셈', '유형 06 미분법과 다항식의 나눗셈'),
    ('p2-u06', 1, '유형1: 접선의 기울기', '유형 01 접선의 기울기'),
    ('p2-u06', 2, '유형2: 접점의 좌표가 주어진 접선의 방정식', '유형 02 접점의 좌표가 주어진 접선의 방정식'),
    ('p2-u06', 3, '유형3: 기울기가 주어진 접선의 방정식', '유형 03 기울기가 주어진 접선의 방정식'),
    ('p2-u06', 4, '유형4: 곡선 위에 있지 않은 한 점에서 그은 접선의 방정식', '유형 04 곡선 위에 있지 않은 한 점에서 그은 접선의 방정식'),
    ('p2-u06', 5, '유형5: 두 곡선에 공통인 접선', '유형 05 두 곡선에 공통인 접선'),
    ('p2-u06', 6, '유형6: 곡선 위의 점과 직선 사이의 거리', '유형 06 곡선 위의 점과 직선 사이의 거리'),
    ('p2-u06', 7, '유형7: 롤의 정리', '유형 07 롤의 정리'),
    ('p2-u06', 8, '유형8: 평균값 정리', '유형 08 평균값 정리'),
    ('p2-u07', 1, '유형1: 함수의 증가와 감소', '유형 01 함수의 증가와 감소'),
    ('p2-u07', 2, '유형2: 함수가 증가 또는 감소하기 위한 조건', '유형 02 함수가 증가 또는 감소하기 위한 조건'),
    ('p2-u07', 3, '유형3: 함수의 극대와 극소', '유형 03 함수의 극대와 극소'),
    ('p2-u07', 4, '유형4: 함수의 극대와 극소를 이용하여 미정계수 구하기', '유형 04 함수의 극대와 극소를 이용하여 미정계수 구하기'),
    ('p2-u07', 5, '유형5: 도함수의 그래프와 함수의 극값', '유형 05 도함수의 그래프와 함수의 극값'),
    ('p2-u08', 1, '유형1: 함수의 그래프', '유형 01 함수의 그래프'),
    ('p2-u08', 2, '유형2: 함수의 그래프 - 도함수의 그래프가 주어진 경우', '유형 02 함수의 그래프 - 도함수의 그래프가 주어진 경우'),
    ('p2-u08', 3, '유형3: 삼차함수가 극값을 가질 조건', '유형 03 삼차함수가 극값을 가질 조건'),
    ('p2-u08', 4, '유형4: 삼차함수가 주어진 구간에서 극값을 가질 조건', '유형 04 삼차함수가 주어진 구간에서 극값을 가질 조건'),
    ('p2-u08', 5, '유형5: 사차함수가 극값을 가질 조건', '유형 05 사차함수가 극값을 가질 조건'),
    ('p2-u08', 6, '유형6: 함수의 최댓값과 최솟값', '유형 06 함수의 최댓값과 최솟값'),
    ('p2-u08', 7, '유형7: 함수의 최댓값과 최솟값을 이용하여미정계수 구하기', '유형 07 함수의 최댓값과 최솟값을 이용하여 미정계수 구하기'),
    ('p2-u08', 8, '유형8: 함수의 최댓값과 최솟값의 활용 - 넓이', '유형 08 함수의 최댓값과 최솟값의 활용 - 넓이'),
    ('p2-u08', 9, '유형9: 함수의 최댓값과 최솟값의 활용 - 부피', '유형 09 함수의 최댓값과 최솟값의 활용 - 부피'),
    ('p2-u09', 1, '유형1: 방정식 f(x)=0의 실근의 개수', '유형 01 방정식 f{x}=0의 실근의 개수'),
    ('p2-u09', 2, '유형2: 방정식 f(x)=k의 실근의 개수', '유형 02 방정식 f{x}=k의 실근의 개수'),
    ('p2-u09', 3, '유형3: 방정식 f(x)=g(x)의 실근의 개수', '유형 03 방정식 f{x}=g{x}의 실근의 개수'),
    ('p2-u09', 4, '유형4: 방정식 f(x)=k의 실근의 부호', '유형 04 방정식 f{x}=k의 실근의 부호'),
    ('p2-u09', 5, '유형5: 극값을 이용한 삼차방정식의 근의 판별', '유형 05 극값을 이용한 삼차방정식의 근의 판별'),
    ('p2-u09', 6, '유형6: 모든 실수 x에 대하여 성립하는 부등식', '유형 06 모든 실수 x에 대하여 성립하는 부등식'),
    ('p2-u09', 7, '유형7: 주어진 구간에서 성립하는 부등식', '유형 07 주어진 구간에서 성립하는 부등식'),
    ('p2-u10', 1, '유형1: 수직선 위를 움직이는 점의 속도와 가속도', '유형 01 수직선 위를 움직이는 점의 속도와 가속도'),
    ('p2-u10', 2, '유형2: 수직선 위를 움직이는 점의 운동 방향', '유형 02 수직선 위를 움직이는 점의 운동 방향'),
    ('p2-u10', 3, '유형3: 위로 던진 물체의 속도와 가속도', '유형 03 위로 던진 물체의 속도와 가속도'),
    ('p2-u10', 4, '유형4: 위치, 속도의 그래프의 해석', '유형 04 위치, 속도의 그래프의 해석'),
    ('p2-u10', 5, '유형5: 시각에 대한 길이의 변화율', '유형 05 시각에 대한 길이의 변화율'),
    ('p2-u10', 6, '유형6: 시각에 대한 넓이, 부피의 변화율', '유형 06 시각에 대한 넓이, 부피의 변화율'),
    ('p2-u11', 1, '유형1: 부정적분의 정의', '유형 01 부정적분의 정의'),
    ('p2-u11', 2, '유형2: 부정적분과 미분의 관계 ⑴', '유형 02 부정적분과 미분의 관계 ⑴'),
    ('p2-u11', 3, '유형3: 부정적분의 계산', '유형 03 부정적분의 계산'),
    ('p2-u11', 4, '유형4: 도함수가 주어질 때, 함수 구하기', '유형 04 도함수가 주어질 때, 함수 구하기'),
    ('p2-u11', 5, '유형5: 부정적분과 접선의 기울기', '유형 05 부정적분과 접선의 기울기'),
    ('p2-u11', 6, '유형6: 함수와 그 부정적분 사이의 관계식이 주어질 때, 함수 구하기', '유형 06 함수와 그 부정적분 사이의 관계식이 주어질 때, 함수 구하기'),
    ('p2-u11', 7, '유형7: 부정적분과 미분의 관계 ⑵', '유형 07 부정적분과 미분의 관계 ⑵'),
    ('p2-u11', 8, '유형8: 부정적분과 함수의 연속', '유형 08 부정적분과 함수의 연속'),
    ('p2-u11', 9, '유형9: 부정적분과 함수의 극값', '유형 09 부정적분과 함수의 극값'),
    ('p2-u11', 10, '유형10: 도함수의 정의를 이용하여 함수 구하기', '유형 10 도함수의 정의를 이용하여 함수 구하기'),
    ('p2-u12', 1, '유형1: 부정적분과 정적분의 관계', '유형 01 부정적분과 정적분의 관계'),
    ('p2-u12', 2, '유형2: 정적분의 계산 ⑴', '유형 02 정적분의 계산 ⑴'),
    ('p2-u12', 3, '유형3: 정적분의 계산 ⑵', '유형 03 정적분의 계산 ⑵'),
    ('p2-u12', 4, '유형4: 구간에 따라 다르게 정의된 함수의 정적분', '유형 04 구간에 따라 다르게 정의된 함수의 정적분'),
    ('p2-u12', 5, '유형5: 절댓값 기호를 포함한 함수의 정적분', '유형 05 절댓값 기호를 포함한 함수의 정적분'),
    ('p2-u12', 6, '유형6: 정적분 ∫₋ₐᵃ xⁿ dx의 계산', '유형 06'),
    ('p2-u12', 7, '유형7: f(x+p)=f(x)를 만족시키는 함수 f(x)의 정적분', '유형 07 f{x+p}=f{x}를 만족시키는 함수 f{x}의 정적분'),
    ('p2-u13', 1, '유형1: 정적분을 포함한 등식 - 적분 구간이 상수인 경우', '유형 01 정적분을 포함한 등식 - 적분 구간이 상수인 경우'),
    ('p2-u13', 2, '유형2: 정적분을 포함한 등식 - 적분 구간에 변수가 있는 경우', '유형 02 정적분을 포함한 등식 - 적분 구간에 변수가 있는 경우'),
    ('p2-u13', 3, '유형3: 정적분을 포함한 등식 - 적분 구간과 피적분함수에 변수가 있는 경우', '유형 03 정적분을 포함한 등식 - 적분 구간과 피적분함수에 변수가 있는 경우'),
    ('p2-u13', 4, '유형4: 정적분으로 정의된 함수의 극대와 극소', '유형 04 정적분으로 정의된 함수의 극대와 극소'),
    ('p2-u13', 5, '유형5: 정적분으로 정의된 함수의 최댓값과 최솟값', '유형 05 정적분으로 정의된 함수의 최댓값과 최솟값'),
    ('p2-u13', 6, '유형6: 정적분으로 정의된 함수의 극한', '유형 06 정적분으로 정의된 함수의 극한'),
    ('p2-u14', 1, '유형1: 곡선과 x축 사이의 넓이', '유형 01 곡선과 x축 사이의 넓이'),
    ('p2-u14', 2, '유형2: 곡선과 직선 사이의 넓이', '유형 02 곡선과 직선 사이의 넓이'),
    ('p2-u14', 3, '유형3: 두 곡선 사이의 넓이', '유형 03 두 곡선 사이의 넓이'),
    ('p2-u14', 4, '유형4: 곡선과 접선으로 둘러싸인 도형의 넓이', '유형 04 곡선과 접선으로 둘러싸인 도형의 넓이'),
    ('p2-u14', 5, '유형5: 두 도형의 넓이가 같은 경우', '유형 05 두 도형의 넓이가 같은 경우'),
    ('p2-u14', 6, '유형6: 도형의 넓이를 이등분하는 경우', '유형 06 도형의 넓이를 이등분하는 경우'),
    ('p2-u14', 7, '유형7: 도형의 넓이의 최솟값', '유형 07 도형의 넓이의 최솟값'),
    ('p2-u14', 8, '유형8: 역함수의 그래프와 넓이', '유형 08 역함수의 그래프와 넓이'),
    ('p2-u14', 9, '유형9: 역함수의 정적분', '유형 09 역함수의 정적분'),
    ('p2-u14', 10, '유형10: 수직선 위를 움직이는 점의 위치와 움직인 거리 ⑴', '유형 10 수직선 위를 움직이는 점의 위치와 움직인 거리 ⑴'),
    ('p2-u14', 11, '유형11: 수직선 위를 움직이는 점의 위치와 움직인 거리 ⑵', '유형 11 수직선 위를 움직이는 점의 위치와 움직인 거리 ⑵'),
    ('p2-u14', 12, '유형12: 위로 던진 물체의 위치와 움직인 거리', '유형 12 위로 던진 물체의 위치와 움직인 거리'),
    ('p2-u14', 13, '유형13: 그래프에서의 위치와 움직인 거리', '유형 13 그래프에서의 위치와 움직인 거리');

  select count(*) into actual_count from _calculus1_expected_types;
  if actual_count <> 107 then
    raise exception 'Expected 107 canonical type definitions, found %', actual_count;
  end if;

  create temporary table _calculus1_type_map on commit drop as
  select
    problem_type.id as problem_type_id,
    unit_row.id as unit_id,
    expected.unit_key,
    expected.type_number,
    expected.canonical_name,
    expected.source_name_raw,
    (row_number() over (
      order by unit_row.sort_order, expected.type_number, problem_type.id
    ) - 1)::integer as canonical_sort_order
  from _calculus1_expected_types expected
  join content.units unit_row
    on unit_row.book_id = target_book_id
   and unit_row.unit_key = expected.unit_key
  join content.problem_types problem_type
    on problem_type.book_id = target_book_id
   and problem_type.unit_id = unit_row.id
   and substring(problem_type.name from '([0-9]+)')::integer = expected.type_number;

  select count(*) into actual_count from _calculus1_type_map;
  if actual_count <> 107 then
    raise exception 'Expected a one-to-one map for 107 problem types, found %', actual_count;
  end if;

  update content.problem_types problem_type
  set
    name = type_map.canonical_name,
    name_raw = type_map.source_name_raw,
    sort_order = type_map.canonical_sort_order,
    updated_at = changed_at
  from _calculus1_type_map type_map
  where problem_type.id = type_map.problem_type_id
    and (problem_type.name, problem_type.name_raw, problem_type.sort_order)
      is distinct from (
        type_map.canonical_name,
        type_map.source_name_raw,
        type_map.canonical_sort_order
      );

  if exists (
    select 1
    from _calculus1_type_map type_map
    join content.problem_types problem_type on problem_type.id = type_map.problem_type_id
    where (problem_type.name, problem_type.name_raw, problem_type.sort_order)
      is distinct from (
        type_map.canonical_name,
        type_map.source_name_raw,
        type_map.canonical_sort_order
      )
  ) then
    raise exception 'Canonical calculus-I problem type labels did not persist';
  end if;

  create temporary table _calculus1_reviewed_problem_ids (
    id text primary key
  ) on commit drop;

  insert into _calculus1_reviewed_problem_ids (id)
  select unnest(array[
    'gaeppul_high_calculus1_type::p2::14::2',
    'gaeppul_high_calculus1_type::p2::14::5',
    'gaeppul_high_calculus1_type::p2::15::8',
    'gaeppul_high_calculus1_type::p2::17::18',
    'gaeppul_high_calculus1_type::p2::18::23',
    'gaeppul_high_calculus1_type::p2::22::18',
    'gaeppul_high_calculus1_type::p2::22::19',
    'gaeppul_high_calculus1_type::p2::22::20',
    'gaeppul_high_calculus1_type::p2::23::21',
    'gaeppul_high_calculus1_type::p2::23::23',
    'gaeppul_high_calculus1_type::p2::33::36',
    'gaeppul_high_calculus1_type::p2::36::17',
    'gaeppul_high_calculus1_type::p2::36::18',
    'gaeppul_high_calculus1_type::p2::36::20',
    'gaeppul_high_calculus1_type::p2::36::21',
    'gaeppul_high_calculus1_type::p2::37::4',
    'gaeppul_high_calculus1_type::p2::39::15',
    'gaeppul_high_calculus1_type::p2::42::3',
    'gaeppul_high_calculus1_type::p2::43::8',
    'gaeppul_high_calculus1_type::p2::45::21',
    'gaeppul_high_calculus1_type::p2::46::1',
    'gaeppul_high_calculus1_type::p2::46::2',
    'gaeppul_high_calculus1_type::p2::46::4',
    'gaeppul_high_calculus1_type::p2::46::5',
    'gaeppul_high_calculus1_type::p2::46::7',
    'gaeppul_high_calculus1_type::p2::47::11',
    'gaeppul_high_calculus1_type::p2::47::12',
    'gaeppul_high_calculus1_type::p2::5::9',
    'gaeppul_high_calculus1_type::p2::53::27',
    'gaeppul_high_calculus1_type::p2::54::29',
    'gaeppul_high_calculus1_type::p2::55::3',
    'gaeppul_high_calculus1_type::p2::6::14',
    'gaeppul_high_calculus1_type::p2::6::15',
    'gaeppul_high_calculus1_type::p2::61::13',
    'gaeppul_high_calculus1_type::p2::62::17',
    'gaeppul_high_calculus1_type::p2::64::7',
    'gaeppul_high_calculus1_type::p2::65::10',
    'gaeppul_high_calculus1_type::p2::66::20',
    'gaeppul_high_calculus1_type::p2::67::24',
    'gaeppul_high_calculus1_type::p2::68::30',
    'gaeppul_high_calculus1_type::p2::68::31',
    'gaeppul_high_calculus1_type::p2::69::34',
    'gaeppul_high_calculus1_type::p2::69::35',
    'gaeppul_high_calculus1_type::p2::7::1',
    'gaeppul_high_calculus1_type::p2::70::41',
    'gaeppul_high_calculus1_type::p2::70::42',
    'gaeppul_high_calculus1_type::p2::70::43',
    'gaeppul_high_calculus1_type::p2::8::11'
  ]::text[]);

  select count(*) into actual_count from _calculus1_reviewed_problem_ids;
  if actual_count <> 48 then
    raise exception 'Expected 48 reviewed problem IDs, found %', actual_count;
  end if;

  if exists (
    select 1
    from _calculus1_reviewed_problem_ids reviewed
    left join content.problems problem
      on problem.id = reviewed.id
     and problem.book_id = target_book_id
    where problem.id is null
  ) then
    raise exception 'A reviewed calculus-I problem is absent from content.problems';
  end if;

  if exists (
    select 1
    from content.problems problem
    where problem.book_id = target_book_id
      and not problem.verified
      and not exists (
        select 1
        from _calculus1_reviewed_problem_ids reviewed
        where reviewed.id = problem.id
      )
  ) then
    raise exception 'The unverified calculus-I set differs from the audited 48-problem set';
  end if;

  if exists (
    select 1
    from _calculus1_reviewed_problem_ids reviewed
    join content.problems problem on problem.id = reviewed.id
    where jsonb_typeof(problem.answer_key) <> 'object'
       or problem.answer_key->>'type' <> 'choice'
       or problem.answer_key->>'normalized' !~ '^[1-5]$'
       or nullif(problem.answer_key->>'choice_count', '')::integer <> 5
       or problem.image_path is null
       or not exists (
         select 1 from content.assets asset where asset.problem_id = problem.id
       )
       or not exists (
         select 1
         from storage.objects storage_object
         where storage_object.bucket_id = 'problem-images'
           and storage_object.name = problem.image_path
       )
  ) then
    raise exception 'A reviewed calculus-I problem lacks a valid answer or image asset';
  end if;

  if to_regprocedure('content.problem_public_payload(jsonb)') is null then
    raise exception 'content.problem_public_payload(jsonb) is required for fixture sync';
  end if;

  -- Keep the legacy answer column and the public shape aligned with the
  -- already-reviewed answer_key for every stable problem ID.
  update content.problems problem
  set
    answer = problem.answer_key,
    public_payload = content.problem_public_payload(problem.answer_key),
    updated_at = changed_at
  where problem.book_id = target_book_id
    and (
      problem.answer is distinct from problem.answer_key
      or problem.public_payload is distinct from content.problem_public_payload(problem.answer_key)
    );

  update content.problems problem
  set
    verified = true,
    metadata = (
      problem.metadata
      - 'answer_validation_status'
      - 'answer_confidence'
      - 'answer_override_note'
    ) || jsonb_build_object(
      'answer_source', jsonb_build_object(
        'method', 'inline_blue_answer',
        'verified', true,
        'review', 'automatic',
        'fixture_exported_at', '2026-07-11T10:30:17.741Z'
      ),
      'source_pdf_sha256', '051A36B9F336D4ABF4F281E61F3E77D0D852BAAF50297B01EF6846C9D7AB3A26',
      'verification_repair', 'gaeppul-high-calculus1-reviewed-fixture-v1',
      'verification_repaired_at', changed_at
    ),
    updated_at = changed_at
  from _calculus1_reviewed_problem_ids reviewed
  where problem.id = reviewed.id
    and (
      not problem.verified
      or problem.metadata->>'verification_repair'
        is distinct from 'gaeppul-high-calculus1-reviewed-fixture-v1'
    );

  -- The earlier split-type merge kept page-local positions (1,2,3) for both
  -- fragments. Recompute every position from the stable printed order.
  create temporary table _calculus1_expected_positions on commit drop as
  select
    problem.id,
    row_number() over (
      partition by problem.problem_type_id
      order by problem.page_printed, problem.number::integer, problem.id
    )::integer as expected_position
  from content.problems problem
  where problem.book_id = target_book_id;

  update content.problems problem
  set
    position_in_type = expected.expected_position,
    updated_at = changed_at
  from _calculus1_expected_positions expected
  where problem.id = expected.id
    and problem.position_in_type is distinct from expected.expected_position;

  update content.books book
  set
    title = '개념플러스유형 고등 미적분Ⅰ 유형편',
    pipeline_version = 'crop-trainer:gaeppul_high_calculus1_type_v1',
    metadata = book.metadata || jsonb_build_object(
      'fixture_sync', 'gaeppul-high-calculus1-reviewed-fixture-v1',
      'fixture_exported_at', '2026-07-11T10:30:17.741Z',
      'fixture_source_pdf_sha256', '051A36B9F336D4ABF4F281E61F3E77D0D852BAAF50297B01EF6846C9D7AB3A26',
      'fixture_synced_at', changed_at
    ),
    updated_at = changed_at
  where book.id = target_book_id;

  if exists (
    select 1
    from content.problems problem
    where problem.book_id = target_book_id
      and (
        not problem.verified
        or problem.answer is distinct from problem.answer_key
        or problem.public_payload is distinct from content.problem_public_payload(problem.answer_key)
      )
  ) then
    raise exception 'A calculus-I problem remains unpublished or answer-inconsistent';
  end if;

  if exists (
    select 1
    from _calculus1_expected_positions expected
    join content.problems problem on problem.id = expected.id
    where problem.position_in_type is distinct from expected.expected_position
  ) then
    raise exception 'A calculus-I type still has a non-contiguous problem position';
  end if;

  if (
    select array_agg(problem.number::integer order by problem.position_in_type)
    from content.problems problem
    join content.units unit_row on unit_row.id = problem.unit_id
    join content.problem_types problem_type on problem_type.id = problem.problem_type_id
    where problem.book_id = target_book_id
      and unit_row.unit_key = 'p2-u03'
      and problem_type.name = '유형1: 함수의 연속과 불연속'
  ) is distinct from array[1, 2, 3, 4, 5] then
    raise exception 'Continuity type 1 does not contain problems 1 through 5';
  end if;

  if not exists (
    select 1
    from content.problems problem
    join content.units unit_row on unit_row.id = problem.unit_id
    join content.problem_types problem_type on problem_type.id = problem.problem_type_id
    where problem.book_id = target_book_id
      and unit_row.unit_key = 'p2-u03'
      and problem_type.name = '유형3: 함수의 그래프와 연속 ⑵'
      and problem.number = '8'
      and problem.verified
  ) then
    raise exception 'Continuity type 3 problem 8 is still absent';
  end if;
end;
$migration$;
