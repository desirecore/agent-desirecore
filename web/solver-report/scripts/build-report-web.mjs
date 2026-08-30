import { createRequire } from 'node:module'
import { cpSync, existsSync, globSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertPublicText,
  canonical,
  computePublicEvidenceRoots,
  loadPublicReleaseAttestation,
  projectPublicProvenance,
  resolveSafeOutputRoot,
  sha256,
} from './public-release-policy.mjs'

const codeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const inputRoot = resolve(process.env.SOLVER_REPORT_INPUT_ROOT ?? process.env.BUILDER_ROOT ?? process.cwd())
const configuredAppRoot = process.env.DESIRECORE_APP_ROOT
if (!configuredAppRoot) throw new Error('DESIRECORE_APP_ROOT is required')
const appRoot = resolve(configuredAppRoot)
const requireFromApp = createRequire(join(appRoot, 'package.json'))
const { marked } = requireFromApp('marked')
const katex = requireFromApp('katex')
const sharp = requireFromApp('sharp')
const Ajv = requireFromApp('ajv').default
const addFormats = requireFromApp('ajv-formats').default
const ajv = new Ajv({ allErrors: true, strict: true })
addFormats(ajv)
const validatePublicReleaseAttestationSchema = ajv.compile(
  JSON.parse(readFileSync(join(codeRoot, 'public-release-attestation.schema.json'), 'utf8'))
)

const outputRoot = resolveSafeOutputRoot({
  inputRoot,
  codeRoot,
  appRoot,
  requestedOutputRoot: process.env.SOLVER_REPORT_OUTPUT_ROOT ?? join(inputRoot, 'report-web', 'dist'),
})
const sourceRoot = join(codeRoot, 'source')
const sourceScreenshotPlan = JSON.parse(
  readFileSync(join(inputRoot, 'evidence', 'screenshots', 'screenshot-plan.json'), 'utf8')
)
const publicScreenshotPlanFile =
  process.env.SOLVER_REPORT_PUBLIC_SCREENSHOT_PLAN_FILE ??
  join(inputRoot, 'evidence', 'screenshots', 'public-screenshot-plan.json')
const screenshotPlan = JSON.parse(readFileSync(publicScreenshotPlanFile, 'utf8'))
const screenshotValidation = JSON.parse(
  readFileSync(join(inputRoot, 'evidence', 'screenshots', 'screenshot-validation.json'), 'utf8')
)
const screenshotPrivacyValidation = JSON.parse(
  readFileSync(
    process.env.SOLVER_REPORT_SCREENSHOT_PRIVACY_VALIDATION_FILE ??
      join(inputRoot, 'evidence', 'screenshots', 'public-screenshot-privacy-validation.json'),
    'utf8'
  )
)
const historicalBuildManifest = JSON.parse(readFileSync(join(inputRoot, 'build-manifest.json'), 'utf8'))
const stabilityMatrix = JSON.parse(readFileSync(join(inputRoot, 'evidence', 'stability', 'stability-matrix.json'), 'utf8'))
if (!screenshotValidation.passed || !stabilityMatrix.passed)
  throw new Error('M8 evidence gates must pass before Web build')
if (
  screenshotPlan.schemaVersion !== 'solver.public-screenshot-plan/v1' ||
  screenshotPlan.sourcePlanSha256 !== sha256(canonical(sourceScreenshotPlan)) ||
  screenshotPlan.scenarios.length !== sourceScreenshotPlan.scenarios.length
) {
  throw new Error('public screenshot plan is missing or differs from the source evidence plan')
}
for (const sourceScenario of sourceScreenshotPlan.scenarios) {
  const publicScenario = screenshotPlan.scenarios.find((candidate) => candidate.scenarioId === sourceScenario.scenarioId)
  if (
    !publicScenario ||
    publicScenario.runId !== sourceScenario.runId ||
    publicScenario.conversationId !== sourceScenario.conversationId ||
    publicScenario.screenshots.length !== sourceScenario.screenshots.length ||
    publicScenario.screenshots.some(
      (screenshot, index) => screenshot.sourceSha256 !== sourceScenario.screenshots[index].sha256
    )
  ) {
    throw new Error(`${sourceScenario.scenarioId}: public screenshot derivation differs from source evidence`)
  }
}
const latestRegressionFile =
  process.env.LATEST_PLATFORM_REGRESSION_FILE ??
  join(inputRoot, 'evidence', 'latest-platform-regression-20260830', 'summary.json')
