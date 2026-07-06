#!/usr/bin/env node

import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = normalizeBaseUrl(process.env.LMS_SMOKE_BASE_URL || 'http://localhost:3102');
const loginId = process.env.LMS_SMOKE_LOGIN_ID || 'admin';
const password = process.env.LMS_SMOKE_PASSWORD || '1234';
const academyId = process.env.LMS_SMOKE_ACADEMY_ID || '2da7ffc5-9582-4056-8a7c-26b179878b55';
const startDate = process.env.LMS_SMOKE_START_DATE || '2026-07-01';
const endDate = process.env.LMS_SMOKE_END_DATE || '2026-07-31';
const browserChannel = process.env.LMS_SMOKE_BROWSER_CHANNEL || 'chrome';
const headless = process.env.LMS_SMOKE_HEADLESS !== 'false';

const minimums = {
  classes: readIntEnv('LMS_SMOKE_MIN_CLASSES', 1),
  books: readIntEnv('LMS_SMOKE_MIN_BOOKS', 3),
  students: readIntEnv('LMS_SMOKE_MIN_STUDENTS', 4),
  baseFeeContracts: readIntEnv('LMS_SMOKE_MIN_BASE_FEE_CONTRACTS', 4),
  classStudents: readIntEnv('LMS_SMOKE_MIN_CLASS_STUDENTS', 1),
};

const pages = ['/', '/classrooms', '/students', '/instructors', '/accounting', '/settings'];
const fatalPagePatterns = [
  /Application error/i,
  /Unhandled Runtime Error/i,
  /Dashboard loading failed/i,
  /Class overview loading failed/i,
  /Student loading failed/i,
  /Staff loading failed/i,
  /Accounting loading failed/i,
  /Academy loading failed/i,
  /permission denied/i,
  /relation .* does not exist/i,
  /infinite recursion/i,
  /PostgREST/i,
  /Failed to fetch/i,
  /NetworkError/i,
];

let browser;
let page;

main().catch(async (error) => {
  console.error(`[lms-smoke] failed: ${error instanceof Error ? error.message : String(error)}`);
  await captureFailureScreenshot();
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
});

async function main() {
  console.log(`[lms-smoke] baseUrl=${baseUrl}`);
  console.log(`[lms-smoke] browserChannel=${browserChannel}`);

  browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  page = await context.newPage();

  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await login();
  await verifyPages(pageErrors);
  await verifyApiContract();
  console.log('[lms-smoke] passed');
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: browserChannel, headless });
  } catch (error) {
    if (browserChannel) {
      console.warn(`[lms-smoke] could not launch channel=${browserChannel}; falling back to bundled chromium`);
      return chromium.launch({ headless });
    }
    throw error;
  }
}

async function login() {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#login-id').fill(loginId);
  await page.locator('#password').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname !== '/login', { timeout: 20000 });

  assert(new URL(page.url()).pathname !== '/login', 'login did not leave /login');
  console.log(`[lms-smoke] logged in as ${loginId}`);
}

async function verifyPages(pageErrors) {
  for (const path of pages) {
    pageErrors.length = 0;
    await page.goto(toUrl(path), { waitUntil: 'domcontentloaded' });
    await settlePage();

    const state = await page.evaluate(() => ({
      pathname: location.pathname,
      title: document.title,
      text: (document.body && document.body.innerText ? document.body.innerText : '').slice(0, 50000),
    }));

    assert(state.pathname === path, `${path} redirected to ${state.pathname}`);
    assert(pageErrors.length === 0, `${path} raised page errors: ${pageErrors.join(' | ')}`);

    const fatalPattern = fatalPagePatterns.find((pattern) => pattern.test(state.text));
    assert(!fatalPattern, `${path} rendered fatal text matching ${fatalPattern}`);
    assert(state.text.trim().length > 0, `${path} rendered an empty page`);

    console.log(`[lms-smoke] page ok ${path}`);
  }
}

async function verifyApiContract() {
  await page.goto(toUrl('/'), { waitUntil: 'domcontentloaded' });
  await settlePage();

  const api = await page.evaluate(async ({ academyId, startDate, endDate }) => {
    async function readJson(url) {
      const response = await fetch(url, { credentials: 'same-origin' });
      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = { parseError: text.slice(0, 500) };
      }
      return { status: response.status, body };
    }

    const overviewParams = new URLSearchParams({ academyId, startDate, endDate });
    const studentsParams = new URLSearchParams({ academyId });
    const [overview, students] = await Promise.all([
      readJson('/api/lms/classes/overview?' + overviewParams.toString()),
      readJson('/api/lms/students?' + studentsParams.toString()),
    ]);

    const classes = Array.isArray(overview.body?.data?.classes) ? overview.body.data.classes : [];
    const books = Array.isArray(overview.body?.data?.books) ? overview.body.data.books : [];
    const studentRows = Array.isArray(students.body?.data?.students) ? students.body.data.students : [];

    return {
      overviewStatus: overview.status,
      overviewSuccess: overview.body?.success === true,
      overviewError: overview.body?.error || overview.body?.parseError || null,
      studentsStatus: students.status,
      studentsSuccess: students.body?.success === true,
      studentsError: students.body?.error || students.body?.parseError || null,
      classCount: classes.length,
      bookCount: books.length,
      maxClassStudentCount: classes.reduce((max, row) => Math.max(max, Number(row.studentCount || 0)), 0),
      studentCount: studentRows.length,
      baseFeeContractCount: studentRows.filter((row) => Number(row.baseMonthlyFee || 0) === 0).length,
    };
  }, { academyId, startDate, endDate });

  assert(api.overviewStatus === 200 && api.overviewSuccess === true, `class overview API failed: ${JSON.stringify(api)}`);
  assert(api.studentsStatus === 200 && api.studentsSuccess === true, `students API failed: ${JSON.stringify(api)}`);
  assert(api.classCount >= minimums.classes, `expected at least ${minimums.classes} classes, got ${api.classCount}`);
  assert(api.bookCount >= minimums.books, `expected at least ${minimums.books} books, got ${api.bookCount}`);
  assert(api.studentCount >= minimums.students, `expected at least ${minimums.students} students, got ${api.studentCount}`);
  assert(
    api.baseFeeContractCount >= minimums.baseFeeContracts,
    `expected at least ${minimums.baseFeeContracts} base-fee contracts, got ${api.baseFeeContractCount}`,
  );
  assert(
    api.maxClassStudentCount >= minimums.classStudents,
    `expected a class with at least ${minimums.classStudents} students, got max ${api.maxClassStudentCount}`,
  );

  console.log(
    `[lms-smoke] API ok classes=${api.classCount} books=${api.bookCount} students=${api.studentCount} baseFeeContracts=${api.baseFeeContractCount}`,
  );
}

async function settlePage() {
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

async function captureFailureScreenshot() {
  if (!page) return;
  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/lms-smoke-failure.png', fullPage: true }).catch(() => {});
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, '');
}

function toUrl(path) {
  return `${baseUrl}${path}`;
}

function readIntEnv(name, fallback) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
