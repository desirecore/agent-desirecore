import { existsSync, globSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertPublicText,
  canonical,
  computePublicEvidenceRoots,
  loadPublicReleaseAttestation,
  sha256,
} from './public-release-policy.mjs'

const codeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const Ajv = require('ajv').default
const ajv = new Ajv({ allErrors: true, strict: true })
const validateDecisionTreeSchema = ajv.compile(
  JSON.parse(readFileSync(join(codeRoot, 'decision-tree.schema.json'), 'utf8'))
)
const inputRoot = resolve(process.env.SOLVER_REPORT_INPUT_ROOT ?? process.env.BUILDER_ROOT ?? process.cwd())
const dist = process.env.SOLVER_REPORT_OUTPUT_ROOT ?? join(inputRoot, 'report-web', 'dist')
const validationFile =
  process.env.SOLVER_REPORT_VALIDATION_FILE ?? join(inputRoot, 'report-web', 'validation.json')
const manifest = JSON.parse(readFileSync(join(dist, 'data', 'manifest.json'), 'utf8'))
const integrity = JSON.parse(readFileSync(join(dist, 'integrity.json'), 'utf8'))
const build = JSON.parse(readFileSync(join(dist, 'build.json'), 'utf8'))
const latestRegression = JSON.parse(readFileSync(join(dist, 'data', 'latest-platform-regression.json'), 'utf8'))
const failures = []
const readJsonLines = (file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))

const caseRunById = new Map(
  globSync(join(inputRoot, 'evidence', '**', 'case-run.json')).map((file) => {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return [data.runId, { file, data, runDir: join(dirname(file), 'run') }]
  })
)
const packById = new Map(
  globSync(join(inputRoot, 'scenario-packs', '*', '2.0.0', 'scenario-pack.json')).map((file) => {
    const pack = JSON.parse(readFileSync(file, 'utf8'))
    return [pack.manifest.scenarioId, { file, pack }]
  })
)
const screenshotPlan = JSON.parse(
  readFileSync(
    process.env.SOLVER_REPORT_PUBLIC_SCREENSHOT_PLAN_FILE ??
      join(inputRoot, 'evidence', 'screenshots', 'public-screenshot-plan.json'),
    'utf8'
  )
)
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

if (manifest.chapters.length !== 24) failures.push({ issue: 'chapter-count', actual: manifest.chapters.length })
if (manifest.counts.decisionTrees !== 24)
  failures.push({ issue: 'decision-tree-count', actual: manifest.counts.decisionTrees })
if (manifest.counts.screenshots !== 174)
  failures.push({ issue: 'screenshot-count', actual: manifest.counts.screenshots })
const historicalEvidenceContentRootSha256 = sha256(
  canonical(manifest.chapters.map((item) => ({ scenarioId: item.scenarioId, sha256: item.sha256 })))
)
const latestPlatformRegressionSha256 = sha256(canonical(latestRegression))
const expectedContentRootSha256 = sha256(
  canonical({ historicalEvidenceContentRootSha256, latestPlatformRegressionSha256 })
)
if (manifest.historicalEvidenceContentRootSha256 !== historicalEvidenceContentRootSha256)
  failures.push({ issue: 'historical-evidence-root' })
if (manifest.latestPlatformRegressionSha256 !== latestPlatformRegressionSha256)
  failures.push({ issue: 'latest-regression-hash' })
if (
  manifest.contentRootSha256 !== expectedContentRootSha256 ||
  integrity.contentRootSha256 !== expectedContentRootSha256
)
  failures.push({ issue: 'report-content-root' })
if (latestRegression.schemaVersion !== 'solver.latest-platform-regression/v1' || latestRegression.passed !== true)
  failures.push({ issue: 'latest-regression-status' })
if (manifest.latestPlatformRegression?.platform?.commit !== latestRegression.platform?.commit)
  failures.push({ issue: 'latest-regression-manifest-projection' })
