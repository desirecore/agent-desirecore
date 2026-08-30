import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  buildInstalledCatalogReceipt,
  evaluateRegistryCatalogResolverResult,
  parseRegistryCatalogAcquisitionMessage,
  parseRegistryCatalogAcquisitionLocatorMessage,
  planRegistryCatalogPreExecutionSettlement,
  resolveServiceUninstallOwnership,
  registryCatalogRuntimeServerId,
} from '../scripts/registry-catalog-acquisition.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const skillPath = join(here, '..', 'SKILL.md')
const commitA = 'a'.repeat(40)
const commitB = 'b'.repeat(40)

function envelope(overrides = {}) {
  const sourceId = overrides.sourceId ?? 'registry:source-a'
  return {
    kind: 'app',
    sourceId,
    entryId: 'same-id',
    snapshot: {
      schemaVersion: 1,
      catalogSourceId: sourceId,
      catalogCommit: overrides.catalogCommit ?? commitA,
      catalogPath: 'entries/same-id',
      releaseVersion: '1.2.3',
      contentRef: 'v1.2.3',
      contentSha256: 'c'.repeat(64),
    },
    operation: {
      action: overrides.action ?? 'install',
      deviceId: overrides.deviceId ?? 'device-a',
    },
  }
}

function request(overrides = {}) {
  return envelope(overrides)
}

function pendingEntry(overrides = {}) {
  return {
    sourceId: overrides.sourceId ?? 'registry:source-a',
    entryId: overrides.entryId ?? 'same-id',
    deviceId: overrides.deviceId ?? 'device-a',
    deviceName: overrides.deviceName ?? 'Device A',
    status: overrides.status ?? 'installing',
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
  const mismatched = envelope()
  mismatched.snapshot.catalogSourceId = 'registry:source-b'
  assert.throws(
    () => parseRegistryCatalogAcquisitionMessage(`RegistryCatalogAcquisition=${JSON.stringify(mismatched)}`),
    /source_identity_mismatch/
  )
})

test('same entryId from source A and source B remains two exact acquisition identities', () => {
  const sourceA = parseRegistryCatalogAcquisitionMessage(
    `安装来源 A\nRegistryCatalogAcquisition=${JSON.stringify(envelope())}`
  )
  const sourceB = parseRegistryCatalogAcquisitionMessage(
    `安装来源 B\nRegistryCatalogAcquisition=${JSON.stringify(envelope({
      sourceId: 'registry:source-b',
      catalogCommit: commitB,
    }))}`
  )
  assert.equal(sourceA.request.entryId, sourceB.request.entryId)
  assert.notEqual(sourceA.request.sourceId, sourceB.request.sourceId)
  assert.notDeepEqual(sourceA.request.snapshot, sourceB.request.snapshot)
  assert.deepEqual(sourceA.request.operation, { action: 'install', deviceId: 'device-a' })
})

test('400/404 and every real resolver 409 preserve exact error codes and block execution', () => {
  const expected = request()
  for (const [status, errorCode] of [
    [400, 'registry_acquisition_invalid_request'],
    [404, 'registry_acquisition_not_found'],
    [409, 'registry_acquisition_snapshot_stale'],
    [409, 'registry_acquisition_blocked'],
    [409, 'registry_acquisition_client_upgrade_required'],
    [409, 'registry_acquisition_config_mismatch'],
    [409, 'registry_acquisition_install_guide_unavailable'],
    [409, 'registry_acquisition_receipt_missing'],
    [409, 'registry_acquisition_ownership_mismatch'],
  ]) {
    assert.deepEqual(
      evaluateRegistryCatalogResolverResult(expected, status, {
        success: false,
        errorCode,
        reasons: ['missing-canonical-or-kind-mismatch'],
      }),
      {
        allowed: false,
        errorCode,
        status,
        mayExecuteCommands: false,
        reasons: ['missing-canonical-or-kind-mismatch'],
      }
    )
  }
  assert.deepEqual(
    evaluateRegistryCatalogResolverResult(expected, 409, { success: false, errorCode: 'blocked' }),
    { allowed: false, errorCode: 'unexpected_resolver_error', status: 409, mayExecuteCommands: false }
  )
})

