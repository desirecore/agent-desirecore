import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import {
  assertPublicText,
  projectPublicProvenance,
  resolveSafeRemoteEntryUrl,
  resolveSafeOutputRoot,
  validatePublicReleaseAttestation,
} from '../scripts/public-release-policy.mjs'

test('输出目录只能位于证据 report-web 的真实专用子目录', (context) => {
  const sandbox = mkdtempSync(join(tmpdir(), 'solver-report-path-policy-'))
  context.after(() => rmSync(sandbox, { recursive: true, force: true }))
  const roots = {
    inputRoot: join(sandbox, 'evidence'),
    codeRoot: join(sandbox, 'agent-desirecore'),
    appRoot: join(sandbox, 'desirecore-app'),
  }
  for (const path of [...Object.values(roots), join(roots.inputRoot, 'report-web')]) mkdirSync(path, { recursive: true })
  const safeOutput = join(roots.inputRoot, 'report-web', 'dist')
  assert.equal(
    resolveSafeOutputRoot({ ...roots, requestedOutputRoot: safeOutput }),
    join(realpathSync(join(roots.inputRoot, 'report-web')), 'dist')
  )
  for (const requestedOutputRoot of [
    '/',
    sandbox,
    roots.inputRoot,
    join(roots.inputRoot, 'report-web'),
    join(roots.codeRoot, 'web-output'),
    join(sandbox, 'unmanaged-report-output'),
  ]) {
    assert.throws(() => resolveSafeOutputRoot({ ...roots, requestedOutputRoot: requestedOutputRoot }))
  }

  const symlinkInputRoot = join(sandbox, 'symlink-evidence')
  const externalTarget = join(sandbox, 'external-target')
  mkdirSync(symlinkInputRoot)
  mkdirSync(externalTarget)
  symlinkSync(externalTarget, join(symlinkInputRoot, 'report-web'))
  assert.throws(() =>
    resolveSafeOutputRoot({
      inputRoot: symlinkInputRoot,
      codeRoot: roots.codeRoot,
      appRoot: roots.appRoot,
      requestedOutputRoot: join(symlinkInputRoot, 'report-web', 'dist'),
    })
  )
})

test('远端完整性条目不能改变 origin 或越过报告路径', () => {
  assert.equal(
    resolveSafeRemoteEntryUrl('https://build.example.com/solver-agent-team/', 'media/original/case/01@2x.png').href,
    'https://build.example.com/solver-agent-team/media/original/case/01@2x.png'
  )
  for (const path of [
    'https://127.0.0.1/private',
    'http://evil.example/private',
    '../admin',
    '/absolute',
    'media\\secret',
    'media/%2e%2e/secret',
    'media//secret',
    'media/file?redirect=http://127.0.0.1',
  ]) {
    assert.throws(() => resolveSafeRemoteEntryUrl('https://build.example.com/solver-agent-team/', path))
  }
})

test('provenance 使用递归数据不可穿透的字段白名单', () => {
  assert.deepEqual(
    projectPublicProvenance({
      engine_id: 'scip-build',
      request_id: 'request-1',
      endpoint: 'https://private.internal',
      nested: { access_token: 'secret-value' },
    }),
    { engine_id: 'scip-build', request_id: 'request-1' }
  )
})

test('公开文本策略拒绝身份、凭据、私有路径和私有网络地址', () => {
  assert.doesNotThrow(() => assertPublicText('SCIP 10.0.2 · request 853ca9c7-440b', 'safe'))
  for (const value of [
    'admin@example.com',
    '/Users/reviewer/private/report.json',
    'authorization: Bearer abcdefghijklmnop',
    'password=not-for-public',
    'http://192.168.1.10/private',
  ]) {
    assert.throws(() => assertPublicText(value, 'unsafe'))
  }
})

test('公开发布证明必须绑定全部证据根并显式通过', () => {
  const evidenceRoots = Object.fromEntries(
    [
      'publicTranscriptContentRootSha256',
      'publicScreenshotContentRootSha256',
      'screenshotPlanSha256',
      'screenshotValidationSha256',
      'screenshotPrivacyValidationSha256',
    ].map((key, index) => [key, String(index + 1).repeat(64)])
  )
  const attestation = {
    schemaVersion: 'solver.public-release-attestation/v1',
    audience: 'public',
    review: {
      status: 'passed',
      reviewedAt: '2026-08-30T09:00:00.000Z',
      reviewer: 'release-review',
      methods: ['text-scan', 'visual-review'],
      assertions: {
        transcriptsContainNoSensitiveData: true,
        screenshotsContainNoSensitiveData: true,
        customerIdentifiersExcluded: true,
      },
    },
    evidence: evidenceRoots,
    metadata: { platformCommit: 'be0cc2cce', agentSkillVersion: '4.4.4', representativeStabilityPasses: 20 },
  }
  assert.equal(validatePublicReleaseAttestation(attestation, evidenceRoots), attestation)
  assert.throws(() =>
    validatePublicReleaseAttestation(
      { ...attestation, evidence: { ...evidenceRoots, screenshotPlanSha256: '0'.repeat(64) } },
      evidenceRoots
    )
  )
})