if (
  !manifest.evidencePlatformCommit?.startsWith(publicReleaseAttestation.metadata.platformCommit) ||
  !manifest.evidencePlatformCommit?.startsWith(latestRegression.historicalEvidence?.platformCommit)
)
  failures.push({ issue: 'historical-platform-attribution' })
if (
  manifest.platformCommit !== latestRegression.platform?.commit ||
  manifest.agentSkillVersion !== latestRegression.platform?.agentSkillVersion ||
  manifest.counts.representativeStabilityPasses !== publicReleaseAttestation.metadata.representativeStabilityPasses
)
  failures.push({ issue: 'derived-release-metadata' })
if (
  manifest.publicReleaseAttestationSha256 !== publicReleaseAttestationSha256 ||
  canonical(manifest.publicEvidenceRoots) !== canonical(publicEvidenceRoots)
)
  failures.push({ issue: 'public-release-attestation-projection' })
if (
  build.buildId !== manifest.buildId ||
  build.contentRootSha256 !== manifest.contentRootSha256 ||
  build.publicReleaseAttestationSha256 !== manifest.publicReleaseAttestationSha256 ||
  canonical(build.publicEvidenceRoots) !== canonical(manifest.publicEvidenceRoots) ||
  canonical(build.counts) !== canonical(manifest.counts) ||
  build.integrityEntries !== integrity.entries.length ||
  build.gates?.decisionTrees !== 'pass' ||
  build.gates?.publicReleasePrivacy !== 'pass' ||
  !integrity.entries.some((entry) => entry.path === 'build.json')
)
  failures.push({ issue: 'build-manifest-integrity-projection' })
try {
  assertPublicText(latestRegression, 'latest platform regression')
} catch (error) {
  failures.push({ issue: 'latest-regression-public-text-policy', detail: error.message })
}