test('parsed locator settles resolver/Human Gate/pre-execution stops without cross-source writes', () => {
  const acquisition = parseRegistryCatalogAcquisitionMessage(
    `RegistryCatalogAcquisition=${JSON.stringify(envelope({
      sourceId: 'registry:source-b',
      catalogCommit: commitB,
      action: 'reinstall',
    }))}`
  )
  const entries = [
    pendingEntry({ sourceId: 'registry:source-a', status: 'reinstalling' }),
    pendingEntry({ sourceId: 'registry:source-b', status: 'reinstalling' }),
  ]
  for (const stage of ['resolver', 'human_gate', 'pre_execution']) {
    assert.deepEqual(planRegistryCatalogPreExecutionSettlement({ stage, locator: acquisition.locator, entries }), {
      allowed: false,
      mayExecuteCommands: false,
      settlement: {
        sourceId: 'registry:source-b',
        entryId: 'same-id',
        deviceId: 'device-a',
        status: 'installed',
      },
      reason: `registry_catalog_${stage}_stopped`,
    })
  }
})

test('first install stops as failed, uninstall/Human Gate cancellation restores installed', () => {
  const install = parseRegistryCatalogAcquisitionMessage(
    `RegistryCatalogAcquisition=${JSON.stringify(envelope())}`
  )
  assert.equal(planRegistryCatalogPreExecutionSettlement({
    stage: 'parse',
    locator: install.locator,
    entries: [pendingEntry()],
  }).settlement.status, 'failed')

  const uninstall = parseRegistryCatalogAcquisitionMessage(
    `RegistryCatalogAcquisition=${JSON.stringify(envelope({ action: 'uninstall' }))}`
  )
  assert.equal(planRegistryCatalogPreExecutionSettlement({
    stage: 'human_gate',
    locator: uninstall.locator,
    entries: [pendingEntry({ status: 'uninstalling' })],
  }).settlement.status, 'installed')

  assert.deepEqual(planRegistryCatalogPreExecutionSettlement({
    stage: 'human_gate',
    locator: uninstall.locator,
    entries: [pendingEntry({ status: 'uninstalling', deviceId: 'device-b' })],
  }), {
    allowed: false,
    mayExecuteCommands: false,
    settlement: null,
    reason: 'registry_catalog_pending_intent_not_found',
  })
})

test('missing or malformed machine input has no locator and cannot guess a ledger write', () => {
  assert.throws(() => parseRegistryCatalogAcquisitionMessage('请安装 Same ID'), /machine_line_missing/)
  assert.throws(
    () => parseRegistryCatalogAcquisitionMessage('RegistryCatalogAcquisition={"kind":"app"'),
    /machine_line_malformed/
  )
  assert.throws(
    () => planRegistryCatalogPreExecutionSettlement({
      stage: 'parse',
      locator: null,
      entries: [pendingEntry()],
    }),
    /settlement_locator_invalid/
  )
})