const latestPlatformRegression = JSON.parse(readFileSync(latestRegressionFile, 'utf8'))
if (
  latestPlatformRegression.schemaVersion !== 'solver.latest-platform-regression/v1' ||
  latestPlatformRegression.passed !== true
) {
  throw new Error('latest platform regression summary is missing, unsupported, or not passed')
}
const historicalPlatformCommit = historicalBuildManifest.platform?.commit
const historicalAgentSkillVersion = historicalBuildManifest.skill?.version
const representativeStabilityPasses = stabilityMatrix.groups?.reduce(
  (total, group) => total + 1 + (group.freshAndPerturbedRuns?.length ?? 0),
  0
)
if (
  historicalBuildManifest.schema_version !== 'solver-agent-team-build/v1' ||
  typeof historicalPlatformCommit !== 'string' ||
  typeof historicalAgentSkillVersion !== 'string' ||
  !Number.isInteger(representativeStabilityPasses) ||
  representativeStabilityPasses < 1
) {
  throw new Error('historical build manifest cannot derive public evidence ownership')
}
if (
  !historicalPlatformCommit.startsWith(latestPlatformRegression.historicalEvidence?.platformCommit ?? '') ||
  latestPlatformRegression.historicalEvidence?.representativeStabilityPasses !== representativeStabilityPasses
) {
  throw new Error('latest regression historical attribution differs from the source evidence')
}

const scenarioOrder = [
  'rw.territory-assignment',
  'rw.resource-allocation',
  'rw.performance-target',
  'rw.customer-task-scheduling',
  'rw.workforce-shift',
  'rw.insufficient-capacity-iis',
  'of.api-baseline',
  'of.diet',
  'of.facility-location',
  'of.weekly-workforce',
  'of.soap-production',
  'of.ad-traffic',
  'of.min-cost-flow',
  'of.max-flow',
  'of.portfolio',
  'of.iis-diagnosis',
  'of.seven-day-shift',
  'boundary.qp-unsupported',
  'qcp.risk-budget',
  'cp.single-machine-detection',
  'exploratory.two-person-shift',
  'validation.independent-pass',
  'validation.independent-fail',
  'recovery.cold-start',
]

const sectionIds = [
  'scenario-and-decision',
  'input-and-provenance',
  'data-quality',
  'model-definition',
  'train-validation-test',
  'solve-process',
  'solve-result',
  'independent-validation',
  'assumptions-risks-boundary',
  'reproduction-and-conclusion',
]