let formulas = 0
let screenshotCount = 0
let decisionTreeCount = 0
for (const index of manifest.chapters) {
  const file = join(dist, index.json)
  const script = join(dist, index.script)
  if (!existsSync(file) || !existsSync(script)) {
    failures.push({ scenarioId: index.scenarioId, issue: 'chapter-file-missing' })
    continue
  }
  const chapter = JSON.parse(readFileSync(file, 'utf8'))
  const withoutHash = structuredClone(chapter)
  delete withoutHash.contentSha256
  if (sha256(canonical(withoutHash)) !== chapter.contentSha256 || chapter.contentSha256 !== index.sha256) {
    failures.push({ scenarioId: index.scenarioId, issue: 'chapter-hash' })
  }
  if (chapter.sections.length !== 10 || chapter.sections.some((section, i) => section.number !== i + 1)) {
    failures.push({ scenarioId: index.scenarioId, issue: 'ten-part-report' })
  }
  if (chapter.formulaStats.source !== chapter.formulaStats.rendered) {
    failures.push({ scenarioId: index.scenarioId, issue: 'formula-count', stats: chapter.formulaStats })
  }
  const renderedHtml = [
    ...chapter.timeline.filter((item) => item.kind === 'message').map((item) => item.html),
    ...chapter.sections.map((item) => item.html),
  ].join('\n')
  const mathmlCount = (renderedHtml.match(/<math\b/g) ?? []).length
  if (mathmlCount !== chapter.formulaStats.rendered || /katex-error/.test(renderedHtml)) {
    failures.push({
      scenarioId: index.scenarioId,
      issue: 'mathml-render',
      expected: chapter.formulaStats.rendered,
      actual: mathmlCount,
    })
  }
  const renderedWithoutCode = renderedHtml.replace(/<pre[\s\S]*?<\/pre>/g, '').replace(/<code[\s\S]*?<\/code>/g, '')
  if (/\\\(|\\\)|\\\[|\\\]/.test(renderedWithoutCode)) {
    failures.push({ scenarioId: index.scenarioId, issue: 'unrendered-latex-delimiter' })
  }
  formulas += chapter.formulaStats.rendered
  screenshotCount += chapter.media.length
  const source = caseRunById.get(chapter.evidence.runId)
  const sourceMessagesFile = source ? join(source.runDir, 'messages.jsonl') : null
  const sourceSessionFile = source ? join(source.runDir, 'sessions', 'session.jsonl') : null
  const sourceInvocationsFile = source ? join(source.runDir, 'receipts', 'tool-invocations.jsonl') : null
  const sourceInvocations = source ? readJsonLines(sourceInvocationsFile) : []
  const sourceSession = source ? readJsonLines(sourceSessionFile) : []
  const finishedReceipts = sourceInvocations.filter((item) => item.phase === 'finished' && item.status === 'success')
  const finishedToolNames = finishedReceipts.map((item) => item.tool_name)
  const parsedSummaries = sourceSession
    .filter((event) => event.type === 'tool_use_summary')
    .map((event) => {
      try {
        return { event, summary: JSON.parse(event.data?.summary ?? '') }
      } catch {
        return null
      }
    })
    .filter((entry) => entry?.summary && typeof entry.summary === 'object' && !Array.isArray(entry.summary))
  const solveReceipt = finishedReceipts.find((item) => item.tool_name === 'OptimizationSolve')
  const validationReceipt = [...finishedReceipts].reverse().find((item) => item.tool_name === 'OptimizationValidate')
  const ledgerReceipt = [...finishedReceipts].reverse().find((item) => item.tool_name === 'OptimizationEvidenceLedger')
  const observedSolveSummary = solveReceipt
    ? typeof solveReceipt.result_provenance?.result_payload_hash === 'string'
      ? parsedSummaries.find(
        ({ summary }) => summary.result_payload_hash === solveReceipt.result_provenance?.result_payload_hash
        )?.summary ?? null
      : null
    : null
  const observedValidationSummary = validationReceipt
    ? typeof validationReceipt.result_provenance?.validation_report_hash === 'string'
      ? [...parsedSummaries]
        .reverse()
        .find(
          ({ event, summary }) =>
            ['pass', 'fail'].includes(summary.verdict) &&
            event.data?.metadata?.validation_report_hash === validationReceipt.result_provenance?.validation_report_hash
          )?.summary ?? null
      : null
    : null
  const observedLedgerSummary = ledgerReceipt
    ? [...parsedSummaries]
        .reverse()
        .find(({ summary }) => summary.schema_version === 'solver.optimization-evidence-ledger/v1')?.summary ?? null
    : null
  const tree = chapter.decisionTree
  const treeNodes = new Map(tree?.nodes?.map((node) => [node.id, node]) ?? [])
  const packEntry = packById.get(index.scenarioId)
  if (
    !validateDecisionTreeSchema(tree) ||
    tree?.schemaVersion !== 'solver.human-agent-decision-tree/v1' ||
    treeNodes.size !== tree?.nodes?.length ||
    !treeNodes.has(tree?.rootNodeId) ||
    tree?.edges?.some((edge) => !treeNodes.has(edge.from) || !treeNodes.has(edge.to)) ||
    !packEntry ||
    tree?.evidenceBindings?.scenarioPackSha256 !== sha256(readFileSync(packEntry.file)) ||
    tree?.evidenceBindings?.runId !== chapter.evidence.runId ||
    tree?.evidenceBindings?.sourceMessagesSha256 !== chapter.evidence.sourceMessagesSha256 ||
    tree?.evidenceBindings?.sourceSessionSha256 !== chapter.evidence.sourceSessionSha256 ||
    tree?.evidenceBindings?.sourceToolInvocationsSha256 !== chapter.evidence.sourceToolInvocationsSha256 ||
    tree?.evidenceBindings?.optimizationSpecSha256 !== chapter.evidence.optimizationSpecSha256 ||
    tree?.evidenceBindings?.resultPayloadSha256 !== chapter.evidence.resultPayloadSha256 ||
    tree?.evidenceBindings?.validationReportSha256 !== chapter.evidence.validationReportSha256 ||
    !source ||
    tree?.evidenceBindings?.sourceMessagesSha256 !== sha256(readFileSync(sourceMessagesFile)) ||
    tree?.evidenceBindings?.sourceSessionSha256 !== sha256(readFileSync(sourceSessionFile)) ||
    tree?.evidenceBindings?.sourceToolInvocationsSha256 !== sha256(readFileSync(sourceInvocationsFile)) ||
    source.data.status !== 'passed' ||
    tree?.observed?.runStatus !== source.data.status ||
    !['optimization', 'validation', 'recovery'].includes(tree?.observed?.workflowKind) ||
    (tree?.observed?.workflowKind === 'optimization' &&
      (!finishedToolNames.includes('OptimizationSolve') ||
        !finishedToolNames.includes('OptimizationValidate') ||
        !observedSolveSummary ||
        !observedValidationSummary ||
        tree.observed.solveStatus !== observedSolveSummary.status ||
        tree.observed.validationVerdict !== observedValidationSummary.verdict ||
        !solveReceipt?.result_provenance?.optimization_spec_hash ||
        tree.evidenceBindings.optimizationSpecSha256 !== solveReceipt.result_provenance.optimization_spec_hash ||
        tree.evidenceBindings.resultPayloadSha256 !== solveReceipt?.result_provenance?.result_payload_hash ||
        !validationReceipt?.result_provenance?.validation_report_hash ||
        tree.evidenceBindings.validationReportSha256 !== validationReceipt?.result_provenance?.validation_report_hash ||
        !tree.evidenceBindings.resultPayloadSha256 ||
        chapter.resultStatus !== tree.observed.solveStatus ||
        chapter.validationVerdict !== tree.observed.validationVerdict)) ||
    (tree?.observed?.workflowKind === 'validation' &&
      (finishedToolNames.includes('OptimizationCompile') ||
        finishedToolNames.includes('OptimizationSolve') ||
        tree.observed.solveStatus !== null ||
        !finishedToolNames.includes('OptimizationValidate') ||
        !observedValidationSummary ||
        tree.observed.validationVerdict !== observedValidationSummary.verdict ||
        !validationReceipt?.result_provenance?.validation_report_hash ||
        tree.evidenceBindings.validationReportSha256 !== validationReceipt?.result_provenance?.validation_report_hash ||
        treeNodes.has('model') ||
        chapter.resultStatus !== tree.observed.validationVerdict)) ||
    (tree?.observed?.workflowKind === 'recovery' &&
      (finishedToolNames.includes('OptimizationCompile') ||
        finishedToolNames.includes('OptimizationSolve') ||
        finishedToolNames.includes('OptimizationValidate') ||
        tree.observed.solveStatus !== null ||
        tree.observed.validationVerdict !== null ||
        !finishedToolNames.includes('OptimizationEvidenceLedger') ||
        !observedLedgerSummary ||
        !ledgerReceipt?.result_provenance?.result_payload_hash ||
        tree.evidenceBindings.resultPayloadSha256 !== ledgerReceipt?.result_provenance?.result_payload_hash ||
        treeNodes.has('model') ||
        !tree.evidenceBindings.resultPayloadSha256 ||
        chapter.resultStatus !== 'recovered'))
  ) {
    failures.push({ scenarioId: index.scenarioId, issue: 'decision-tree-contract-or-evidence-binding' })
  } else {
    const selectedEdges = tree.edges.filter((edge) => edge.selected)
    const selectedByFrom = new Map()
    for (const edge of selectedEdges) selectedByFrom.set(edge.from, [...(selectedByFrom.get(edge.from) ?? []), edge])
    let cursor = tree.rootNodeId
    const visited = new Set()
    while (selectedByFrom.get(cursor)?.length === 1 && !visited.has(cursor)) {
      visited.add(cursor)
      cursor = selectedByFrom.get(cursor)[0].to
    }
    if (
      cursor !== 'outcome' ||
      visited.size !== selectedEdges.length ||
      [...selectedByFrom.values()].some((outgoing) => outgoing.length !== 1) ||
      tree.nodes.some((node) => node.id !== tree.rootNodeId && !tree.edges.some((edge) => edge.to === node.id))
    )
      failures.push({ scenarioId: index.scenarioId, issue: 'decision-tree-selected-path' })
    else decisionTreeCount += 1
  }
  for (const image of chapter.media) {
    const original = join(dist, image.original)
    if (!existsSync(original) || sha256(readFileSync(original)) !== image.sha256) {
      failures.push({ scenarioId: index.scenarioId, issue: 'original-image', path: image.original })
    }
    for (const thumb of [image.thumb756, image.thumb1512]) {
      if (!existsSync(join(dist, thumb)))
        failures.push({ scenarioId: index.scenarioId, issue: 'thumbnail-missing', path: thumb })
    }
  }
  if (!source) failures.push({ scenarioId: index.scenarioId, issue: 'source-run-missing' })
  else {
    const raw = readJsonLines(sourceMessagesFile).filter((item) =>
      ['user', 'assistant'].includes(item.role)
    )
    const projected = chapter.timeline.filter((item) => item.kind === 'message')
    if (
      raw.length !== projected.length ||
      raw.some((message, i) => message.role !== projected[i].role || (message.content ?? '') !== projected[i].markdown)
    ) {
      failures.push({ scenarioId: index.scenarioId, issue: 'transcript-not-1-to-1' })
    }
  }
  const serialized = JSON.stringify(chapter)
  try {
    assertPublicText(serialized, `${index.scenarioId} chapter`)
  } catch (error) {
    failures.push({ scenarioId: index.scenarioId, issue: 'public-text-policy', detail: error.message })
  }
  if (
    ['qp', 'qcp', 'cp'].includes(String(chapter.problemFamily).toLowerCase()) &&
    /当前只支持\s*LP\/?MILP/i.test(serialized)
  ) {
    failures.push({ scenarioId: index.scenarioId, issue: 'stale-capability-summary' })
  }
}

