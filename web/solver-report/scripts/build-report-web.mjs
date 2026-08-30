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
const validateDecisionTreeSchema = ajv.compile(
  JSON.parse(readFileSync(join(codeRoot, 'decision-tree.schema.json'), 'utf8'))
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

const compactList = (items, limit = 3) => {
  const visible = items.slice(0, limit)
  return `${visible.join('；')}${items.length > limit ? `；另有 ${items.length - limit} 项` : ''}`
}
const observedStatusLabel = (status) =>
  ({ optimal: '最优解', infeasible: '不可行', pass: '通过', fail: '拒绝' })[status] ?? String(status)

const buildDecisionTree = ({ pack, packSha256, evidence, workflowKind, observed, problemFamily, engineId }) => {
  const hardChecks = pack.oracle?.hardChecks ?? []
  const intent = {
    id: 'intent',
    kind: 'context',
    owner: 'shared',
    title: pack.businessContract.decision,
    detail: pack.businessContract.plainLanguageStory,
    status: 'neutral',
    evidenceRef: '#scenario-and-decision',
  }
  let nodes
  let edges
  if (workflowKind === 'optimization') {
    const isInfeasible = observed.solveStatus === 'infeasible'
    const isRejected = observed.validationVerdict === 'fail'
    nodes = [
      intent,
      {
        id: 'facts', kind: 'question', owner: 'human', title: '业务事实、硬规则与优先级是否已确认？',
        detail: `${compactList(pack.businessContract.objectives)}；${compactList(pack.businessContract.constraints)}`,
        status: 'pass', evidenceRef: '#input-and-provenance',
      },
      {
        id: 'clarify', kind: 'action', owner: 'agent', title: '信息不足：向人类补问',
        detail: '缺少决定性事实时保持阻断，不猜测参数、不静默补值。', status: 'guard',
        evidenceRef: '#input-and-provenance',
      },
      {
        id: 'model', kind: 'check', owner: 'agent',
        title: `规则是否完整映射为 ${String(problemFamily).toUpperCase()} 决策模型？`,
        detail: hardChecks.length ? `交付必须覆盖 ${compactList(hardChecks, 4)}` : pack.businessContract.professionalSummary,
        status: 'pass', evidenceRef: '#model-definition',
      },
      {
        id: 'mapping-block', kind: 'outcome', owner: 'shared', title: '模型映射不完整：停止求解',
        detail: '由人类补充或修正规则，Agent 不得以近似模型冒充原问题。', status: 'blocked',
        evidenceRef: '#model-definition',
      },
      {
        id: 'candidate', kind: 'action', owner: 'agent',
        title: isInfeasible ? `使用 ${engineId} 做可行性诊断` : `使用 ${engineId} 生成候选方案`,
        detail: `真实求解回执：${observedStatusLabel(observed.solveStatus)}（${observed.solveStatus}）；${pack.businessContract.baseline}`,
        status: isInfeasible ? 'guard' : 'pass', evidenceRef: '#solve-process',
      },
      {
        id: 'verify', kind: 'question', owner: 'validator',
        title: isInfeasible ? '不可行结论与冲突集合是否可追溯？' : '独立校核是否接受当前候选？',
        detail: hardChecks.length ? `重新检查 ${compactList(hardChecks, 4)}` : '重新计算变量域、硬约束、目标与证据哈希。',
        status: isRejected ? 'guard' : 'pass', evidenceRef: '#independent-validation',
      },
      {
        id: 'verification-guard', kind: 'outcome', owner: 'validator', title: '校核证据不足：拒绝交付',
        detail: '不采信求解器自报；保留候选、失败检查和哈希后返回 Agent 修正。', status: 'blocked',
        evidenceRef: '#independent-validation',
      },
      {
        id: 'outcome', kind: 'outcome', owner: 'human',
        title: isRejected ? '阻断违规方案，不进入执行' : isInfeasible ? '交付冲突诊断，等待人类调整规则' : '建议方案交由业务负责人确认',
        detail: isRejected ? '独立校核拒绝该候选；保留失败证据供人复核。' : isInfeasible ? '不偷偷删除任务、放宽容量或伪造可行解。' : `${pack.businessContract.objectives.join('；')}；执行前仍由人类确认适用边界。`,
        status: isRejected ? 'blocked' : isInfeasible ? 'guard' : 'pass', evidenceRef: '#reproduction-and-conclusion',
      },
    ]
    edges = [
      { from: 'intent', to: 'facts', label: '进入事实确认', tone: 'continue', selected: true },
      { from: 'facts', to: 'clarify', label: '否：缺少决定性信息', tone: 'guard', selected: false },
      { from: 'facts', to: 'model', label: '是：事实门关闭', tone: 'continue', selected: true },
      { from: 'model', to: 'mapping-block', label: '否：存在未映射规则', tone: 'guard', selected: false },
      { from: 'model', to: 'candidate', label: '是：模型可执行', tone: 'continue', selected: true },
      { from: 'candidate', to: 'verify', label: `求解回执：${observedStatusLabel(observed.solveStatus)}`, tone: isInfeasible ? 'guard' : 'continue', selected: true },
      { from: 'verify', to: 'verification-guard', label: '证据不足或对账失败', tone: 'guard', selected: false },
      { from: 'verify', to: 'outcome', label: isRejected ? '校核回执：拒绝' : isInfeasible ? '校核回执：通过，冲突可追溯' : '校核回执：通过', tone: isRejected ? 'guard' : 'success', selected: true },
    ]
  } else if (workflowKind === 'validation') {
    const isRejected = observed.validationVerdict === 'fail'
    nodes = [
      intent,
      {
        id: 'candidate', kind: 'question', owner: 'human', title: '候选变量、目标声明与适用边界是否齐全？',
        detail: `${compactList(pack.businessContract.constraints)}；${pack.businessContract.baseline}`,
        status: 'pass', evidenceRef: '#input-and-provenance',
      },
      {
        id: 'clarify', kind: 'action', owner: 'agent', title: '候选信息不全：请求补充',
        detail: '缺少变量、约束、目标口径或来源时不启动校核。', status: 'guard', evidenceRef: '#input-and-provenance',
      },
      {
        id: 'verify', kind: 'check', owner: 'validator', title: '不重新求解，独立复算候选',
        detail: hardChecks.length ? `核对 ${compactList(hardChecks, 4)}` : '核对变量域、硬约束、目标与基线。',
        status: isRejected ? 'guard' : 'pass', evidenceRef: '#independent-validation',
      },
      {
        id: 'verification-guard', kind: 'outcome', owner: 'validator', title: '校核证据不足：拒绝下结论',
        detail: '验证报告或工具回执缺失时保持阻断。', status: 'blocked', evidenceRef: '#independent-validation',
      },
      {
        id: 'outcome', kind: 'outcome', owner: 'human',
        title: isRejected ? '阻断违规方案，不进入执行' : '候选通过校核，交由人类决定是否采用',
        detail: isRejected ? '高目标值不能覆盖硬约束违规；本次独立校核回执为拒绝（fail）。' : '本次独立校核回执为通过（pass）；验证通过不等于自动批准执行。',
        status: isRejected ? 'blocked' : 'pass', evidenceRef: '#reproduction-and-conclusion',
      },
    ]
    edges = [
      { from: 'intent', to: 'candidate', label: '进入候选校核', tone: 'continue', selected: true },
      { from: 'candidate', to: 'clarify', label: '否：候选信息不完整', tone: 'guard', selected: false },
      { from: 'candidate', to: 'verify', label: '是：只校核、不重算方案', tone: 'continue', selected: true },
      { from: 'verify', to: 'verification-guard', label: '验证证据缺失', tone: 'guard', selected: false },
      { from: 'verify', to: 'outcome', label: `校核回执：${observedStatusLabel(observed.validationVerdict)}`, tone: isRejected ? 'guard' : 'success', selected: true },
    ]
  } else {
    nodes = [
      intent,
      {
        id: 'recovery-source', kind: 'question', owner: 'platform', title: '正常关闭标记与恢复前基线是否可读取？',
        detail: pack.businessContract.baseline, status: 'pass', evidenceRef: '#input-and-provenance',
      },
      {
        id: 'missing-state', kind: 'outcome', owner: 'platform', title: '恢复来源不完整：停止声称恢复成功',
        detail: '缺少关闭标记、团队快照或账本时，必须进入人工排查。', status: 'blocked', evidenceRef: '#input-and-provenance',
      },
      {
        id: 'restore', kind: 'action', owner: 'platform', title: '恢复团队、Skill、工具与既有证据',
        detail: '该路径不建立、不编译、不求解优化模型。', status: 'pass', evidenceRef: '#solve-process',
      },
      {
        id: 'ledger-check', kind: 'check', owner: 'validator', title: '恢复前后 EvidenceLedger 是否保持幂等？',
        detail: compactList(pack.businessContract.constraints, 4), status: 'pass', evidenceRef: '#independent-validation',
      },
      {
        id: 'ledger-guard', kind: 'outcome', owner: 'validator', title: '账本计数或证据变化：拒绝恢复结论',
        detail: '发现重复已结算调用或身份漂移时保持阻断。', status: 'blocked', evidenceRef: '#independent-validation',
      },
      {
        id: 'outcome', kind: 'outcome', owner: 'human', title: '恢复完成，不重复已结算求解',
        detail: '本次 Run 已通过，且 EvidenceLedger 回执已绑定到这棵树。', status: 'pass', evidenceRef: '#reproduction-and-conclusion',
      },
    ]
    edges = [
      { from: 'intent', to: 'recovery-source', label: '进入恢复核对', tone: 'continue', selected: true },
      { from: 'recovery-source', to: 'missing-state', label: '否：恢复来源缺失', tone: 'guard', selected: false },
      { from: 'recovery-source', to: 'restore', label: '是：加载既有状态', tone: 'continue', selected: true },
      { from: 'restore', to: 'ledger-check', label: '读取 EvidenceLedger', tone: 'continue', selected: true },
      { from: 'ledger-check', to: 'ledger-guard', label: '否：计数或身份漂移', tone: 'guard', selected: false },
      { from: 'ledger-check', to: 'outcome', label: '是：无重复求解', tone: 'success', selected: true },
    ]
  }
  const tree = {
    schemaVersion: 'solver.human-agent-decision-tree/v1', rootNodeId: 'intent', nodes, edges, observed,
    evidenceBindings: {
      scenarioPackSha256: packSha256,
      runId: evidence.runId,
      sourceMessagesSha256: evidence.sourceMessagesSha256,
      sourceSessionSha256: evidence.sourceSessionSha256,
      sourceToolInvocationsSha256: evidence.sourceToolInvocationsSha256,
      optimizationSpecSha256: evidence.optimizationSpecSha256,
      resultPayloadSha256: evidence.resultPayloadSha256,
      validationReportSha256: evidence.validationReportSha256,
    },
  }
  if (!validateDecisionTreeSchema(tree)) {
    throw new Error(`decision tree schema validation failed: ${ajv.errorsText(validateDecisionTreeSchema.errors)}`)
  }
  const nodeIds = new Set(tree.nodes.map((node) => node.id))
  if (nodeIds.size !== tree.nodes.length || !nodeIds.has(tree.rootNodeId)) throw new Error('decision tree node IDs invalid')
  if (tree.edges.some((edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to))) {
    throw new Error('decision tree edge refers to an unknown node')
  }
  const selectedEdges = tree.edges.filter((edge) => edge.selected)
  const selectedByFrom = new Map()
  for (const edge of selectedEdges) selectedByFrom.set(edge.from, [...(selectedByFrom.get(edge.from) ?? []), edge])
  if ([...selectedByFrom.values()].some((outgoing) => outgoing.length !== 1)) {
    throw new Error('decision tree path must have exactly one selected outgoing edge per path node')
  }
  if (tree.nodes.some((node) => node.id !== tree.rootNodeId && !tree.edges.some((edge) => edge.to === node.id))) {
    throw new Error('decision tree contains an orphan node')
  }
  let cursor = tree.rootNodeId
  const visited = new Set()
  while (selectedByFrom.has(cursor) && !visited.has(cursor)) {
    visited.add(cursor)
    cursor = selectedByFrom.get(cursor)[0].to
  }
  if (cursor !== 'outcome' || visited.size !== selectedEdges.length || selectedByFrom.has('outcome')) {
    throw new Error('decision tree selected path must be acyclic, complete, and terminate at outcome')
  }
  return tree
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
  const parsedToolSummaries = session
    .filter((event) => event.type === 'tool_use_summary')
    .map((event) => ({ event, summary: parseSummaryJson(event) }))
    .filter((entry) => entry.summary && typeof entry.summary === 'object' && !Array.isArray(entry.summary))
  const finished = invocations.filter((item) => item.phase === 'finished' && item.status === 'success')
  const solve = finished.find((item) => item.tool_name === 'OptimizationSolve')
  const validate = [...finished].reverse().find((item) => item.tool_name === 'OptimizationValidate')
  const ledger = [...finished].reverse().find((item) => item.tool_name === 'OptimizationEvidenceLedger')
  const compile = finished.find((item) => item.tool_name === 'OptimizationCompile')
  const solveSummary = solve
    ? typeof solve.result_provenance?.result_payload_hash === 'string'
      ? parsedToolSummaries.find(
        ({ summary }) =>
          typeof summary.status === 'string' &&
          summary.result_payload_hash === solve.result_provenance?.result_payload_hash
        )?.summary ?? null
      : null
    : null
  const validationEntry = validate
    ? typeof validate.result_provenance?.validation_report_hash === 'string'
      ? [...parsedToolSummaries]
        .reverse()
        .find(
          ({ event, summary }) =>
            ['pass', 'fail'].includes(summary.verdict) &&
            event.data?.metadata?.validation_report_hash === validate.result_provenance?.validation_report_hash
          ) ?? null
      : null
    : null
  const validation = validationEntry?.summary ?? null
  const ledgerSummary = ledger
    ? [...parsedToolSummaries]
        .reverse()
        .find(({ summary }) => summary.schema_version === 'solver.optimization-evidence-ledger/v1')?.summary ?? null
    : null
  if (source.data.status !== 'passed') throw new Error(`${planItem.scenarioId}: decision tree requires an accepted Run`)
  const workflowKind = solve ? 'optimization' : validate ? 'validation' : ledger ? 'recovery' : null
  if (!workflowKind) throw new Error(`${planItem.scenarioId}: no observed solve, validation, or recovery workflow`)
  if (workflowKind !== 'optimization' && compile) {
    throw new Error(`${planItem.scenarioId}: ${workflowKind} workflow cannot hide an observed OptimizationCompile step`)
  }
  if (workflowKind === 'optimization' && (!solveSummary || !validation)) {
    throw new Error(`${planItem.scenarioId}: settled solve or validation summary missing`)
  }
  if (
    workflowKind === 'optimization' &&
    (!solve.result_provenance?.optimization_spec_hash ||
      !solve.result_provenance?.result_payload_hash ||
      !validate.result_provenance?.validation_report_hash)
  ) {
    throw new Error(`${planItem.scenarioId}: optimization workflow provenance hashes missing`)
  }
  if (workflowKind === 'validation' && !validation) {
    throw new Error(`${planItem.scenarioId}: observed validation summary missing`)
  }
  if (workflowKind === 'validation' && !validate.result_provenance?.validation_report_hash) {
    throw new Error(`${planItem.scenarioId}: validation workflow report hash missing`)
  }
  if (workflowKind === 'recovery' && !ledgerSummary) {
    throw new Error(`${planItem.scenarioId}: recovery EvidenceLedger summary missing`)
  }
  if (workflowKind === 'recovery' && !ledger.result_provenance?.result_payload_hash) {
    throw new Error(`${planItem.scenarioId}: recovery EvidenceLedger result hash missing`)
  }
  const problemFamily =
    solve?.result_provenance?.problem_family ??
    validate?.result_provenance?.problem_family ??
    pack.oracle?.expectedProblemFamily ??
    pack.manifest.tags.find((tag) => ['lp', 'milp', 'qp', 'qcp', 'cp'].includes(tag)) ??
    'validation'
  const stability = stabilityMatrix.groups.find((group) => group.scenarioId === planItem.scenarioId) ?? null
  const resultStatus =
    workflowKind === 'optimization'
      ? solveSummary.status
      : workflowKind === 'validation'
        ? validation.verdict
        : 'recovered'
  const validationVerdict = validation?.verdict ?? null
  if (pack.oracle.expectedStatuses?.length && !pack.oracle.expectedStatuses.includes(resultStatus)) {
    throw new Error(`${planItem.scenarioId}: observed result ${resultStatus} differs from Scenario Pack oracle`)
  }
  if (
    source.data.diagnostics?.observedValidationVerdict != null &&
    source.data.diagnostics.observedValidationVerdict !== validationVerdict
  ) {
    throw new Error(`${planItem.scenarioId}: validation summary differs from case-run diagnostics`)
  }
  const sourceMessagesSha256 = sha256(readFileSync(messagesFile))
  const evidence = {
    runId: planItem.runId,
    conversationId: planItem.conversationId,
    sourceMessagesSha256,
    sourceSessionSha256: sha256(readFileSync(sessionFile)),
    sourceToolInvocationsSha256: sha256(readFileSync(invocationsFile)),
    optimizationSpecSha256: solve?.result_provenance?.optimization_spec_hash ?? null,
    compiledRequestSha256: solve?.result_provenance?.compiled_request_hash ?? null,
    resultPayloadSha256:
      solve?.result_provenance?.result_payload_hash ?? ledger?.result_provenance?.result_payload_hash ?? null,
    validationReportSha256: validate?.result_provenance?.validation_report_hash ?? null,
  }
  const decisionTree = buildDecisionTree({
    pack,
    packSha256: sha256(readFileSync(packEntry.file)),
    evidence,
    workflowKind,
    observed: {
      workflowKind,
      runStatus: source.data.status,
      solveStatus: solveSummary?.status ?? null,
      validationVerdict,
    },
    problemFamily,
    engineId: solve?.result_provenance?.engine_id ?? null,
  })

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
    resultStatus,
    validationVerdict,
    engineId: solve?.result_provenance?.engine_id ?? null,
    engineRequirement: solve?.result_provenance
      ? {
          problemFamily: solve.result_provenance.problem_family,
          irFamily: solve.result_provenance.ir_family,
          irVersion: solve.result_provenance.ir_version,
          capabilitySha256: solve.result_provenance.capability_hash,
        }
      : null,
    evidence,
    decisionTree,
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
cpSync(join(codeRoot, 'decision-tree.schema.json'), join(outputRoot, 'data', 'decision-tree.schema.json'))

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
  reportVersion: '3.4.0',
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
    decisionTrees: chapters.length,
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
        decisionTrees: 'pass',
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
