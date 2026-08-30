import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('..', import.meta.url)))
const html = readFileSync(join(root, 'source', 'index.html'), 'utf8')
const css = readFileSync(join(root, 'source', 'report.css'), 'utf8')
const javascript = readFileSync(join(root, 'source', 'report.js'), 'utf8')
const builder = readFileSync(join(root, 'scripts', 'build-report-web.mjs'), 'utf8')
const ocrValidator = readFileSync(join(root, 'scripts', 'validate-screenshot-privacy-ocr.mjs'), 'utf8')
const deploymentValidator = readFileSync(join(root, 'scripts', 'validate-deployed-report.mjs'), 'utf8')
const attestationSchema = JSON.parse(
  readFileSync(join(root, 'public-release-attestation.schema.json'), 'utf8')
)

test('图片查看器暴露完整的可访问缩放控制', () => {
  for (const id of [
    'lightbox-stage',
    'lightbox-canvas',
    'lightbox-zoom-out',
    'lightbox-zoom',
    'lightbox-zoom-in',
    'lightbox-fit',
    'lightbox-actual',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`))
  }
  assert.match(html, /aria-live="polite"/)
  assert.match(html, /aria-describedby="lightbox-zoom-hint"/)
  assert.match(javascript, /<button type="button" class="shot"/)
  assert.match(javascript, /aria-haspopup="dialog"/)
  assert.match(javascript, /event\.preventDefault\(\)/)
})

test('图片查看器实现按钮、键盘、滚轮、双击和触控指针路径', () => {
  assert.match(javascript, /lightbox-zoom-in/)
  assert.match(javascript, /event\.key === '\+'/)
  assert.match(javascript, /addEventListener\(\s*'wheel'/)
  assert.match(javascript, /addEventListener\('dblclick'/)
  assert.match(javascript, /addEventListener\('pointerdown'/)
  assert.match(javascript, /viewer\.pointers\.size === 2/)
  assert.match(javascript, /viewer\.pointers\.size >= 2/)
  assert.match(javascript, /lostpointercapture/)
  assert.match(javascript, /MIN_VIEWER_ZOOM/)
  assert.match(javascript, /MAX_VIEWER_ZOOM/)
})

test('响应式样式约束全屏查看器且允许平移', () => {
  assert.match(css, /\.lightbox-stage\.is-pannable/)
  assert.match(css, /touch-action:\s*none/)
  assert.match(css, /width:\s*100vw/)
  assert.match(css, /height:\s*100dvh/)
})

test('构建器从 Agent 仓库读取代码、从显式目录读取证据', () => {
  assert.match(builder, /SOLVER_REPORT_INPUT_ROOT/)
  assert.match(builder, /SOLVER_REPORT_OUTPUT_ROOT/)
  assert.match(builder, /const sourceRoot = join\(codeRoot, 'source'\)/)
  assert.match(builder, /loadPublicReleaseAttestation/)
  assert.match(builder, /ajv\.compile/)
  assert.match(builder, /solver\.public-screenshot-plan\/v1/)
  assert.match(builder, /screenshot\.sourceSha256 !== sourceScenario\.screenshots\[index\]\.sha256/)
  assert.match(builder, /historicalBuildManifest\.skill\?\.version/)
  assert.match(builder, /representativeStabilityPasses = stabilityMatrix\.groups/)
  assert.doesNotMatch([html, css, javascript, builder].join('\n'), /\/Users\/|\/Volumes\//)
})

test('公开发布证明 Schema 自描述关键边界', () => {
  assert.equal(attestationSchema.$schema, 'http://json-schema.org/draft-07/schema#')
  assert.match(attestationSchema.description, /public-release privacy review/)
  for (const field of Object.values(attestationSchema.properties)) assert.ok(field.description || field.type === 'object')
})

test('截图隐私审计绑定全部原图哈希并复用公开文本策略', () => {
  assert.match(ocrValidator, /planned\.length !== 174/)
  assert.match(ocrValidator, /actualSha256 !== expected\.sha256/)
  assert.match(ocrValidator, /assertPublicText\(text/)
})

test('公网验证器拒绝 HTTP 重定向后才读取响应', () => {
  assert.match(deploymentValidator, /redirect:\s*'manual'/)
  assert.match(deploymentValidator, /response\.status >= 300 && response\.status < 400/)
  assert.equal([...deploymentValidator.matchAll(/\bfetch\(/g)].length, 1)
})
