import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { assertPublicText, canonical, sha256 } from './public-release-policy.mjs'

const inputRoot = resolve(process.env.SOLVER_REPORT_INPUT_ROOT ?? process.cwd())
const planFile =
  process.env.SOLVER_REPORT_SCREENSHOT_PLAN_FILE ??
  join(inputRoot, 'evidence', 'screenshots', 'screenshot-plan.json')
const ocrFile = process.env.SOLVER_REPORT_SCREENSHOT_OCR_FILE
if (!ocrFile) throw new Error('SOLVER_REPORT_SCREENSHOT_OCR_FILE is required')
const validationFile = process.env.SOLVER_REPORT_SCREENSHOT_OCR_VALIDATION_FILE
if (!validationFile) throw new Error('SOLVER_REPORT_SCREENSHOT_OCR_VALIDATION_FILE is required')

const plan = JSON.parse(readFileSync(planFile, 'utf8'))
const ocr = JSON.parse(readFileSync(ocrFile, 'utf8'))
if (ocr.schemaVersion !== 'solver.screenshot-privacy-ocr/v1' || !Array.isArray(ocr.entries)) {
  throw new Error('unsupported screenshot OCR result')
}

const planned = plan.scenarios.flatMap((scenario) =>
  scenario.screenshots.map((screenshot) => ({ scenarioId: scenario.scenarioId, ...screenshot }))
)
if (planned.length !== 174 || ocr.entries.length !== planned.length) {
  throw new Error(`screenshot OCR coverage mismatch: expected ${planned.length}, received ${ocr.entries.length}`)
}

const failures = []
const screenshotRootEntries = []
let recognizedLines = 0
let screenshotsWithText = 0
for (const [index, expected] of planned.entries()) {
  const actual = ocr.entries[index]
  const imageFile = join(inputRoot, expected.file)
  if (!existsSync(imageFile)) failures.push({ file: expected.file, issue: 'missing-image' })
  const actualSha256 = existsSync(imageFile) ? sha256(readFileSync(imageFile)) : null
  if (
    actual?.scenarioId !== expected.scenarioId ||
    actual?.file !== expected.file ||
    actualSha256 !== expected.sha256 ||
    !Array.isArray(actual?.lines) ||
    actual.lines.some((line) => typeof line?.text !== 'string' || !Array.isArray(line?.boundingBox))
  ) {
    failures.push({ file: expected.file, issue: 'plan-or-hash-mismatch' })
    continue
  }
  const text = actual.lines.map((line) => line.text).join('\n')
  recognizedLines += actual.lines.length
  if (actual.lines.length > 0) screenshotsWithText += 1
  try {
    assertPublicText(text, `${expected.scenarioId} screenshot OCR`)
  } catch (error) {
    failures.push({ file: expected.file, issue: 'sensitive-text-policy', detail: error.message })
  }
  screenshotRootEntries.push({
    scenarioId: expected.scenarioId,
    file: expected.file,
    sha256: expected.sha256,
    width: expected.width,
    height: expected.height,
  })
}

const report = {
  schemaVersion: 'solver.screenshot-privacy-validation/v1',
  auditedAt: new Date().toISOString(),
  screenshotPlanSha256: sha256(canonical(plan)),
  screenshotContentRootSha256: sha256(canonical(screenshotRootEntries)),
  screenshots: planned.length,
  ocr: {
    engine: ocr.engine,
    screenshotsWithText,
    recognizedLines,
    sensitiveMatches: failures.filter((failure) => failure.issue === 'sensitive-text-policy').length,
  },
  passed: failures.length === 0 && screenshotsWithText === planned.length,
  failures,
}
writeFileSync(validationFile, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
if (!report.passed) process.exitCode = 1