const readJsonLines = (file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

let activeFormulaStats = null
const renderer = new marked.Renderer()
renderer.html = ({ text }) => escapeHtml(text)
marked.use({
  extensions: [
    {
      name: 'blockMath',
      level: 'block',
      start: (source) => source.indexOf('\\['),
      tokenizer(source) {
        const match = /^\\\[([\s\S]*?)\\\](?:\n|$)/.exec(source)
        return match ? { type: 'blockMath', raw: match[0], text: match[1].trim() } : undefined
      },
      renderer(token) {
        if (activeFormulaStats) {
          activeFormulaStats.source += 1
          activeFormulaStats.display += 1
        }
        const html = katex.renderToString(token.text, {
          throwOnError: true,
          strict: 'ignore',
          trust: false,
          output: 'htmlAndMathml',
          displayMode: true,
        })
        if (activeFormulaStats) activeFormulaStats.rendered += 1
        return `${html}\n`
      },
    },
    {
      name: 'inlineMath',
      level: 'inline',
      start: (source) => source.indexOf('\\('),
      tokenizer(source) {
        const match = /^\\\(([^\n]+?)\\\)/.exec(source)
        return match ? { type: 'inlineMath', raw: match[0], text: match[1].trim() } : undefined
      },
      renderer(token) {
        if (activeFormulaStats) activeFormulaStats.source += 1
        const html = katex.renderToString(token.text, {
          throwOnError: true,
          strict: 'ignore',
          trust: false,
          output: 'htmlAndMathml',
          displayMode: false,
        })
        if (activeFormulaStats) activeFormulaStats.rendered += 1
        return html
      },
    },
  ],
})

const renderMarkdown = (markdown) => {
  const html = marked.parse(markdown, { gfm: true, breaks: true, renderer })
  if (typeof html !== 'string') throw new Error('marked returned non-string output')
  return html
}

const splitFinalReport = (markdown, scenarioId) => {
  const matches = [...markdown.matchAll(/^##\s+(10|[1-9])\.\s+(.+)\s*$/gm)]
  if (matches.length !== 10 || matches.some((match, index) => Number(match[1]) !== index + 1)) {
    throw new Error(`${scenarioId}: final report is not the required ten-part structure`)
  }
  return matches.map((match, index) => {
    const start = match.index + match[0].length
    const end = matches[index + 1]?.index ?? markdown.length
    const source = markdown.slice(start, end).trim()
    return {
      id: sectionIds[index],
      number: index + 1,
      title: match[2].trim(),
      markdown: source,
      markdownSha256: sha256(source),
      html: renderMarkdown(source),
    }
  })
}

const packById = new Map(
  globSync(join(inputRoot, 'scenario-packs', '*', '2.0.0', 'scenario-pack.json')).map((file) => {
    const pack = JSON.parse(readFileSync(file, 'utf8'))
    return [pack.manifest.scenarioId, { file, pack }]
  })
)
const caseRunById = new Map(
  globSync(join(inputRoot, 'evidence', '**', 'case-run.json')).map((file) => {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return [data.runId, { file, data, runDir: join(dirname(file), 'run') }]
  })
)

const parseSummaryJson = (event) => {
  try {
    return JSON.parse(event.data?.summary ?? '')
  } catch {
    return null
  }
}

const buildChapter = async (planItem, order) => {
  const source = caseRunById.get(planItem.runId)
  if (!source) throw new Error(`${planItem.scenarioId}: accepted Run evidence missing: ${planItem.runId}`)
  const packEntry = packById.get(planItem.scenarioId)
  if (!packEntry) throw new Error(`${planItem.scenarioId}: Scenario Pack missing`)
  const { pack } = packEntry
  const messagesFile = join(source.runDir, 'messages.jsonl')
  const sessionFile = join(source.runDir, 'sessions', 'session.jsonl')
  const invocationsFile = join(source.runDir, 'receipts', 'tool-invocations.jsonl')
  const messages = readJsonLines(messagesFile)
  const session = readJsonLines(sessionFile)
  const invocations = readJsonLines(invocationsFile)
  const conversationMessages = messages.filter((item) => ['user', 'assistant'].includes(item.role))
  const finalAssistant = conversationMessages.filter((item) => item.role === 'assistant' && item.content?.trim()).at(-1)
  if (!finalAssistant) throw new Error(`${planItem.scenarioId}: final assistant message missing`)

  activeFormulaStats = { source: 0, rendered: 0, display: 0 }
  const renderedMessages = conversationMessages.map((message, index) => ({
    kind: 'message',
    sequence: index + 1,
    role: message.role,
    timestamp: message.timestamp,
    markdown: message.content ?? '',
    markdownSha256: sha256(message.content ?? ''),
    html: message.content?.trim() ? renderMarkdown(message.content) : '',
    empty: !message.content?.trim(),
  }))
  const toolEvents = invocations
    .filter((item) => item.phase === 'finished')
    .map((item, index) => ({
      kind: 'tool',
      sequence: index + 1,
      timestamp: Date.parse(item.timestamp),
      tool: item.tool_name,
      status: item.status,
      durationMs: item.duration_ms ?? null,
      provenance: projectPublicProvenance(item.result_provenance),
    }))
  const sections = splitFinalReport(finalAssistant.content, planItem.scenarioId)
  const timeline = [...renderedMessages, ...toolEvents].sort(
    (left, right) => Number(left.timestamp ?? 0) - Number(right.timestamp ?? 0) || left.kind.localeCompare(right.kind)
  )
  const validationSummaries = session
    .filter((event) => event.type === 'tool_use_summary' && event.data?.metadata?.validation_subject !== undefined)
    .map(parseSummaryJson)
    .filter(Boolean)
  const validation = validationSummaries.at(-1) ?? null
  const finished = invocations.filter((item) => item.phase === 'finished' && item.status === 'success')
  const solve = finished.find((item) => item.tool_name === 'OptimizationSolve')
  const validate = [...finished].reverse().find((item) => item.tool_name === 'OptimizationValidate')
  const problemFamily =
    solve?.result_provenance?.problem_family ??
    validate?.result_provenance?.problem_family ??
    pack.oracle?.expectedProblemFamily ??
    pack.manifest.tags.find((tag) => ['lp', 'milp', 'qp', 'qcp', 'cp'].includes(tag)) ??
    'validation'
  const stability = stabilityMatrix.groups.find((group) => group.scenarioId === planItem.scenarioId) ?? null

  const media = []
  for (const screenshot of planItem.screenshots) {
    const sourceFile = join(inputRoot, screenshot.file)
    const name = basename(sourceFile)
    const originalRel = `media/original/${planItem.scenarioId}/${name}`
    const thumb756Rel = `media/thumb-756/${planItem.scenarioId}/${name.replace(/\.png$/, '.webp')}`
    const thumb1512Rel = `media/thumb-1512/${planItem.scenarioId}/${name.replace(/\.png$/, '.webp')}`
    const originalTarget = join(outputRoot, originalRel)
    const thumb756Target = join(outputRoot, thumb756Rel)
    const thumb1512Target = join(outputRoot, thumb1512Rel)
    mkdirSync(dirname(originalTarget), { recursive: true })
    mkdirSync(dirname(thumb756Target), { recursive: true })
    mkdirSync(dirname(thumb1512Target), { recursive: true })
    cpSync(sourceFile, originalTarget)
    await sharp(sourceFile)
      .resize({ width: 756, withoutEnlargement: true })
      .webp({ lossless: true, effort: 4 })
      .toFile(thumb756Target)
    await sharp(sourceFile)
      .resize({ width: 1512, withoutEnlargement: true })
      .webp({ lossless: true, effort: 4 })
      .toFile(thumb1512Target)
    media.push({
      stage:
        media.length === 0
          ? 'conversation-start'
          : media.length === planItem.screenshots.length - 1
            ? 'delivery-conclusion'
            : 'conversation-process',
      original: originalRel,
      thumb756: thumb756Rel,
      thumb1512: thumb1512Rel,
      width: screenshot.width,
      height: screenshot.height,
      sha256: screenshot.sha256,
      alt: `${pack.manifest.title}真实多轮会话第 ${media.length + 1} 段，展示${media.length === 0 ? '用户请求与智能体补问' : media.length === planItem.screenshots.length - 1 ? '验证结论与复现证据' : '工具过程或报告正文'}`,
    })
  }

  const formulaStats = { ...activeFormulaStats }
  activeFormulaStats = null
  const chapter = {
    schemaVersion: 'solver.web-report-chapter/v1',
    scenarioId: planItem.scenarioId,
    scenarioVersion: pack.manifest.version,
    scenarioOrder: order,
    title: pack.manifest.title,
    scenarioFamily: pack.manifest.scenarioFamily,
    claimBoundary: pack.manifest.claimBoundary,
    tags: pack.manifest.tags,
    story: pack.businessContract.plainLanguageStory,
    decision: pack.businessContract.decision,
    professionalSummary: pack.businessContract.professionalSummary,
    objectives: pack.businessContract.objectives,
    constraints: pack.businessContract.constraints,
    baseline: pack.businessContract.baseline,
    outOfScope: pack.businessContract.outOfScope,
    problemFamily,
    resultStatus: pack.oracle.expectedStatuses?.[0] ?? source.data.status,
    validationVerdict: source.data.diagnostics?.observedValidationVerdict ?? null,
    engineId: solve?.result_provenance?.engine_id ?? null,
    engineRequirement: solve?.result_provenance
      ? {
          problemFamily: solve.result_provenance.problem_family,
          irFamily: solve.result_provenance.ir_family,
          irVersion: solve.result_provenance.ir_version,
          capabilitySha256: solve.result_provenance.capability_hash,
        }
      : null,
    evidence: {
      runId: planItem.runId,
      conversationId: planItem.conversationId,
      sourceMessagesSha256: sha256(readFileSync(messagesFile)),
      sourceSessionSha256: sha256(readFileSync(sessionFile)),
      sourceToolInvocationsSha256: sha256(readFileSync(invocationsFile)),
      optimizationSpecSha256: solve?.result_provenance?.optimization_spec_hash ?? null,
      compiledRequestSha256: solve?.result_provenance?.compiled_request_hash ?? null,
      resultPayloadSha256: solve?.result_provenance?.result_payload_hash ?? null,
      validationReportSha256: validate?.result_provenance?.validation_report_hash ?? null,
    },
    counts: {
      rawConversationMessages: conversationMessages.length,
      visibleConversationMessages: renderedMessages.filter((item) => !item.empty).length,
      toolEvents: toolEvents.length,
      screenshots: media.length,
    },
    formulaStats,
    timeline,
    sections,
    validation,
    stability: stability
      ? {
          policy: '3 fresh + 1 natural-language perturbation',
          effectivePasses: 4,
          semanticConvergence: stability.assertions.semanticConvergence,
          singleSolvePerRun: stability.assertions.singleSolvePerRun,
          semanticSha256: stability.freshAndPerturbedRuns[0].optimizationSemanticHash,
          engineRequirementSha256: stability.freshAndPerturbedRuns[0].engineRequirementHash,
        }
      : { policy: 'standard real Run accepted; representative families use 3+1 gate', effectivePasses: 1 },
    media,
  }
  assertPublicText(chapter, `${planItem.scenarioId} chapter`)
  chapter.contentSha256 = sha256(canonical(chapter))
  return chapter
}

const publicEvidenceRoots = computePublicEvidenceRoots({
  inputRoot,
  screenshotPlan,
  screenshotValidation,
  screenshotPrivacyValidation,
  caseRunById,
})
const publicAttestationFile =
  process.env.SOLVER_REPORT_PUBLIC_RELEASE_ATTESTATION_FILE ??
  join(inputRoot, 'evidence', 'public-release-attestation.json')
const { attestation: publicReleaseAttestation, sha256: publicReleaseAttestationSha256 } =
  loadPublicReleaseAttestation(publicAttestationFile, publicEvidenceRoots)
if (!validatePublicReleaseAttestationSchema(publicReleaseAttestation)) {
  throw new Error(`public release attestation schema validation failed: ${ajv.errorsText(validatePublicReleaseAttestationSchema.errors)}`)
}
if (
  !historicalPlatformCommit.startsWith(publicReleaseAttestation.metadata.platformCommit) ||
  publicReleaseAttestation.metadata.agentSkillVersion !== historicalAgentSkillVersion ||
  publicReleaseAttestation.metadata.representativeStabilityPasses !== representativeStabilityPasses
) {
  throw new Error('public release attestation metadata differs from derived source evidence')
}
assertPublicText(latestPlatformRegression, 'latest platform regression')

rmSync(outputRoot, { recursive: true, force: true })
mkdirSync(join(outputRoot, 'assets'), { recursive: true })
mkdirSync(join(outputRoot, 'data', 'chapters'), { recursive: true })
for (const name of ['index.html', 'report.css', 'report.js'])
  cpSync(join(sourceRoot, name), join(outputRoot, name === 'index.html' ? name : `assets/${name}`))
cpSync(join(appRoot, 'node_modules', 'katex', 'dist', 'katex.min.css'), join(outputRoot, 'assets', 'katex.min.css'))
cpSync(join(appRoot, 'node_modules', 'katex', 'dist', 'fonts'), join(outputRoot, 'assets', 'fonts'), {
  recursive: true,
})

const chapters = []
for (const [index, scenarioId] of scenarioOrder.entries()) {
  const item = screenshotPlan.scenarios.find((candidate) => candidate.scenarioId === scenarioId)
  if (!item) throw new Error(`screenshot plan missing ${scenarioId}`)
  const chapter = await buildChapter(item, index + 1)
  const fileName = `${String(index + 1).padStart(2, '0')}-${scenarioId}.json`
  const jsName = fileName.replace(/\.json$/, '.js')
  writeFileSync(join(outputRoot, 'data', 'chapters', fileName), `${JSON.stringify(chapter)}\n`)
  writeFileSync(
    join(outputRoot, 'data', 'chapters', jsName),
    `window.__REPORT_CHAPTERS__=window.__REPORT_CHAPTERS__||{};window.__REPORT_CHAPTERS__[${JSON.stringify(scenarioId)}]=${JSON.stringify(chapter)};\n`
  )
  chapters.push({
    scenarioId,
    order: index + 1,
    title: chapter.title,
    story: chapter.story,
    problemFamily: chapter.problemFamily,
    resultStatus: chapter.resultStatus,
    validationVerdict: chapter.validationVerdict,
    engineId: chapter.engineId,
    json: `data/chapters/${fileName}`,
    script: `data/chapters/${jsName}`,
    sha256: chapter.contentSha256,
    bytes: statSync(join(outputRoot, 'data', 'chapters', fileName)).size,
    screenshots: chapter.media.length,
  })
}

const historicalEvidenceContentRootSha256 = sha256(
  canonical(chapters.map((item) => ({ scenarioId: item.scenarioId, sha256: item.sha256 })))
)
const latestPlatformRegressionSha256 = sha256(canonical(latestPlatformRegression))
const contentRootSha256 = sha256(canonical({ historicalEvidenceContentRootSha256, latestPlatformRegressionSha256 }))
const manifest = {
  schemaVersion: 'solver.web-report-manifest/v1',
  buildId: `${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}Z-${contentRootSha256.slice(0, 12)}`,
  title: '通用求解器智能体团队 · 真实场景验证书',
  generatedAt: new Date().toISOString(),
  contentRootSha256,
  reportVersion: '3.3.0',
  platformCommit: latestPlatformRegression.platform.commit,
  agentSkillVersion: latestPlatformRegression.platform.agentSkillVersion,
  evidencePlatformCommit: historicalPlatformCommit,
  publicReleaseAttestationSha256,
  publicEvidenceRoots,
  historicalEvidenceContentRootSha256,
  latestPlatformRegressionSha256,
  latestPlatformRegression,
  counts: {
    chapters: chapters.length,
    screenshots: screenshotPlan.scenarios.reduce((total, item) => total + item.screenshots.length, 0),
    representativeStabilityPasses,
  },
  chapters,
  rendering: {
    markdown: { engine: 'marked', version: requireFromApp('marked/package.json').version },
    math: { engine: 'katex', version: requireFromApp('katex/package.json').version, output: 'htmlAndMathml' },
  },
}
writeFileSync(join(outputRoot, 'data', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(join(outputRoot, 'data', 'manifest.js'), `window.__REPORT_MANIFEST__=${JSON.stringify(manifest)};\n`)
writeFileSync(
  join(outputRoot, 'data', 'latest-platform-regression.json'),
  `${JSON.stringify(latestPlatformRegression, null, 2)}\n`
)

const mime = (file) =>
  ({
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
  })[extname(file)] ?? 'application/octet-stream'
const integrityEntriesBeforeBuild = globSync(join(outputRoot, '**', '*')).filter((file) => statSync(file).isFile()).length
const expectedIntegrityEntries = integrityEntriesBeforeBuild + 1
writeFileSync(
  join(outputRoot, 'build.json'),
  `${JSON.stringify(
    {
      schemaVersion: 'solver.web-report-build/v1',
      buildId: manifest.buildId,
      contentRootSha256,
      counts: manifest.counts,
      integrityEntries: expectedIntegrityEntries,
      gates: {
        scenarioPacks: 'pass',
        stability: 'pass',
        screenshots: 'pass',
        publicReleasePrivacy: 'pass',
        markdown: 'pass',
        math: 'pass',
      },
      publicReleaseAttestationSha256,
      publicEvidenceRoots,
    },
    null,
    2
  )}\n`
)
const integrityEntries = globSync(join(outputRoot, '**', '*'))
  .filter((file) => statSync(file).isFile())
  .map((file) => {
    const bytes = readFileSync(file)
    return { path: relative(outputRoot, file), mime: mime(file), bytes: bytes.length, sha256: sha256(bytes) }
  })
  .sort((left, right) => left.path.localeCompare(right.path))
const integrity = { schemaVersion: 'solver.web-report-integrity/v1', contentRootSha256, entries: integrityEntries }
writeFileSync(join(outputRoot, 'integrity.json'), `${JSON.stringify(integrity, null, 2)}\n`)
if (integrityEntries.length !== expectedIntegrityEntries) throw new Error('integrity entry count changed unexpectedly')

console.log(
  JSON.stringify(
    {
      outputRoot,
      buildId: manifest.buildId,
      contentRootSha256,
      counts: manifest.counts,
      integrityEntries: integrityEntries.length,
    },
    null,
    2
  )
)