if (screenshotCount !== 174) failures.push({ issue: 'chapter-screenshot-sum', actual: screenshotCount })
if (decisionTreeCount !== 24) failures.push({ issue: 'chapter-decision-tree-sum', actual: decisionTreeCount })
for (const entry of integrity.entries) {
  const file = join(dist, entry.path)
  if (!existsSync(file)) failures.push({ issue: 'integrity-file-missing', path: entry.path })
  else {
    const bytes = readFileSync(file)
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256)
      failures.push({ issue: 'integrity-mismatch', path: entry.path })
  }
}
for (const required of [
  'index.html',
  'assets/report.css',
  'assets/report.js',
  'assets/katex.min.css',
  'data/manifest.js',
  'data/decision-tree.schema.json',
  'data/latest-platform-regression.json',
]) {
  if (!existsSync(join(dist, required))) failures.push({ issue: 'required-asset', path: required })
}

const report = {
  schemaVersion: 'solver.web-report-validation/v1',
  generatedAt: new Date().toISOString(),
  buildId: manifest.buildId,
  chapters: manifest.chapters.length,
  screenshots: screenshotCount,
  decisionTrees: decisionTreeCount,
  formulas,
  integrityEntries: integrity.entries.length,
  bytes: globSync(join(dist, '**', '*'))
    .filter((file) => statSync(file).isFile())
    .reduce((sum, file) => sum + statSync(file).size, 0),
  latestPlatformRegression: {
    commit: latestRegression.platform.commit,
    scenarios: latestRegression.runtime.scenarios.length,
    decisionWorkspace: latestRegression.runtime.decisionWorkspace.status,
  },
  passed: failures.length === 0,
  failures,
}
writeFileSync(validationFile, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
if (!report.passed) process.exitCode = 1
