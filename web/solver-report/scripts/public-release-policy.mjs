import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, posix, relative, resolve } from 'node:path'

export const sha256 = (value) => createHash('sha256').update(value).digest('hex')

export const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

const isDescendant = (parent, candidate) => {
  const path = relative(parent, candidate)
  return path !== '' && !path.startsWith('..') && !isAbsolute(path)
}

const overlaps = (left, right) =>
  left === right || isDescendant(left, right) || isDescendant(right, left)

const resolvePhysicalPath = (candidate) => {
  let ancestor = resolve(candidate)
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor)
    if (parent === ancestor) throw new Error(`cannot resolve an existing ancestor for ${candidate}`)
    ancestor = parent
  }
  return resolve(realpathSync(ancestor), relative(ancestor, resolve(candidate)))
}

export function resolveSafeOutputRoot({ inputRoot, codeRoot, appRoot, requestedOutputRoot }) {
  const roots = {
    inputRoot: resolvePhysicalPath(inputRoot),
    codeRoot: resolvePhysicalPath(codeRoot),
    appRoot: resolvePhysicalPath(appRoot),
    outputRoot: resolvePhysicalPath(requestedOutputRoot),
  }
  const lexicalInputRoot = resolve(inputRoot)
  const lexicalOutputRoot = resolve(requestedOutputRoot)
  const lexicalManagedParent = join(lexicalInputRoot, 'report-web')
  const physicalManagedParent = resolvePhysicalPath(lexicalManagedParent)
  if (
    !isDescendant(lexicalManagedParent, lexicalOutputRoot) ||
    !isDescendant(roots.inputRoot, physicalManagedParent) ||
    !isDescendant(physicalManagedParent, roots.outputRoot)
  ) {
    throw new Error('SOLVER_REPORT_OUTPUT_ROOT must be a child of <SOLVER_REPORT_INPUT_ROOT>/report-web')
  }
  if (roots.outputRoot === roots.inputRoot || isDescendant(roots.outputRoot, roots.inputRoot)) {
    throw new Error('report output must not equal or contain the evidence input root')
  }
  for (const [name, protectedRoot] of [
    ['Agent source', roots.codeRoot],
    ['DesireCore application', roots.appRoot],
  ]) {
    if (overlaps(roots.outputRoot, protectedRoot)) {
      throw new Error(`report output must not overlap ${name} root`)
    }
  }
  return roots.outputRoot
}