test('a parsed App locator can settle an invalid snapshot without authorizing acquisition', () => {
  const invalid = envelope()
  invalid.snapshot.catalogCommit = 'mutable-main'
  const message = `RegistryCatalogAcquisition=${JSON.stringify(invalid)}`
  const locator = parseRegistryCatalogAcquisitionLocatorMessage(message)
  assert.deepEqual(locator, {
    sourceId: 'registry:source-a',
    entryId: 'same-id',
    operation: { action: 'install', deviceId: 'device-a' },
  })
  assert.throws(() => parseRegistryCatalogAcquisitionMessage(message), /catalog_commit_invalid/)
  assert.equal(planRegistryCatalogPreExecutionSettlement({
    stage: 'parse',
    locator,
    entries: [pendingEntry()],
  }).settlement.status, 'failed')
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

test('Service operation remains optional for resolver compatibility', () => {
  const { operation: _operation, ...serviceRequest } = request()
  const parsed = parseRegistryCatalogAcquisitionMessage(
    `RegistryCatalogAcquisition=${JSON.stringify({ ...serviceRequest, kind: 'service' })}`
  )
  assert.equal(parsed.locator, undefined)
  assert.equal(parsed.request.kind, 'service')
  assert.equal(parsed.request.operation, undefined)
})

test('Service 200 response without install or connection fails closed before execution', () => {
  const expected = { ...request(), kind: 'service' }
  const baseData = {
    kind: 'service',
    sourceId: expected.sourceId,
    entryId: expected.entryId,
    snapshot: expected.snapshot,
    manifest: { id: expected.entryId, type: 'mcp' },
  }
  assert.throws(() => evaluateRegistryCatalogResolverResult(expected, 200, {
    success: true,
    data: { ...baseData, connection: { transport: 'stdio', command: 'npx' } },
  }), /resolver_response_invalid/)
  assert.throws(() => evaluateRegistryCatalogResolverResult(expected, 200, {
    success: true,
    data: { ...baseData, install: { method: 'npx', packageName: '@example/server' } },
  }), /resolver_response_invalid/)
})

test('MCP runtimeServerId is persisted only inside the validated installed-entry receipt', () => {
  const expected = request()
  const runtimeServerId = registryCatalogRuntimeServerId(expected.sourceId, expected.entryId)
  assert.deepEqual(buildInstalledCatalogReceipt({
    kind: 'service',
    snapshot: expected.snapshot,
    entryId: expected.entryId,
    runtimeServerId,
  }), {
    ...expected.snapshot,
    kind: 'service',
    entryId: expected.entryId,
    runtimeServerId,
  })
  assert.throws(() => buildInstalledCatalogReceipt({
    kind: 'service',
    snapshot: expected.snapshot,
    entryId: expected.entryId,
    runtimeServerId: 'bad/runtime/key',
  }), /runtime_server_id_invalid/)
  assert.throws(() => buildInstalledCatalogReceipt({
    kind: 'service',
    snapshot: expected.snapshot,
    entryId: expected.entryId,
    runtimeServerId: 'well_formed_but_wrong',
  }), /runtime_server_id_mismatch/)
})

test('Service uninstall authorizes only exact active service receipt and runtime key', () => {
  const expected = request({ action: 'uninstall' })
  const locator = {
    sourceId: expected.sourceId,
    entryId: expected.entryId,
    operation: expected.operation,
  }
  const receipt = buildInstalledCatalogReceipt({
    kind: 'service',
    snapshot: expected.snapshot,
    entryId: expected.entryId,
    runtimeServerId: registryCatalogRuntimeServerId(expected.sourceId, expected.entryId),
  })
  const entry = { ...pendingEntry({ status: 'uninstalling' }), catalogReceipt: receipt }
  assert.deepEqual(resolveServiceUninstallOwnership({ locator, snapshot: expected.snapshot, entries: [entry] }), {
    allowed: true,
    deleteAllowed: true,
    sourceId: expected.sourceId,
    entryId: expected.entryId,
    deviceId: expected.operation.deviceId,
    runtimeServerId: registryCatalogRuntimeServerId(expected.sourceId, expected.entryId),
  })
  for (const invalidReceipt of [
    { ...receipt, kind: undefined },
    { ...receipt, kind: 'app' },
    { ...receipt, runtimeServerId: undefined },
  ]) {
    assert.equal(resolveServiceUninstallOwnership({
      locator,
      snapshot: expected.snapshot,
      entries: [{ ...entry, catalogReceipt: invalidReceipt }],
    }).deleteAllowed, false)
  }
  assert.equal(resolveServiceUninstallOwnership({
    locator,
    snapshot: expected.snapshot,
    entries: [{ ...entry, sourceId: 'registry:source-b' }],
  }).deleteAllowed, false)
})

test('Skill contract has no fixed official/local Registry fallback and resolves before execution', async () => {
  const skill = await readFile(skillPath, 'utf8')
  assert.doesNotMatch(skill, /registry\/official\/entries/)
  assert.match(skill, /POST \/api\/registry\/acquisitions\/resolve/)
  assert.match(skill, /禁止 fallback/)
  assert.match(skill, /plan-settlement/)
  assert.match(skill, /lifecycle receipt/)
  assert.match(skill, /registry_acquisition_receipt_missing/)
  assert.ok(skill.indexOf('解析机器消息并调用 resolver') < skill.indexOf('环境校验'))
  assert.ok(skill.indexOf('### 执行前协议') < skill.indexOf('`docker version`'))
})
