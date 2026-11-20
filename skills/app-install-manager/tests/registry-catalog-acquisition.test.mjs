import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  buildInstalledCatalogReceiptPatch,
  buildServiceCatalogDeleteTarget,
  completeServiceCatalogReceipt,
  evaluateRegistryCatalogRegisterResult,
  evaluateRegistryCatalogResolverResult,
  inspectRegistryCatalogOperation,
  parseRegistryCatalogAcquisitionMessage,
  parseRegistryCatalogAcquisitionLocatorMessage,
  planRegistryCatalogPreExecutionSettlement,
  resolveServiceUninstallOwnership,
  registryCatalogRuntimeServerId,
} from '../scripts/registry-catalog-acquisition.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const skillPath = join(here, '..', 'SKILL.md')
const scriptPath = join(here, '..', 'scripts', 'registry-catalog-acquisition.mjs')
const legacyServicesPath = join(here, '..', 'references', 'legacy-services.md')
const commitA = 'a'.repeat(40)
const commitB = 'b'.repeat(40)
const operationA = '11111111-1111-4111-8111-111111111111'
const operationB = '22222222-2222-4222-8222-222222222222'

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
      releaseVersion: overrides.releaseVersion ?? '1.2.3',
      contentRef: 'v1.2.3',
      contentSha256: 'c'.repeat(64),
    },
    operation: {
      action: overrides.action ?? 'install',
      deviceId: overrides.deviceId ?? 'device-a',
      operationId: overrides.operationId ?? operationA,
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
    operationId: overrides.operationId ?? operationA,
  }
}

function manifestFor(expected) {
  return {
    id: expected.entryId,
    type: expected.kind === 'service' ? 'mcp' : 'docker-app',
    name: 'Same ID',
    version: expected.snapshot.releaseVersion,
    description: 'Server-authorized lifecycle',
  }
}

function receiptFor(expected, overrides = {}) {
  const manifest = manifestFor(expected)
  return {
    ...expected.snapshot,
    kind: expected.kind,
    entryId: expected.entryId,
    lifecycle: {
      manifest,
      ...(expected.kind === 'app' ? { installGuide: '# Server-authorized guide\n' } : {}),
    },
    ...overrides,
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
      manifest: manifestFor(expected),
      installGuide: '# Server-authorized guide\n',
      catalogReceipt: receiptFor(expected),
      ...overrides,
    },
  }
}

test('原生应用保持 App 收据与原始 type，禁止转成内部服务或混用 Docker 收据', () => {
  const expected = request()
  const body = success(expected)
  body.data.manifest.type = 'native-app'
  body.data.catalogReceipt.lifecycle.manifest.type = 'native-app'
  const accepted = evaluateRegistryCatalogResolverResult(expected, 200, body)
  assert.equal(accepted.allowed, true)
  assert.equal(accepted.kind, 'app')
  assert.equal(accepted.catalogReceipt.lifecycle.manifest.type, 'native-app')
  const patch = buildInstalledCatalogReceiptPatch({ sourceId: expected.sourceId, entryId: expected.entryId, operationId: operationA, catalogReceipt: accepted.catalogReceipt })
  assert.equal(patch.catalogReceipt.kind, 'app')
  assert.equal(patch.catalogReceipt.runtimeServerId, undefined)
  assert.throws(() => buildInstalledCatalogReceiptPatch({ sourceId: expected.sourceId, entryId: expected.entryId, operationId: operationA, catalogReceipt: accepted.catalogReceipt, runtimeServerId: 'internal-tool' }), /forbidden/)
  body.data.catalogReceipt.lifecycle.manifest.type = 'docker-app'
  assert.throws(() => evaluateRegistryCatalogResolverResult(expected, 200, body), /manifest_mismatch/)
})

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
  assert.deepEqual(sourceA.request.operation, {
    action: 'install', deviceId: 'device-a', operationId: operationA,
  })
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
        operationId: operationA,
        status: 'installed',
      },
      reason: `registry_catalog_${stage}_stopped`,
    })
  }
  assert.equal(planRegistryCatalogPreExecutionSettlement({
    stage: 'resolver',
    locator: acquisition.locator,
    entries: [pendingEntry({
      sourceId: 'registry:source-b',
      status: 'reinstalling',
      operationId: operationB,
    })],
  }).settlement, null)
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
    operation: { action: 'install', deviceId: 'device-a', operationId: operationA },
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
    manifest: manifestFor(expected),
    installGuide: '# Server-authorized guide\n',
    catalogReceipt: receiptFor(expected),
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

