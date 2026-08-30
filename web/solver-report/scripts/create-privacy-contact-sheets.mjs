import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const inputRoot = resolve(process.env.SOLVER_REPORT_INPUT_ROOT ?? process.cwd())
const appRoot = process.env.DESIRECORE_APP_ROOT
if (!appRoot) throw new Error('DESIRECORE_APP_ROOT is required')
const reviewRoot = process.env.SOLVER_REPORT_PRIVACY_REVIEW_ROOT
if (!reviewRoot) throw new Error('SOLVER_REPORT_PRIVACY_REVIEW_ROOT is required')
const outputRoot = resolve(reviewRoot)
const requireFromApp = createRequire(join(resolve(appRoot), 'package.json'))
const sharp = requireFromApp('sharp')
const plan = JSON.parse(readFileSync(join(inputRoot, 'evidence', 'screenshots', 'screenshot-plan.json'), 'utf8'))

const entries = plan.scenarios.flatMap((scenario) =>
  scenario.screenshots.map((screenshot, index) => ({
    scenarioId: scenario.scenarioId,
    index: index + 1,
    file: screenshot.file,
    sha256: screenshot.sha256,
  }))
)
const columns = 5
const rows = 6
const tileWidth = 240
const tileHeight = 175
const imageHeight = 145
const perSheet = columns * rows
const escapeXml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char])

mkdirSync(outputRoot, { recursive: true })
const sheets = []
for (let offset = 0; offset < entries.length; offset += perSheet) {
  const page = entries.slice(offset, offset + perSheet)
  const tiles = []
  for (const entry of page) {
    const preview = await sharp(join(inputRoot, entry.file))
      .resize({ width: tileWidth, height: imageHeight, fit: 'contain', background: '#0b1120' })
      .png()
      .toBuffer()
    const label = `${entry.scenarioId} · ${entry.index} · ${entry.sha256.slice(0, 10)}`
    const tile = await sharp({
      create: { width: tileWidth, height: tileHeight, channels: 4, background: '#111a2d' },
    })
      .composite([
        { input: preview, left: 0, top: 0 },
        {
          input: Buffer.from(
            `<svg width="${tileWidth}" height="30"><rect width="100%" height="100%" fill="#18243b"/><text x="8" y="19" fill="#dce7f4" font-family="Arial, sans-serif" font-size="10">${escapeXml(label)}</text></svg>`
          ),
          left: 0,
          top: imageHeight,
        },
      ])
      .png()
      .toBuffer()
    const position = tiles.length
    tiles.push({ input: tile, left: (position % columns) * tileWidth, top: Math.floor(position / columns) * tileHeight })
  }
  const file = `contact-sheet-${String(sheets.length + 1).padStart(2, '0')}.png`
  await sharp({
    create: { width: columns * tileWidth, height: rows * tileHeight, channels: 4, background: '#080d18' },
  })
    .composite(tiles)
    .png()
    .toFile(join(outputRoot, file))
  sheets.push({ file, entries: page })
}

writeFileSync(
  join(outputRoot, 'review-index.json'),
  `${JSON.stringify({ schemaVersion: 'solver.privacy-contact-sheets/v1', screenshots: entries.length, sheets }, null, 2)}\n`
)
console.log(JSON.stringify({ outputRoot, screenshots: entries.length, sheets: sheets.length }, null, 2))
