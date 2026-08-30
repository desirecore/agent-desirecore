import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  evaluateRegistryCatalogResolverResult,
  parseRegistryCatalogAcquisitionMessage,
} from '../scripts/registry-catalog-acquisition.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const skillPath = join(here, '..', 'SKILL.md')
const commitA = 'a'.repeat(40)
const commitB = 'b'.repeat(40)

function request(overrides = {}) {
  const sourceId = overrides.sourceId ?? 'registry:source-a'
  return {
    kind: 'app',
    sourceId,
    entryId: 'same-id',
    snapshot: {
      schemaVersion: 1,
      catalogSourceId: sourceId,
      catalogCommit: overrides.catalogCommit ?? commitA,
      catalogPath: 'entries/same-id/catalog-metadata.v1.json',
      releaseVersion: '1.2.3',
      contentRef: 'v1.2.3',
      contentSha256: 'c'.repeat(64),
    },
  }
}

function success(expected, overrides = {}) {
  return {
    success: true,
    data: {
      kind: expected.kind,
      sourceId: expected.sourceId,
      entryId: expected.entryId,
      snapshot: expected.snapshot,
      manifest: { id: expected.entryId, type: 'docker-app', name: 'Same ID' },
      installGuide: '# Server-authorized guide\n',
      ...overrides,
    },
  }
}

test('missing, duplicate, and malformed machine lines fail closed', () => {
  assert.throws(() => parseRegistryCatalogAcquisitionMessage('请安装 Same ID'), /machine_line_missing/)
  assert.throws(
    () => parseRegistryCatalogAcquisitionMessage(
      `RegistryCatalogAcquisition=${JSON.stringify(request())}\nRegistryCatalogAcquisition=${JSON.stringify(request())}`
    ),
    /machine_line_ambiguous/
  )
  assert.throws(
    () => parseRegistryCatalogAcquisitionMessage('RegistryCatalogAcquisition={"kind":"app"'),
    /machine_line_malformed/
  )
})

test('App request rejects caller-provided install/connection and source/snapshot mismatch', () => {
  assert.throws(
    () => parseRegistryCatalogAcquisitionMessage(
      `RegistryCatalogAcquisition=${JSON.stringify({ ...request(), install: { command: 'bash' } })}`
    ),
    /app_client_config_forbidden/
  )
  const mismatched = request()
  mismatched.snapshot.catalogSourceId = 'registry:source-b'
  assert.throws(
    () => parseRegistryCatalogAcquisitionMessage(`RegistryCatalogAcquisition=${JSON.stringify(mismatched)}`),
    /source_identity_mismatch/
  )
})

test('same entryId from source A and source B remains two exact acquisition identities', () => {
  const sourceA = parseRegistryCatalogAcquisitionMessage(
    `安装来源 A\nRegistryCatalogAcquisition=${JSON.stringify(request())}`
  )
  const sourceB = parseRegistryCatalogAcquisitionMessage(
    `安装来源 B\nRegistryCatalogAcquisition=${JSON.stringify(request({
      sourceId: 'registry:source-b',
      catalogCommit: commitB,
    }))}`
  )
  assert.equal(sourceA.entryId, sourceB.entryId)
  assert.notEqual(sourceA.sourceId, sourceB.sourceId)
  assert.notDeepEqual(sourceA.snapshot, sourceB.snapshot)
})

test('400/404 and every frozen 409 result block execution', () => {
  const expected = request()
  for (const [status, errorCode] of [
    [400, 'invalid'],
    [404, 'not_found'],
    [409, 'stale'],
    [409, 'blocked'],
    [409, 'client_upgrade_required'],
    [409, 'config_mismatch'],
    [409, 'install_guide_unavailable'],
  ]) {
    assert.deepEqual(
      evaluateRegistryCatalogResolverResult(expected, status, { success: false, errorCode }),
      { allowed: false, errorCode, status }
    )
  }
})

test('valid 200 response returns only server-authorized App manifest and install guide', () => {
  const expected = request()
  const result = evaluateRegistryCatalogResolverResult(expected, 200, success(expected, {
    snapshot: {
      contentSha256: expected.snapshot.contentSha256,
      releaseVersion: expected.snapshot.releaseVersion,
      catalogPath: expected.snapshot.catalogPath,
      catalogCommit: expected.snapshot.catalogCommit,
      catalogSourceId: expected.snapshot.catalogSourceId,
      schemaVersion: expected.snapshot.schemaVersion,
      contentRef: expected.snapshot.contentRef,
    },
    install: { command: 'must-not-be-consumed-by-app' },
    connection: { url: 'http://must-not-be-consumed.invalid' },
  }))
  assert.deepEqual(result, {
    allowed: true,
    kind: 'app',
    sourceId: expected.sourceId,
    entryId: expected.entryId,
    snapshot: expected.snapshot,
    manifest: { id: expected.entryId, type: 'docker-app', name: 'Same ID' },
    installGuide: '# Server-authorized guide\n',
  })
})

test('response source, snapshot, manifest identity, or install guide mismatch fails closed', () => {
  const expected = request()
  assert.throws(
    () => evaluateRegistryCatalogResolverResult(expected, 200, success(expected, { sourceId: 'registry:source-b' })),
    /resolver_identity_mismatch/
  )
  assert.throws(
    () => evaluateRegistryCatalogResolverResult(expected, 200, success(expected, {
      snapshot: { ...expected.snapshot, catalogCommit: commitB },
    })),
    /resolver_identity_mismatch/
  )
  assert.throws(
    () => evaluateRegistryCatalogResolverResult(expected, 200, success(expected, {
      manifest: { id: 'other-id', type: 'docker-app' },
    })),
    /manifest_identity_mismatch/
  )
  assert.throws(
    () => evaluateRegistryCatalogResolverResult(expected, 200, success(expected, { installGuide: '' })),
    /install_guide_invalid/
  )
})

test('Service keeps only resolver-returned install and connection after exact identity validation', () => {
  const expected = {
    ...request(),
    kind: 'service',
    install: { method: 'npx', packageName: '@example/server' },
    connection: { transport: 'stdio', command: 'npx', args: ['@example/server'] },
  }
  const result = evaluateRegistryCatalogResolverResult(expected, 200, {
    success: true,
    data: {
      kind: 'service',
      sourceId: expected.sourceId,
      entryId: expected.entryId,
      snapshot: expected.snapshot,
      manifest: { id: expected.entryId, type: 'mcp', name: 'Example MCP' },
      install: { method: 'npx', packageName: '@example/server@1.2.3' },
      connection: { transport: 'stdio', command: 'npx', args: ['@example/server@1.2.3'] },
    },
  })
  assert.deepEqual(result, {
    allowed: true,
    kind: 'service',
    sourceId: expected.sourceId,
    entryId: expected.entryId,
    snapshot: expected.snapshot,
    manifest: { id: expected.entryId, type: 'mcp', name: 'Example MCP' },
    install: { method: 'npx', packageName: '@example/server@1.2.3' },
    connection: { transport: 'stdio', command: 'npx', args: ['@example/server@1.2.3'] },
  })
})

test('Skill contract has no fixed official/local Registry fallback and resolves before execution', async () => {
  const skill = await readFile(skillPath, 'utf8')
  assert.doesNotMatch(skill, /registry\/official\/entries/)
  assert.match(skill, /POST \/api\/registry\/acquisitions\/resolve/)
  assert.match(skill, /禁止 fallback/)
  assert.ok(skill.indexOf('解析机器消息并调用 resolver') < skill.indexOf('环境校验'))
  assert.ok(skill.indexOf('### 执行前协议') < skill.indexOf('`docker version`'))
})