test('server receipt candidate is mandatory, immutable, and capped at 64 KiB', () => {
  const expected = request()
  const missing = success(expected)
  delete missing.data.catalogReceipt
  assert.throws(
    () => evaluateRegistryCatalogResolverResult(expected, 200, missing),
    /resolver_response_invalid/
  )
  assert.throws(
    () => evaluateRegistryCatalogResolverResult(expected, 200, success(expected, {
      catalogReceipt: {
        ...receiptFor(expected),
        catalogCommit: commitB,
      },
    })),
    /receipt_identity_mismatch/
  )
  assert.throws(
    () => evaluateRegistryCatalogResolverResult(expected, 200, success(expected, {
      catalogReceipt: {
        ...receiptFor(expected),
        lifecycle: {
          ...receiptFor(expected).lifecycle,
          manifest: { ...manifestFor(expected), version: '9.9.9' },
        },
      },
    })),
    /lifecycle_identity_mismatch/
  )
  const oversizedGuide = 'x'.repeat(64 * 1024 + 1)
  assert.throws(
    () => evaluateRegistryCatalogResolverResult(expected, 200, success(expected, {
      installGuide: oversizedGuide,
      catalogReceipt: {
        ...receiptFor(expected),
        lifecycle: { manifest: manifestFor(expected), installGuide: oversizedGuide },
      },
    })),
    /receipt_install_guide_invalid/
  )
  assert.throws(
    () => evaluateRegistryCatalogResolverResult(expected, 200, success(expected, {
      installGuide: '# changed guide\n',
    })),
    /receipt_install_guide_mismatch/
  )

  const candidate = receiptFor(expected)
  assert.deepEqual(buildInstalledCatalogReceiptPatch({
    sourceId: expected.sourceId,
    entryId: expected.entryId,
    operationId: expected.operation.operationId,
    catalogReceipt: candidate,
  }), {
    sourceId: expected.sourceId,
    operationId: expected.operation.operationId,
    status: 'installed',
    version: expected.snapshot.releaseVersion,
    catalogReceipt: candidate,
  })
})

test('reinstall atomically switches v1 to v2 while failure keeps v1 facts', () => {
  const oldRequest = request({ releaseVersion: '1.0.0', catalogCommit: commitA })
  const target = request({
    action: 'reinstall',
    releaseVersion: '2.0.0',
    catalogCommit: commitB,
    operationId: operationB,
  })
  const oldReceipt = receiptFor(oldRequest)
  const pendingCatalogReceipt = {
    ...target.snapshot,
    kind: 'app',
    entryId: target.entryId,
  }
  const candidate = receiptFor(target)
  const resolved = evaluateRegistryCatalogResolverResult(target, 200, success(target))
  assert.deepEqual(resolved.catalogReceipt, candidate)
  assert.deepEqual(buildInstalledCatalogReceiptPatch({
    sourceId: target.sourceId,
    entryId: target.entryId,
    operationId: target.operation.operationId,
    catalogReceipt: resolved.catalogReceipt,
  }), {
    sourceId: target.sourceId,
    operationId: target.operation.operationId,
    status: 'installed',
    version: '2.0.0',
    catalogReceipt: candidate,
  })

  const failure = planRegistryCatalogPreExecutionSettlement({
    stage: 'human_gate',
    locator: { sourceId: target.sourceId, entryId: target.entryId, operation: target.operation },
    entries: [{
      ...pendingEntry({ status: 'reinstalling', operationId: operationB }),
      version: '1.0.0',
      catalogReceipt: oldReceipt,
      pendingCatalogReceipt,
    }],
  })
  assert.deepEqual(failure.settlement, {
    sourceId: target.sourceId,
    entryId: target.entryId,
    deviceId: target.operation.deviceId,
    operationId: target.operation.operationId,
    status: 'installed',
  })
  assert.equal(Object.hasOwn(failure.settlement, 'version'), false)
  assert.equal(Object.hasOwn(failure.settlement, 'catalogReceipt'), false)
  assert.equal(Object.hasOwn(failure.settlement, 'pendingCatalogReceipt'), false)

  assert.throws(() => evaluateRegistryCatalogResolverResult(target, 200, success(target, {
    catalogReceipt: { ...candidate, catalogCommit: commitA },
  })), /receipt_identity_mismatch/)
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
      manifest: manifestFor(expected),
      install: { method: 'npx', packageName: '@example/server@1.2.3' },
      connection: { transport: 'stdio', command: 'npx', args: ['@example/server@1.2.3'] },
      catalogReceipt: receiptFor(expected),
    },
  })
  assert.deepEqual(result, {
    allowed: true,
    kind: 'service',
    sourceId: expected.sourceId,
    entryId: expected.entryId,
    snapshot: expected.snapshot,
    manifest: manifestFor(expected),
    install: { method: 'npx', packageName: '@example/server@1.2.3' },
    connection: { transport: 'stdio', command: 'npx', args: ['@example/server@1.2.3'] },
    catalogReceipt: receiptFor(expected),
  })
})

