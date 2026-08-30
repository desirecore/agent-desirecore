import { createRequire } from 'node:module'
import { cpSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { canonical, publicTextViolations, sha256 } from './public-release-policy.mjs'

const inputRoot = resolve(process.env.SOLVER_REPORT_INPUT_ROOT ?? process.cwd())
const appRoot = process.env.DESIRECORE_APP_ROOT
const ocrFile = process.env.SOLVER_REPORT_SCREENSHOT_OCR_FILE
if (!appRoot) throw new Error('DESIRECORE_APP_ROOT is required')
if (!ocrFile) throw new Error('SOLVER_REPORT_SCREENSHOT_OCR_FILE is required')
const requireFromApp = createRequire(join(resolve(appRoot), 'package.json'))
const sharp = requireFromApp('sharp')
const planFile = join(inputRoot, 'evidence', 'screenshots', 'screenshot-plan.json')
const outputPlanFile = join(inputRoot, 'evidence', 'screenshots', 'public-screenshot-plan.json')
const outputRoot = join(inputRoot, 'evidence', 'screenshots', 'public-redacted')
const sourcePlan = JSON.parse(readFileSync(planFile, 'utf8'))
const ocr = JSON.parse(readFileSync(ocrFile, 'utf8'))
const sourceScreenshots = sourcePlan.scenarios.flatMap((scenario) =>
  scenario.screenshots.map((screenshot) => ({ scenarioId: scenario.scenarioId, ...screenshot }))
)
if (ocr.schemaVersion !== 'solver.screenshot-privacy-ocr/v1' || ocr.entries.length !== sourceScreenshots.length) {
  throw new Error('OCR result does not cover the source screenshot plan')
}

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value))
const overlaps = (left, right) =>
  left.left <= right.left + right.width &&
  right.left <= left.left + left.width &&
  left.top <= right.top + right.height &&
  right.top <= left.top + left.height
const mergeRegions = (regions) => {
  const merged = []
  for (const region of regions) {
    const existing = merged.find((candidate) => overlaps(candidate, region))
    if (!existing) {
      merged.push({ ...region })
      continue
    }
    const right = Math.max(existing.left + existing.width, region.left + region.width)
    const bottom = Math.max(existing.top + existing.height, region.top + region.height)
    existing.left = Math.min(existing.left, region.left)
    existing.top = Math.min(existing.top, region.top)
    existing.width = right - existing.left
    existing.height = bottom - existing.top
  }
  return merged
}

let redactedScreenshots = 0
let redactionRegions = 0
const publicByFile = new Map()
for (const [index, source] of sourceScreenshots.entries()) {
  const ocrEntry = ocr.entries[index]
  const sourceFile = join(inputRoot, source.file)
  if (
    ocrEntry?.scenarioId !== source.scenarioId ||
    ocrEntry?.file !== source.file ||
    sha256(readFileSync(sourceFile)) !== source.sha256
  ) {
    throw new Error(`${source.file}: OCR source identity differs from screenshot plan`)
  }
  const metadata = await sharp(sourceFile).metadata()
  if (metadata.width !== source.width || metadata.height !== source.height) {
    throw new Error(`${source.file}: source dimensions differ from screenshot plan`)
  }
  const proposedRegions = ocrEntry.lines
    .filter((line) => publicTextViolations(line.text).length > 0)
    .map((line) => {
      const [x, y, width, height] = line.boundingBox
      const left = clamp(Math.floor(x * source.width) - 12, 0, source.width - 1)
      const top = clamp(Math.floor((1 - y - height) * source.height) - 8, 0, source.height - 1)
      const right = clamp(Math.ceil((x + width) * source.width) + 12, left + 1, source.width)
      const bottom = clamp(Math.ceil((1 - y) * source.height) + Math.ceil(height * source.height * 1.2) + 8, top + 1, source.height)
      return { left, top, width: right - left, height: bottom - top, reason: 'private-path' }
    })
  const regions = mergeRegions(proposedRegions)
  const targetRelative = `evidence/screenshots/public-redacted/${source.scenarioId}/${basename(source.file)}`
  const targetFile = join(inputRoot, targetRelative)
  if (relative(outputRoot, targetFile).startsWith('..')) throw new Error(`${targetRelative}: unsafe public screenshot target`)
  mkdirSync(dirname(targetFile), { recursive: true })
  if (regions.length === 0) cpSync(sourceFile, targetFile)
  else {
    await sharp(sourceFile)
      .composite(
        regions.map((region) => ({
          input: {
            create: {
              width: region.width,
              height: region.height,
              channels: 4,
              background: { r: 32, g: 34, b: 39, alpha: 1 },
            },
          },
          left: region.left,
          top: region.top,
        }))
      )
      .png()
      .toFile(targetFile)
    redactedScreenshots += 1
    redactionRegions += regions.length
  }
  publicByFile.set(source.file, {
    file: targetRelative,
    sha256: sha256(readFileSync(targetFile)),
    width: source.width,
    height: source.height,
    sourceSha256: source.sha256,
    redactions: regions,
  })
}

const publicPlan = {
  schemaVersion: 'solver.public-screenshot-plan/v1',
  generatedAt: new Date().toISOString(),
  sourcePlanSha256: sha256(canonical(sourcePlan)),
  derivation: {
    method: 'Apple Vision exact-line private-path masking',
    redactedScreenshots,
    redactionRegions,
  },
  scenarios: sourcePlan.scenarios.map((scenario) => ({
    ...scenario,
    screenshots: scenario.screenshots.map((screenshot) => publicByFile.get(screenshot.file)),
  })),
}
writeFileSync(outputPlanFile, `${JSON.stringify(publicPlan, null, 2)}\n`)
console.log(
  JSON.stringify(
    {
      outputPlanFile,
      screenshots: sourceScreenshots.length,
      redactedScreenshots,
      redactionRegions,
      bytes: sourceScreenshots.reduce(
        (total, screenshot) => total + statSync(join(inputRoot, publicByFile.get(screenshot.file).file)).size,
        0
      ),
    },
    null,
    2
  )
)
