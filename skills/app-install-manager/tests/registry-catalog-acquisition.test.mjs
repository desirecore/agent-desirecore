import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  buildInstalledCatalogReceiptPatch,
  buildServiceCatalogDeleteTarget,
  completeServiceCatalogReceipt,
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