test('App and Service both require a valid operation UUID', () => {
  const { operation: _operation, ...serviceRequest } = request()
  assert.throws(
    () => parseRegistryCatalogAcquisitionMessage(
      `RegistryCatalogAcquisition=${JSON.stringify({ ...serviceRequest, kind: 'service' })}`
    ),
    /(?:request|operation)_invalid/
  )
  const missingId = request()
  delete missingId.operation.operationId
  assert.throws(
    () => parseRegistryCatalogAcquisitionMessage(
      `RegistryCatalogAcquisition=${JSON.stringify(missingId)}`
    ),
    /operation_invalid/
  )
  for (const kind of ['app', 'service']) {
    assert.throws(
      () => parseRegistryCatalogAcquisitionMessage(
        `RegistryCatalogAcquisition=${JSON.stringify({
          ...request(),
          kind,
          operation: { ...request().operation, operationId: 'not-a-uuid' },
        })}`
      ),
      /operation_id_invalid/
    )
  }
})

test('Service 200 response without install or connection fails closed before execution', () => {
  const expected = { ...request(), kind: 'service' }
  const baseData = {
    kind: 'service',
    sourceId: expected.sourceId,
    entryId: expected.entryId,
    snapshot: expected.snapshot,
    manifest: manifestFor(expected),
    catalogReceipt: receiptFor(expected),
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

test('MCP only completes the server receipt candidate and builds a CAS-safe PATCH', () => {
  const expected = { ...request(), kind: 'service' }
  const runtimeServerId = registryCatalogRuntimeServerId(expected.sourceId, expected.entryId)
  const candidate = receiptFor(expected)
  assert.deepEqual(completeServiceCatalogReceipt(candidate, runtimeServerId), {
    ...candidate,
    runtimeServerId,
  })
  assert.deepEqual(buildInstalledCatalogReceiptPatch({
    sourceId: expected.sourceId,
    entryId: expected.entryId,
    operationId: expected.operation.operationId,
    catalogReceipt: candidate,
    runtimeServerId,
  }), {
    sourceId: expected.sourceId,
    operationId: expected.operation.operationId,
    status: 'installed',
    version: expected.snapshot.releaseVersion,
    catalogReceipt: { ...candidate, runtimeServerId },
  })
  assert.throws(
    () => completeServiceCatalogReceipt(candidate, 'well_formed_but_wrong'),
    /runtime_server_id_mismatch/
  )
  assert.throws(
    () => buildInstalledCatalogReceiptPatch({
      sourceId: 'registry:source-b',
      entryId: expected.entryId,
      operationId: expected.operation.operationId,
      catalogReceipt: candidate,
      runtimeServerId,
    }),
    /receipt_identity_mismatch/
  )
})

test('Service uninstall authorizes only exact active service receipt and runtime key', () => {
  const expected = request({ action: 'uninstall' })
  const locator = {
    sourceId: expected.sourceId,
    entryId: expected.entryId,
    operation: expected.operation,
  }
  const receipt = completeServiceCatalogReceipt(
    receiptFor({ ...expected, kind: 'service' }),
    registryCatalogRuntimeServerId(expected.sourceId, expected.entryId)
  )
  const entry = { ...pendingEntry({ status: 'uninstalling' }), catalogReceipt: receipt }
  assert.deepEqual(resolveServiceUninstallOwnership({ locator, snapshot: expected.snapshot, entries: [entry] }), {
    allowed: true,
    deleteAllowed: true,
    sourceId: expected.sourceId,
    entryId: expected.entryId,
    deviceId: expected.operation.deviceId,
    operationId: expected.operation.operationId,
    runtimeServerId: registryCatalogRuntimeServerId(expected.sourceId, expected.entryId),
  })
  assert.deepEqual(buildServiceCatalogDeleteTarget(locator), {
    entryId: expected.entryId,
    sourceId: expected.sourceId,
    deviceId: expected.operation.deviceId,
    operationId: expected.operation.operationId,
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
  assert.equal(resolveServiceUninstallOwnership({
    locator,
    snapshot: expected.snapshot,
    entries: [{ ...entry, operationId: operationB }],
  }).deleteAllowed, false)
})

function serviceRequest(overrides = {}) {
  return { ...request(overrides), kind: 'service' }
}

function registered(expected, runtimeServerId, extra = {}) {
  return {
    success: true,
    data: {
      agentId: 'desirecore',
      serverId: expected.entryId,
      runtimeServerId,
      message: 'added',
      ...extra,
    },
  }
}

test('注册 200 只认服务端签发的复合键，reclaimed 只取 true，收回与重装都不允许回滚', () => {
  const install = serviceRequest()
  const composite = registryCatalogRuntimeServerId(install.sourceId, install.entryId)
  assert.deepEqual(evaluateRegistryCatalogRegisterResult(install, 200, registered(install, composite)), {
    registered: true,
    runtimeServerId: composite,
    reclaimed: false,
    rollbackAllowed: true,
  })
  assert.deepEqual(
    evaluateRegistryCatalogRegisterResult(install, 200, registered(install, composite, { reclaimed: true })),
    { registered: true, runtimeServerId: composite, reclaimed: true, rollbackAllowed: false }
  )
  for (const reclaimed of ['true', 1, false, null]) {
    assert.deepEqual(
      evaluateRegistryCatalogRegisterResult(install, 200, registered(install, composite, { reclaimed })),
      { registered: true, runtimeServerId: composite, reclaimed: false, rollbackAllowed: true }
    )
  }
  const reinstall = serviceRequest({ action: 'reinstall' })
  assert.deepEqual(evaluateRegistryCatalogRegisterResult(reinstall, 200, registered(reinstall, composite)), {
    registered: true,
    runtimeServerId: composite,
    reclaimed: false,
    rollbackAllowed: false,
  })
})

test('注册 200 的 runtimeServerId 不符或响应畸形时不算已注册、也不得回滚', () => {
  const install = serviceRequest()
  const mismatched = {
    registered: false,
    residue: null,
    errorCode: 'registry_catalog_register_runtime_server_id_mismatch',
    mayRollback: false,
  }
  for (const runtimeServerId of [
    install.entryId,
    registryCatalogRuntimeServerId('registry:source-b', install.entryId),
    'well_formed_but_wrong',
  ]) {
    assert.deepEqual(evaluateRegistryCatalogRegisterResult(install, 200, registered(install, runtimeServerId)), mismatched)
  }
  const invalid = {
    registered: false,
    residue: null,
    errorCode: 'registry_catalog_register_response_invalid',
    mayRollback: false,
  }
  for (const body of [
    { success: true, data: { serverId: install.entryId } },
    { success: false, data: { runtimeServerId: registryCatalogRuntimeServerId(install.sourceId, install.entryId) } },
    { success: true },
    'not json',
    null,
  ]) {
    assert.deepEqual(evaluateRegistryCatalogRegisterResult(install, 200, body), invalid)
  }
})

test('registry:official 的裸键与卸载一致可识别为已注册，但它必然是已有配置，不得回滚', () => {
  const official = serviceRequest({ sourceId: 'registry:official' })
  assert.deepEqual(
    evaluateRegistryCatalogRegisterResult(official, 200, registered(official, official.entryId)),
    { registered: true, runtimeServerId: official.entryId, reclaimed: false, rollbackAllowed: false }
  )
  const composite = registryCatalogRuntimeServerId(official.sourceId, official.entryId)
  assert.equal(
    evaluateRegistryCatalogRegisterResult(official, 200, registered(official, composite)).rollbackAllowed,
    true
  )
  const other = serviceRequest()
  assert.equal(
    evaluateRegistryCatalogRegisterResult(other, 200, registered(other, other.entryId)).registered,
    false
  )
})

test('注册 409 只有两个已知 reasons、复合键与首装同时成立才进入残留出口', () => {
  const install = serviceRequest()
  const composite = registryCatalogRuntimeServerId(install.sourceId, install.entryId)
  const conflict = (reasons, runtimeServerId = composite) => ({
    success: false,
    errorCode: 'registry_acquisition_ownership_mismatch',
    reasons,
    runtimeServerId,
  })
  assert.deepEqual(evaluateRegistryCatalogRegisterResult(install, 409, conflict(['unowned_runtime_config_differs'])), {
    registered: false,
    residue: {
      reason: 'unowned_runtime_config_differs',
      runtimeServerId: composite,
      userOptions: ['delete', 'keep'],
    },
    errorCode: 'registry_acquisition_ownership_mismatch',
    mayRollback: false,
  })
  assert.deepEqual(
    evaluateRegistryCatalogRegisterResult(install, 409, conflict(['unowned_runtime_config_disabled_local_keys'])),
    {
      registered: false,
      residue: {
        reason: 'unowned_runtime_config_disabled_local_keys',
        runtimeServerId: composite,
        userOptions: ['delete', 'enable_in_editor', 'keep'],
      },
      errorCode: 'registry_acquisition_ownership_mismatch',
      mayRollback: false,
    }
  )

  // 旧客户端与新客户端上「意图已不在、系统默认键、official 裸键」都是不带 reasons 的 409
  assert.deepEqual(
    evaluateRegistryCatalogRegisterResult(install, 409, { success: false, errorCode: 'registry_acquisition_ownership_mismatch' }),
    { registered: false, residue: null, errorCode: 'registry_acquisition_ownership_mismatch', mayRollback: false }
  )
  // 格式合法但不是已知取值：保留有界 reasons，不进残留出口
  assert.deepEqual(
    evaluateRegistryCatalogRegisterResult(install, 409, conflict(['unowned_runtime_config_unknown'])),
    {
      registered: false,
      residue: null,
      errorCode: 'registry_acquisition_ownership_mismatch',
      reasons: ['unowned_runtime_config_unknown'],
      mayRollback: false,
    }
  )
  for (const body of [
    conflict(['unowned_runtime_config_differs', 'unowned_runtime_config_disabled_local_keys']),
    conflict(['unowned_runtime_config_differs'], install.entryId),
    conflict(['unowned_runtime_config_differs'], registryCatalogRuntimeServerId('registry:source-b', install.entryId)),
    { success: false, errorCode: 'registry_acquisition_ownership_mismatch', reasons: ['unowned_runtime_config_differs'] },
    { ...conflict(['unowned_runtime_config_differs']), errorCode: 'registry_acquisition_blocked' },
  ]) {
    const result = evaluateRegistryCatalogRegisterResult(install, 409, body)
    assert.equal(result.registered, false)
    assert.equal(result.residue, null)
    assert.equal(result.mayRollback, false)
  }
  for (const status of [400, 404, 500]) {
    assert.equal(
      evaluateRegistryCatalogRegisterResult(install, status, conflict(['unowned_runtime_config_differs'])).residue,
      null
    )
  }
  const reinstall = serviceRequest({ action: 'reinstall' })
  assert.equal(
    evaluateRegistryCatalogRegisterResult(reinstall, 409, conflict(['unowned_runtime_config_differs'])).residue,
    null
  )
})

test('注册其它失败只保留有界错误码与 reasons，一律不回滚', () => {
  const install = serviceRequest()
  assert.deepEqual(
    evaluateRegistryCatalogRegisterResult(install, 409, {
      success: false,
      errorCode: 'registry_acquisition_blocked',
      reasons: ['missing-install-or-connection'],
    }),
    {
      registered: false,
      residue: null,
      errorCode: 'registry_acquisition_blocked',
      reasons: ['missing-install-or-connection'],
      mayRollback: false,
    }
  )
  assert.deepEqual(
    evaluateRegistryCatalogRegisterResult(install, 409, {
      success: false,
      errorCode: 'registry_acquisition_ownership_mismatch',
      reasons: ['not a bounded reason!'],
    }),
    { registered: false, residue: null, errorCode: 'registry_acquisition_ownership_mismatch', mayRollback: false }
  )
  // 500 时 agent.json 可能已被写，但不知道是不是本次写的
  assert.deepEqual(
    evaluateRegistryCatalogRegisterResult(install, 500, { success: false, error: 'removeServerConfig failed' }),
    { registered: false, residue: null, mayRollback: false }
  )
  assert.deepEqual(
    evaluateRegistryCatalogRegisterResult(install, 400, { success: false, error: 'Missing required fields: serverId, config' }),
    { registered: false, residue: null, mayRollback: false }
  )
  assert.deepEqual(
    evaluateRegistryCatalogRegisterResult(install, 499, { success: false, errorCode: 'cancelled' }),
    { registered: false, residue: null, errorCode: 'cancelled', mayRollback: false }
  )
  assert.deepEqual(
    evaluateRegistryCatalogRegisterResult(install, 502, '<html>bad gateway</html>'),
    { registered: false, residue: null, mayRollback: false }
  )
  assert.throws(() => evaluateRegistryCatalogRegisterResult(request(), 200, {}), /register_expected_invalid/)
  assert.throws(() => evaluateRegistryCatalogRegisterResult(install, '200', {}), /http_status_invalid/)
})

test('操作归属复核：恰好一条且 operationId 一致才可结算，被接替、缺失、多条都不得结算或回滚', () => {
  const install = serviceRequest()
  const locator = { sourceId: install.sourceId, entryId: install.entryId, operation: install.operation }
  // 不带 runtimeServerId 的复核只用来判断能否结算，回滚需另做带键的复核
  assert.deepEqual(inspectRegistryCatalogOperation({ locator, entries: [pendingEntry()] }), {
    state: 'current',
    status: 'installing',
    maySettle: true,
    mayRollback: false,
  })
  assert.deepEqual(inspectRegistryCatalogOperation({ locator, entries: [pendingEntry({ status: 'failed' })] }), {
    state: 'current',
    status: 'failed',
    maySettle: true,
    mayRollback: false,
  })
  const reinstallLocator = { ...locator, operation: { ...install.operation, action: 'reinstall' } }
  assert.deepEqual(
    inspectRegistryCatalogOperation({ locator: reinstallLocator, entries: [pendingEntry({ status: 'reinstalling' })] }),
    { state: 'current', status: 'reinstalling', maySettle: true, mayRollback: false }
  )
  assert.deepEqual(
    inspectRegistryCatalogOperation({
      locator,
      entries: [pendingEntry({ operationId: operationB }), pendingEntry({ sourceId: 'registry:source-b' })],
    }),
    { state: 'superseded', status: 'installing', maySettle: false, mayRollback: false }
  )
  assert.deepEqual(
    inspectRegistryCatalogOperation({
      locator,
      entries: [pendingEntry({ deviceId: 'device-b' }), pendingEntry({ sourceId: 'registry:source-b' })],
    }),
    { state: 'missing', maySettle: false, mayRollback: false }
  )
  assert.deepEqual(
    inspectRegistryCatalogOperation({ locator, entries: [pendingEntry(), pendingEntry({ operationId: operationB })] }),
    { state: 'ambiguous', maySettle: false, mayRollback: false }
  )
  // operationId 一致但状态不在六枚举里：无法判断可行迁移，不得当成 current 结算
  assert.deepEqual(
    inspectRegistryCatalogOperation({ locator, entries: [pendingEntry({ status: 'pending' })] }),
    { state: 'ambiguous', maySettle: false, mayRollback: false }
  )
  // 记录没有 operationId：不是本次的，按被接替处理
  const { operationId: _omitted, ...withoutOperationId } = pendingEntry()
  assert.deepEqual(
    inspectRegistryCatalogOperation({ locator, entries: [withoutOperationId] }),
    { state: 'superseded', status: 'installing', maySettle: false, mayRollback: false }
  )
  assert.throws(() => inspectRegistryCatalogOperation({ locator, entries: {} }), /inspect_entries_invalid/)
  assert.throws(() => inspectRegistryCatalogOperation({ locator: null, entries: [] }), /inspect_locator_invalid/)
  assert.throws(
    () => inspectRegistryCatalogOperation({ locator, entries: [], stage: 'register' }),
    /inspect_input_invalid/
  )
})

test('回滚前带上 runtimeServerId：别的记录在回执里持有这个键（含 failed）时不得回滚', () => {
  const install = serviceRequest()
  const locator = { sourceId: install.sourceId, entryId: install.entryId, operation: install.operation }
  const composite = registryCatalogRuntimeServerId(install.sourceId, install.entryId)
  const holder = (status, runtimeServerId = composite) => ({
    ...pendingEntry({ deviceId: 'device-b', status, operationId: operationB }),
    catalogReceipt: { kind: 'service', catalogSourceId: install.sourceId, entryId: install.entryId, runtimeServerId },
  })
  const inspect = (entries) => inspectRegistryCatalogOperation({ locator, entries, runtimeServerId: composite })
  assert.deepEqual(inspect([pendingEntry()]), { state: 'current', status: 'installing', maySettle: true, mayRollback: true })
  // 持有记录是 failed：无信封 DELETE 不会 409，回滚会删掉替换前就有的配置
  for (const status of ['failed', 'installed', 'reinstalling']) {
    assert.deepEqual(inspect([pendingEntry(), holder(status)]), {
      state: 'current',
      status: 'installing',
      maySettle: true,
      mayRollback: false,
    })
  }
  // 已卸载的记录、或持有别的键的记录，都不影响回滚
  assert.equal(inspect([pendingEntry(), holder('uninstalled')]).mayRollback, true)
  assert.equal(inspect([pendingEntry(), holder('failed', 'other-key')]).mayRollback, true)
  // 不带 runtimeServerId 时无法判断持有者，一律不放行回滚
  assert.equal(inspectRegistryCatalogOperation({ locator, entries: [pendingEntry(), holder('failed')] }).mayRollback, false)
  assert.equal(inspectRegistryCatalogOperation({ locator, entries: [pendingEntry()] }).mayRollback, false)
  for (const runtimeServerId of ['', 'bad key', 'x'.repeat(101), 42]) {
    assert.throws(
      () => inspectRegistryCatalogOperation({ locator, entries: [pendingEntry()], runtimeServerId }),
      /inspect_runtime_server_id_invalid/
    )
  }
})

test('evaluate-register-response 与 inspect-operation 子命令读 stdin、输出一行 JSON', () => {
  const install = serviceRequest()
  const composite = registryCatalogRuntimeServerId(install.sourceId, install.entryId)
  const run = (command, input) => spawnSync(process.execPath, [scriptPath, command], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  })
  const evaluated = run('evaluate-register-response', {
    expected: install,
    status: 200,
    body: registered(install, composite, { reclaimed: true }),
  })
  assert.equal(evaluated.status, 0, evaluated.stderr)
  assert.deepEqual(JSON.parse(evaluated.stdout), {
    registered: true,
    runtimeServerId: composite,
    reclaimed: true,
    rollbackAllowed: false,
  })
  const inspected = run('inspect-operation', {
    locator: { sourceId: install.sourceId, entryId: install.entryId, operation: install.operation },
    entries: [pendingEntry({ operationId: operationB })],
  })
  assert.equal(inspected.status, 0, inspected.stderr)
  assert.equal(JSON.parse(inspected.stdout).state, 'superseded')
  const extraKey = run('evaluate-register-response', { expected: install, status: 200, body: {}, extra: true })
  assert.equal(extraKey.status, 1)
  assert.match(extraKey.stderr, /register_evaluation_input_invalid/)
})

test('Skill-first 正文短而完整、按需提供既有 HTTP 工具、不加载旧 App 状态机', async () => {
  const text = await readFile(skillPath, 'utf8')
  assert.ok(text.split('\n').length <= 60)
  assert.match(text, /disable-model-invocation: true/)
  assert.match(text, /tools: \[HttpRequest\]/)
  assert.match(text, /不预写 installing\/reinstalling\/uninstalling/)
  assert.match(text, /资料不是权限/)
  assert.match(text, /先观察/)
  assert.doesNotMatch(text, /tools:.*ResolveApplication|tools:.*RecordApplication/)
  for (const name of ['recording-api.md', 'recovery.md', 'legacy-services.md']) {
    assert.ok((await readFile(join(here, '..', 'references', name), 'utf8')).length > 0)
  }
})

test('首装观察示例复用 resolver material，不将 install 改为 manage', async () => {
  const api = await readFile(join(here, '..', 'references', 'recording-api.md'), 'utf8')
  const skill = await readFile(skillPath, 'utf8')
  assert.match(api, /material: resolution\.data\.material/)
  assert.match(api, /expectedRevision: resolution\.data\.expectedRevision/)
  assert.match(api, /首装完成后仍是 install/)
  assert.doesNotMatch(api, /"action":\s*"manage"/)
  assert.match(skill, /首装结束也不能改成 manage/)
  const recovery = await readFile(join(here, '..', 'references', 'recovery.md'), 'utf8')
  assert.match(recovery, /响应未知不能如此处理/)
})

test('卸载不扩大到未知父目录，证据必须实际存在', async () => {
  const skill = await readFile(skillPath, 'utf8')
  const api = await readFile(join(here, '..', 'references', 'recording-api.md'), 'utf8')
  assert.match(skill, /不能因为位于同一前缀就递归清理父目录/)
  assert.match(skill, /非递归删除，非空就保留/)
  assert.match(api, /只检查默认用户数据路径不能证明前缀内没有数据/)
  assert.match(api, /不能自行编造/)
  assert.match(api, /已用 Write\/执行工具保存的核验报告路径/)
})

test('Skill contract has no fixed official/local Registry fallback and resolves before execution', async () => {
  const skill = await readFile(join(here, '..', 'references', 'legacy-services.md'), 'utf8')
  assert.doesNotMatch(skill, /registry\/official\/entries/)
  assert.match(skill, /POST \/api\/registry\/acquisitions\/resolve/)
  assert.match(skill, /禁止 fallback/)
  assert.match(skill, /plan-settlement/)
  assert.match(skill, /lifecycle receipt/)
  assert.match(skill, /registry_acquisition_receipt_missing/)
  assert.match(skill, /build-service-delete/)
  assert.match(skill, /operationId=<operationId>/)
  assert.ok(skill.indexOf('解析机器消息并调用 resolver') < skill.indexOf('环境校验'))
  assert.ok(skill.indexOf('### 执行前协议') < skill.indexOf('`docker version`'))
})

test('MCP 首装先做连接测试再注册，回滚与残留出口只用服务端签发的 runtimeServerId', async () => {
  const doc = await readFile(legacyServicesPath, 'utf8')
  const description = doc.split('\n').find((line) => line.startsWith('description:'))
  assert.ok(description.includes('连接测试'))
  assert.ok(description.indexOf('连接测试') < description.indexOf('注册到 Agent'))
  const installFlow = doc.slice(doc.indexOf('### mcp / http-api 服务安装流程'), doc.indexOf('### mcp / http-api 服务卸载流程'))
  // 只有新流程才有的文字：注册以连接测试结论为前提，连接失败在注册之前就结束；旧文档里这些都不存在
  const registerStep = installFlow.indexOf('**注册到 Agent**')
  assert.ok(registerStep > 0)
  assert.match(installFlow.slice(registerStep, registerStep + 80), /只在第 3 步结论为已连通或需授权时/)
  const notRegistered = installFlow.indexOf('其它失败：**不注册**')
  assert.ok(notRegistered > 0 && notRegistered < registerStep)
  assert.doesNotMatch(doc, /连接校验（先校验后回写，强制）/)
  assert.match(installFlow, /status === 'needs_auth'/)
  assert.match(installFlow, /POST \/api\/mcp\/test-connection/)
  // 旧客户端连接测试失败不带 errorCode 与 status，也允许复测一次
  assert.match(installFlow, /两者都没有时同样复测一次/)
  // 回滚前的复核带上 runtimeServerId，回执持有的替换不回滚；回滚 DELETE 不受 operation 约束，复核后立刻执行
  assert.match(doc, /"runtimeServerId": <注册判定输出的 runtimeServerId>/)
  assert.match(doc, /这种情况不回滚/)
  assert.doesNotMatch(doc, /已知边界/)
  assert.match(doc, /复核后立刻回滚，中间不等待、不询问/)
  assert.doesNotMatch(doc, /最终以服务端的 409 为准/)
  // 误传裸 entryId 给无信封 DELETE 会真的删掉同名配置
  assert.doesNotMatch(doc, /实际什么也没删/)
  assert.match(doc, /evaluate-register-response/)
  assert.match(doc, /inspect-operation/)
  assert.match(doc, /unowned_runtime_config_differs/)
  assert.match(doc, /unowned_runtime_config_disabled_local_keys/)
  assert.match(doc, /`reclaimed: true`[^\n]*不回滚/)
  assert.match(doc, /无信封 `DELETE[^\n]*runtimeServerId[^\n]*不按 entryId/)
  assert.match(doc, /superseded[^\n]*不结算[^\n]*不回滚/)
  assert.match(doc, /catalog_operation_mismatch/)
  // 旧写法「注册后先回滚再结算」不看 reclaimed、也不看操作是否已被接替，不得残留
  assert.doesNotMatch(doc, /回滚刚注册的/)
  assert.doesNotMatch(doc, /MCP 回滚注册后结算/)
  assert.doesNotMatch(doc, /连接校验失败 → 首装 `failed`/)
  // needs_auth 照常注册，不按失败处理
  assert.match(installFlow, /`connectionTest\.status === 'needs_auth'`：\*\*需授权\*\*[\s\S]{0,120}照常进入第 4 步注册/)
  // 残留出口：先结算首装 failed，再询问，用户选择后才删除；删除前重新复核，被接替就不删
  const residueExit = doc.slice(doc.indexOf('**残留出口**'), doc.indexOf('### mcp / http-api 服务卸载流程'))
  const settled = residueExit.indexOf('status:failed}` 结算本次首装')
  const asked = residueExit.indexOf('询问用户选哪条')
  const deleted = residueExit.indexOf('**删除**')
  assert.ok(settled > 0 && settled < asked && asked < deleted)
  assert.match(residueExit.slice(deleted), /^[^]*?只有 `current` 且 status 为 `failed` 才继续[^]*?无信封 `DELETE/)
  assert.match(doc, /先说明并询问，用户\n选择之前只结算，不删除、不启用/)
  // 回滚 DELETE 返回 409 时记录仍是 installing，必须照常结算，不得停在中间态
  assert.match(doc, /\*\*回滚的无信封 DELETE 返回 409\*\*[^\n]*照常用同一 operationId PATCH `failed` 结算/)
  // 被接替、要求重试时都不得自己写意图
  assert.match(doc, /不调用任何 PUT（带不带 `retryOf` 都不行）/)
  // 带 receipt 的 PATCH 显式传 timeout；没有响应时先复核再原样重发，拿到拒绝码前不回滚
  assert.match(doc, /method: PATCH\n  timeout: 120000/)
  assert.match(doc, /用完全相同的请求体[^]*?拿到明确的拒绝码之前不回滚/)
  assert.match(doc, /^version: "1\.5\.0"$/m)
})