export function resolveSafeRemoteEntryUrl(baseUrl, entryPath) {
  if (
    typeof entryPath !== 'string' ||
    entryPath.length === 0 ||
    entryPath.startsWith('/') ||
    entryPath.includes('\\') ||
    entryPath.includes('%') ||
    entryPath.includes('?') ||
    entryPath.includes('#') ||
    entryPath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') ||
    posix.normalize(entryPath) !== entryPath ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(entryPath)
  ) {
    throw new Error(`unsafe integrity entry path: ${String(entryPath)}`)
  }
  const base = new URL(baseUrl)
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('report base URL must use HTTP or HTTPS')
  const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`
  const resolved = new URL(entryPath, base)
  if (resolved.origin !== base.origin || !resolved.pathname.startsWith(basePath)) {
    throw new Error(`integrity entry escapes report base URL: ${entryPath}`)
  }
  return resolved
}

const PUBLIC_PROVENANCE_KEYS = new Set([
  'adapter_id',
  'capability_checked_at',
  'capability_hash',
  'compiled_request_hash',
  'compiler_id',
  'compiler_version',
  'connector_id',
  'decision_grade',
  'engine_id',
  'governance_mode',
  'ir_family',
  'ir_version',
  'job_id',
  'optimization_spec_hash',
  'problem_family',
  'request_id',
  'result_payload_hash',
  'validation_input_hash',
  'validation_report_hash',
])

export function projectPublicProvenance(provenance) {
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) return null
  return Object.fromEntries(
    Object.entries(provenance).filter(
      ([key, value]) =>
        PUBLIC_PROVENANCE_KEYS.has(key) &&
        (value === null || ['string', 'number', 'boolean'].includes(typeof value))
    )
  )
}

const PUBLIC_TEXT_RULES = [
  ['private-path', /(?:\/Users\/|\/Volumes\/|[A-Za-z]:\\Users\\)/i],
  ['customer-codename', /(?:贝壳|beike|bei-ke)/i],
  ['email-address', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ['private-key', /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/i],
  ['provider-secret', /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/],
  ['bearer-token', /\bBearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}\b/i],
  [
    'named-secret',
    /\b(?:password|passwd|authorization|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret)\b\s*[:=]\s*["']?[^\s"',}]{6,}/i,
  ],
  [
    'private-url',
    /https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|[^/\s"']+\.internal)\b/i,
  ],
]

export function publicTextViolations(value) {
  const text = (typeof value === 'string' ? value : JSON.stringify(value)).replace(
    /\b\d+@2x\.(?:png|webp)\b/gi,
    '[reviewed-retina-image]'
  )
  return PUBLIC_TEXT_RULES.filter(([, pattern]) => pattern.test(text)).map(([rule]) => rule)
}

export function assertPublicText(value, label) {
  const violations = publicTextViolations(value)
  if (violations.length > 0) {
    throw new Error(`${label}: public-release text policy rejected ${violations.join(',')}`)
  }
}

const readJsonLines = (file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))

export function computePublicEvidenceRoots({
  inputRoot,
  screenshotPlan,
  screenshotValidation,
  screenshotPrivacyValidation,
  caseRunById,
}) {
  const transcriptEntries = screenshotPlan.scenarios.map((item) => {
    const source = caseRunById.get(item.runId)
    if (!source) throw new Error(`${item.scenarioId}: source Run missing for public attestation`)
    const messages = readJsonLines(join(source.runDir, 'messages.jsonl'))
      .filter((message) => ['user', 'assistant'].includes(message.role))
      .map((message) => ({ role: message.role, content: message.content ?? '', timestamp: message.timestamp ?? null }))
    return { scenarioId: item.scenarioId, runId: item.runId, messages }
  })
  const screenshotEntries = screenshotPlan.scenarios.flatMap((item) =>
    item.screenshots.map((screenshot) => {
      const file = join(inputRoot, screenshot.file)
      if (!existsSync(file)) throw new Error(`${item.scenarioId}: screenshot missing: ${screenshot.file}`)
      const actualSha256 = sha256(readFileSync(file))
      if (actualSha256 !== screenshot.sha256) {
        throw new Error(`${item.scenarioId}: screenshot hash differs from reviewed plan: ${screenshot.file}`)
      }
      return {
        scenarioId: item.scenarioId,
        file: screenshot.file,
        sha256: screenshot.sha256,
        width: screenshot.width,
        height: screenshot.height,
      }
    })
  )
  const screenshotPlanSha256 = sha256(canonical(screenshotPlan))
  const publicScreenshotContentRootSha256 = sha256(canonical(screenshotEntries))
  if (
    screenshotPrivacyValidation?.schemaVersion !== 'solver.screenshot-privacy-validation/v1' ||
    screenshotPrivacyValidation.passed !== true ||
    screenshotPrivacyValidation.screenshots !== screenshotEntries.length ||
    screenshotPrivacyValidation.screenshotPlanSha256 !== screenshotPlanSha256 ||
    screenshotPrivacyValidation.screenshotContentRootSha256 !== publicScreenshotContentRootSha256 ||
    screenshotPrivacyValidation.ocr?.screenshotsWithText !== screenshotEntries.length ||
    screenshotPrivacyValidation.ocr?.sensitiveMatches !== 0
  ) {
    throw new Error('public screenshot privacy validation is missing or differs from current public images')
  }
  return {
    publicTranscriptContentRootSha256: sha256(canonical(transcriptEntries)),
    publicScreenshotContentRootSha256,
    screenshotPlanSha256,
    screenshotValidationSha256: sha256(canonical(screenshotValidation)),
    screenshotPrivacyValidationSha256: sha256(canonical(screenshotPrivacyValidation)),
  }
}

const HASH_PATTERN = /^[a-f0-9]{64}$/

export function validatePublicReleaseAttestation(attestation, evidenceRoots) {
  if (attestation?.schemaVersion !== 'solver.public-release-attestation/v1') {
    throw new Error('public release attestation is missing or has an unsupported schema')
  }
  if (attestation.audience !== 'public' || attestation.review?.status !== 'passed') {
    throw new Error('public release attestation must explicitly pass for a public audience')
  }
  const assertions = attestation.review?.assertions ?? {}
  for (const key of ['transcriptsContainNoSensitiveData', 'screenshotsContainNoSensitiveData', 'customerIdentifiersExcluded']) {
    if (assertions[key] !== true) throw new Error(`public release attestation assertion is not true: ${key}`)
  }
  if (!attestation.review?.reviewedAt || !attestation.review?.reviewer || !Array.isArray(attestation.review?.methods)) {
    throw new Error('public release attestation review identity, time, and methods are required')
  }
  for (const [key, expected] of Object.entries(evidenceRoots)) {
    const actual = attestation.evidence?.[key]
    if (!HASH_PATTERN.test(actual ?? '') || actual !== expected) {
      throw new Error(`public release attestation does not match current evidence: ${key}`)
    }
  }
  const metadata = attestation.metadata ?? {}
  if (
    typeof metadata.platformCommit !== 'string' ||
    typeof metadata.agentSkillVersion !== 'string' ||
    !Number.isInteger(metadata.representativeStabilityPasses) ||
    metadata.representativeStabilityPasses < 0
  ) {
    throw new Error('public release attestation metadata is incomplete')
  }
  return attestation
}

export function loadPublicReleaseAttestation(file, evidenceRoots) {
  if (!existsSync(file)) throw new Error(`public release attestation is required: ${file}`)
  const bytes = readFileSync(file)
  const attestation = validatePublicReleaseAttestation(JSON.parse(bytes), evidenceRoots)
  return { attestation, sha256: sha256(bytes) }
}
