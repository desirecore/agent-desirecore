import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonical, resolveSafeRemoteEntryUrl } from './public-release-policy.mjs'

const baseUrl = (process.env.REPORT_BASE_URL ?? 'https://build.desirecore.cc/solver-agent-team/').replace(/\/?$/, '/')
const inputRoot = process.env.SOLVER_REPORT_INPUT_ROOT ?? process.cwd()
const validationFile =
  process.env.SOLVER_REPORT_DEPLOYMENT_VALIDATION_FILE ?? join(inputRoot, 'report-web', 'deployment-validation.json')

async function fetchWithoutRedirect(url, init = {}) {
  const response = await fetch(url, { ...init, redirect: 'manual' })
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`redirect-rejected:${response.status}`)
  }
  return response
}

const integrityResponse = await fetchWithoutRedirect(new URL('integrity.json', baseUrl))
if (!integrityResponse.ok) throw new Error(`integrity.json: ${integrityResponse.status}`)
const integrity = await integrityResponse.json()
const failures = []
let checked = 0
let checkedBytes = 0
let cursor = 0

async function worker() {
  while (cursor < integrity.entries.length) {
    const index = cursor++
    const entry = integrity.entries[index]
    try {
      const entryUrl = resolveSafeRemoteEntryUrl(baseUrl, entry.path)
      const response = await fetchWithoutRedirect(entryUrl)
      if (!response.ok) {
        failures.push({ path: entry.path, issue: `http-${response.status}` })
        continue
      }
      const bytes = Buffer.from(await response.arrayBuffer())
      const digest = createHash('sha256').update(bytes).digest('hex')
      if (bytes.length !== entry.bytes || digest !== entry.sha256) {
        failures.push({ path: entry.path, issue: 'integrity-mismatch' })
      }
      checked += 1
      checkedBytes += bytes.length
    } catch (error) {
      failures.push({ path: entry.path, issue: error instanceof Error ? error.message : String(error) })
    }
  }
}
await Promise.all(Array.from({ length: 12 }, () => worker()))

const rootResponse = await fetchWithoutRedirect(baseUrl)
const mediaResponse = await fetchWithoutRedirect(new URL('media/original/boundary.qp-unsupported/01@2x.png', baseUrl), {
  method: 'HEAD',
})
const [buildResponse, manifestResponse] = await Promise.all([
  fetchWithoutRedirect(new URL('build.json', baseUrl)),
  fetchWithoutRedirect(new URL('data/manifest.json', baseUrl)),
])
const build = buildResponse.ok ? await buildResponse.json() : null
const manifest = manifestResponse.ok ? await manifestResponse.json() : null
if (build?.gates?.publicReleasePrivacy !== 'pass') failures.push({ path: 'build.json', issue: 'public-release-privacy-gate' })
if (
  !build?.publicReleaseAttestationSha256 ||
  build.publicReleaseAttestationSha256 !== manifest?.publicReleaseAttestationSha256
)
  failures.push({ path: 'build.json', issue: 'public-release-attestation-mismatch' })
if (
  !build ||
  !manifest ||
  build.buildId !== manifest.buildId ||
  build.contentRootSha256 !== manifest.contentRootSha256 ||
  integrity.contentRootSha256 !== manifest.contentRootSha256 ||
  canonical(build.publicEvidenceRoots) !== canonical(manifest.publicEvidenceRoots) ||
  canonical(build.counts) !== canonical(manifest.counts) ||
  build.integrityEntries !== integrity.entries.length ||
  !integrity.entries.some((entry) => entry.path === 'build.json')
)
  failures.push({ path: 'build.json', issue: 'build-manifest-integrity-projection' })
const report = {
  schemaVersion: 'solver.web-deployment-validation/v1',
  testedAt: new Date().toISOString(), baseUrl,
  contentRootSha256: integrity.contentRootSha256,
  checkedEntries: checked, checkedBytes,
  rootStatus: rootResponse.status,
  csp: rootResponse.headers.get('content-security-policy'),
  mediaStatus: mediaResponse.status,
  mediaCacheControl: mediaResponse.headers.get('cache-control'),
  failures,
  passed:
    failures.length === 0 &&
    checked === integrity.entries.length &&
    rootResponse.ok &&
    mediaResponse.ok &&
    buildResponse.ok &&
    manifestResponse.ok,
}
writeFileSync(validationFile, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
if (!report.passed) process.exitCode = 1
