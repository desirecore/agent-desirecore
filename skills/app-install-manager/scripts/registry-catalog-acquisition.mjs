#!/usr/bin/env node

import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const MACHINE_LINE_PREFIX = 'RegistryCatalogAcquisition='
const IMMUTABLE_COMMIT = /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/
const SHA256 = /^[a-fA-F0-9]{64}$/
const SAFE_SOURCE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/
const SAFE_ENTRY_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,239}$/
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const RESOLVER_ERROR_CODES = new Set([
  'registry_acquisition_invalid_request',
  'registry_acquisition_not_found',
  'registry_acquisition_snapshot_stale',
  'registry_acquisition_blocked',
  'registry_acquisition_client_upgrade_required',
  'registry_acquisition_config_mismatch',
  'registry_acquisition_install_guide_unavailable',
  'registry_acquisition_receipt_missing',
  'registry_acquisition_ownership_mismatch',
])
const INTERMEDIATE_STATUSES = new Set(['installing', 'reinstalling', 'uninstalling'])
const PRE_EXECUTION_STOP_STAGES = new Set(['parse', 'resolver', 'human_gate', 'pre_execution'])

function fail(code) {
  throw new Error(code)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value, required, optional = []) {
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
}

function requireBoundedString(value, field, maxLength = 1024) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || /[\r\n\0]/.test(value)) {
    fail(`registry_catalog_${field}_invalid`)
  }
  return value
}

function requireBoundedText(value, field, maxLength) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || value.includes('\0')) {
    fail(`registry_catalog_${field}_invalid`)
  }
  return value
}

function validateSnapshot(value) {
  if (!isRecord(value) || !hasOnlyKeys(
    value,
    ['schemaVersion', 'catalogSourceId', 'catalogCommit', 'catalogPath', 'releaseVersion'],
    ['contentRef', 'contentSha256']
  )) {
    fail('registry_catalog_snapshot_invalid')
  }
  if (value.schemaVersion !== 1) fail('registry_catalog_snapshot_version_unsupported')
  const catalogSourceId = requireBoundedString(value.catalogSourceId, 'catalog_source_id', 240)
  if (!SAFE_SOURCE_ID.test(catalogSourceId)) fail('registry_catalog_catalog_source_id_invalid')
  const catalogCommit = requireBoundedString(value.catalogCommit, 'catalog_commit', 64)
  if (!IMMUTABLE_COMMIT.test(catalogCommit)) fail('registry_catalog_catalog_commit_invalid')
  const catalogPath = requireBoundedString(value.catalogPath, 'catalog_path', 512)
  if (catalogPath.startsWith('/') || /^[A-Za-z]:/.test(catalogPath) || catalogPath.split(/[\\/]+/).includes('..')) {
    fail('registry_catalog_catalog_path_invalid')
  }
  const releaseVersion = requireBoundedString(value.releaseVersion, 'release_version', 160)
  if (value.contentRef !== undefined) requireBoundedString(value.contentRef, 'content_ref', 500)
  if (value.contentSha256 !== undefined && !SHA256.test(value.contentSha256)) {
    fail('registry_catalog_content_sha256_invalid')
  }
  return {
    schemaVersion: 1,
    catalogSourceId,
    catalogCommit,
    catalogPath,
    releaseVersion,
    ...(value.contentRef !== undefined ? { contentRef: value.contentRef } : {}),
    ...(value.contentSha256 !== undefined ? { contentSha256: value.contentSha256.toLowerCase() } : {}),
  }
}

export function validateRegistryCatalogAcquisitionRequest(value) {
  if (!isRecord(value)) {
    fail('registry_catalog_request_invalid')
  }
  if (value.kind !== 'app' && value.kind !== 'service') fail('registry_catalog_kind_invalid')
  if (
    (value.kind === 'app' && !hasOnlyKeys(
      value,
      ['kind', 'sourceId', 'entryId', 'snapshot', 'operation'],
      ['install', 'connection']
    )) ||
    (value.kind === 'service' && !hasOnlyKeys(
      value,
      ['kind', 'sourceId', 'entryId', 'snapshot', 'operation'],
      ['install', 'connection']
    ))
  ) {
    fail('registry_catalog_request_invalid')
  }
  const sourceId = requireBoundedString(value.sourceId, 'source_id', 160)
  const entryId = requireBoundedString(value.entryId, 'entry_id', 240)
  if (!SAFE_SOURCE_ID.test(sourceId)) fail('registry_catalog_source_id_invalid')
  if (!SAFE_ENTRY_ID.test(entryId)) fail('registry_catalog_entry_id_invalid')
  if (value.kind === 'app' && (value.install !== undefined || value.connection !== undefined)) {
    fail('registry_catalog_app_client_config_forbidden')
  }
  const snapshot = validateSnapshot(value.snapshot)
  if (snapshot.catalogSourceId !== sourceId) fail('registry_catalog_source_identity_mismatch')
  return {
    kind: value.kind,
    sourceId,
    entryId,
    snapshot,
    operation: validateOperation(value.operation),
    ...(value.kind === 'service' && value.install !== undefined ? { install: value.install } : {}),
    ...(value.kind === 'service' && value.connection !== undefined ? { connection: value.connection } : {}),
  }
}

function validateOperation(value) {
  if (!isRecord(value) || !hasOnlyKeys(value, ['action', 'deviceId', 'operationId'])) {
    fail('registry_catalog_operation_invalid')
  }
  if (!['install', 'reinstall', 'uninstall'].includes(value.action)) {
    fail('registry_catalog_operation_action_invalid')
  }
  const operationId = requireBoundedString(value.operationId, 'operation_id', 36)
  if (!OPERATION_ID.test(operationId)) fail('registry_catalog_operation_id_invalid')
  return {
    action: value.action,
    deviceId: requireBoundedString(value.deviceId, 'operation_device_id', 200),
    operationId,
  }
}

export function validateRegistryCatalogAcquisitionEnvelope(value) {
  const request = validateRegistryCatalogAcquisitionRequest(value)
  return {
    request,
    locator: {
      sourceId: request.sourceId,
      entryId: request.entryId,
      operation: request.operation,
    },
  }
}

function parseMachineLineJson(message) {
  if (typeof message !== 'string') fail('registry_catalog_message_invalid')
  const matches = message
    .split(/\r?\n/)
    .filter((line) => line.startsWith(MACHINE_LINE_PREFIX))
  if (matches.length === 0) fail('registry_catalog_machine_line_missing')
  if (matches.length !== 1) fail('registry_catalog_machine_line_ambiguous')
  const encoded = matches[0].slice(MACHINE_LINE_PREFIX.length)
  if (!encoded || encoded !== encoded.trim()) fail('registry_catalog_machine_line_malformed')
  try {
    return JSON.parse(encoded)
  } catch {
    fail('registry_catalog_machine_line_malformed')
  }
}

/** Parse only the App ledger locator; this grants no catalog acquisition or command execution. */
export function parseRegistryCatalogAcquisitionLocatorMessage(message) {
  const value = parseMachineLineJson(message)
  if (!isRecord(value) || (value.kind !== 'app' && value.kind !== 'service')) {
    fail('registry_catalog_locator_invalid')
  }
  if (
    (value.kind === 'app' && !hasOnlyKeys(
      value,
      ['kind', 'sourceId', 'entryId', 'snapshot', 'operation'],
      ['install', 'connection']
    )) ||
    (value.kind === 'service' && !hasOnlyKeys(
      value,
      ['kind', 'sourceId', 'entryId', 'snapshot', 'operation'],
      ['install', 'connection']
    )) ||
    !isRecord(value.snapshot)
  ) {
    fail('registry_catalog_locator_invalid')
  }
  const sourceId = requireBoundedString(value.sourceId, 'source_id', 160)
  const entryId = requireBoundedString(value.entryId, 'entry_id', 240)
  if (
    !SAFE_SOURCE_ID.test(sourceId) ||
    !SAFE_ENTRY_ID.test(entryId) ||
    value.snapshot.catalogSourceId !== sourceId
  ) {
    fail('registry_catalog_locator_invalid')
  }
  return { sourceId, entryId, operation: validateOperation(value.operation) }
}

/**
 * Extract exactly one standalone machine line. Human prose is never inspected for identity,
 * snapshot, install, or connection fields.
 */
export function parseRegistryCatalogAcquisitionMessage(message) {
  return validateRegistryCatalogAcquisitionEnvelope(parseMachineLineJson(message))
}

function snapshotsEqual(left, right) {
  return left.schemaVersion === right.schemaVersion &&
    left.catalogSourceId === right.catalogSourceId &&
    left.catalogCommit === right.catalogCommit &&
    left.catalogPath === right.catalogPath &&
    left.releaseVersion === right.releaseVersion &&
    left.contentRef === right.contentRef &&
    left.contentSha256 === right.contentSha256
}

export function registryCatalogRuntimeServerId(sourceId, entryId) {
  const digest = createHash('sha256').update(`${sourceId}\0${entryId}`).digest('hex').slice(0, 20)
  const slug = entryId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 48) || 'entry'
  return `registry_${digest}_${slug}`
}

function boundedReasons(value) {
  if (!Array.isArray(value) || value.length > 32) return undefined
  const reasons = value.filter(
    (reason) => typeof reason === 'string' && reason.length > 0 && reason.length <= 160 && /^[a-z0-9._:-]+$/i.test(reason)
  )
  return reasons.length === value.length && reasons.length > 0 ? reasons : undefined
}

function normalizePendingEntry(value) {
  if (!isRecord(value)) return undefined
  if (
    typeof value.sourceId !== 'string' || !SAFE_SOURCE_ID.test(value.sourceId) ||
    typeof value.entryId !== 'string' || !SAFE_ENTRY_ID.test(value.entryId) ||
    typeof value.deviceId !== 'string' || value.deviceId.length === 0 || value.deviceId.length > 240 || /[\r\n\0]/.test(value.deviceId) ||
    typeof value.deviceName !== 'string' || value.deviceName.length === 0 || value.deviceName.length > 240 || /[\r\n\0]/.test(value.deviceName) ||
    typeof value.status !== 'string' || !INTERMEDIATE_STATUSES.has(value.status) ||
    typeof value.operationId !== 'string' || !OPERATION_ID.test(value.operationId)
  ) {
    return undefined
  }
  return {
    sourceId: value.sourceId,
    entryId: value.entryId,
    deviceId: value.deviceId,
    deviceName: value.deviceName,
    status: value.status,
    operationId: value.operationId,
  }
}

/**
 * Select the one authoritative optimistic intent that must be settled before execution stops.
 * sourceId+entryId+operation.deviceId are mandatory filters. Missing or malformed machine input
 * has no authoritative locator and therefore never enters this function or mutates the ledger.
 */
export function planRegistryCatalogPreExecutionSettlement(input) {
  if (!isRecord(input) || !hasOnlyKeys(input, ['stage', 'locator', 'entries'])) {
    fail('registry_catalog_settlement_input_invalid')
  }
  if (!PRE_EXECUTION_STOP_STAGES.has(input.stage)) fail('registry_catalog_settlement_stage_invalid')
  if (!Array.isArray(input.entries)) fail('registry_catalog_settlement_entries_invalid')
  if (!isRecord(input.locator) || !hasOnlyKeys(input.locator, ['sourceId', 'entryId', 'operation'])) {
    fail('registry_catalog_settlement_locator_invalid')
  }
  const sourceId = requireBoundedString(input.locator.sourceId, 'settlement_source_id', 160)
  const entryId = requireBoundedString(input.locator.entryId, 'settlement_entry_id', 240)
  if (!SAFE_SOURCE_ID.test(sourceId) || !SAFE_ENTRY_ID.test(entryId)) fail('registry_catalog_settlement_locator_invalid')
  const operation = validateOperation(input.locator.operation)
  const expectedStatus = operation.action === 'install'
    ? 'installing'
    : operation.action === 'reinstall'
      ? 'reinstalling'
      : 'uninstalling'
  const candidates = input.entries
    .map(normalizePendingEntry)
    .filter((entry) => entry !== undefined)
    .filter((entry) => entry.status === expectedStatus && entry.deviceId === operation.deviceId)
    .filter((entry) => entry.operationId === operation.operationId)
    .filter((entry) => entry.sourceId === sourceId && entry.entryId === entryId)

  if (candidates.length !== 1) {
    return {
      allowed: false,
      mayExecuteCommands: false,
      settlement: null,
      reason: candidates.length === 0
        ? 'registry_catalog_pending_intent_not_found'
        : 'registry_catalog_pending_intent_ambiguous',
    }
  }

  const target = candidates[0]
  return {
    allowed: false,
    mayExecuteCommands: false,
    settlement: {
      sourceId: target.sourceId,
      entryId: target.entryId,
      deviceId: target.deviceId,
      operationId: target.operationId,
      // A first install has no usable prior resource, while reinstall/uninstall must restore it.
      status: target.status === 'installing' ? 'failed' : 'installed',
    },
    reason: `registry_catalog_${input.stage}_stopped`,
  }
}

function validateLifecycleManifest(value, kind, entryId, releaseVersion) {
  if (!isRecord(value) || !hasOnlyKeys(value, ['id', 'name', 'type', 'version', 'description'])) {
    fail('registry_catalog_receipt_lifecycle_manifest_invalid')
  }
  const id = requireBoundedString(value.id, 'receipt_lifecycle_id', 240)
  const name = requireBoundedString(value.name, 'receipt_lifecycle_name', 160)
  const version = requireBoundedString(value.version, 'receipt_lifecycle_version', 160)
  if (typeof value.description !== 'string' || value.description.length > 4096 || value.description.includes('\0')) {
    fail('registry_catalog_receipt_lifecycle_description_invalid')
  }
  const typeMatches = kind === 'app' ? ['docker-app', 'native-app'].includes(value.type) : value.type === 'mcp'
  if (id !== entryId || version !== releaseVersion || !typeMatches) {
    fail('registry_catalog_receipt_lifecycle_identity_mismatch')
  }
  return { id, name, type: value.type, version, description: value.description }
}

/** Validate, but never synthesize, the server-issued immutable lifecycle receipt candidate. */
export function validateServerCatalogReceipt(value, expected) {
  if (!isRecord(value) || !hasOnlyKeys(
    value,
    ['schemaVersion', 'kind', 'catalogSourceId', 'entryId', 'catalogCommit', 'catalogPath', 'releaseVersion', 'lifecycle'],
    ['contentRef', 'contentSha256', 'runtimeServerId']
  )) {
    fail('registry_catalog_receipt_invalid')
  }
  if (value.kind !== 'app' && value.kind !== 'service') fail('registry_catalog_receipt_kind_invalid')
  const {
    kind,
    entryId: rawEntryId,
    lifecycle: rawLifecycle,
    runtimeServerId: rawRuntimeServerId,
    ...snapshotValue
  } = value
  const snapshot = validateSnapshot(snapshotValue)
  const entryId = requireBoundedString(rawEntryId, 'receipt_entry_id', 240)
  if (!SAFE_ENTRY_ID.test(entryId)) fail('registry_catalog_receipt_entry_id_invalid')
  if (!isRecord(rawLifecycle) || !hasOnlyKeys(rawLifecycle, ['manifest'], ['installGuide'])) {
    fail('registry_catalog_receipt_lifecycle_invalid')
  }
  const manifest = validateLifecycleManifest(rawLifecycle.manifest, kind, entryId, snapshot.releaseVersion)
  let installGuide
  if (kind === 'app') {
    installGuide = requireBoundedText(rawLifecycle.installGuide, 'receipt_install_guide', 64 * 1024)
  } else if (rawLifecycle.installGuide !== undefined) {
    fail('registry_catalog_receipt_install_guide_forbidden')
  }
  let runtimeServerId
  if (rawRuntimeServerId !== undefined) {
    runtimeServerId = requireBoundedString(rawRuntimeServerId, 'receipt_runtime_server_id', 100)
    if (!/^[a-zA-Z0-9._-]+$/.test(runtimeServerId)) {
      fail('registry_catalog_receipt_runtime_server_id_invalid')
    }
    if (kind !== 'service') fail('registry_catalog_receipt_runtime_server_id_forbidden')
  }
  if (expected) {
    if (
      kind !== expected.kind ||
      entryId !== expected.entryId ||
      snapshot.catalogSourceId !== expected.sourceId ||
      !snapshotsEqual(snapshot, expected.snapshot)
    ) {
      fail('registry_catalog_receipt_identity_mismatch')
    }
  }
  return {
    ...snapshot,
    kind,
    entryId,
    lifecycle: {
      manifest,
      ...(installGuide !== undefined ? { installGuide } : {}),
    },
    ...(runtimeServerId !== undefined ? { runtimeServerId } : {}),
  }
}

/** Add only the server-signed MCP runtime key; snapshot and lifecycle remain byte-for-byte data. */
export function completeServiceCatalogReceipt(candidateValue, runtimeServerIdValue) {
  const candidate = validateServerCatalogReceipt(candidateValue)
  if (candidate.kind !== 'service' || candidate.runtimeServerId !== undefined) {
    fail('registry_catalog_receipt_completion_invalid')
  }
  const runtimeServerId = requireBoundedString(runtimeServerIdValue, 'receipt_runtime_server_id', 100)
  if (!/^[a-zA-Z0-9._-]+$/.test(runtimeServerId)) {
    fail('registry_catalog_receipt_runtime_server_id_invalid')
  }
  const expectedComposite = registryCatalogRuntimeServerId(candidate.catalogSourceId, candidate.entryId)
  if (runtimeServerId !== expectedComposite) fail('registry_catalog_receipt_runtime_server_id_mismatch')
  return { ...candidate, runtimeServerId }
}

/** Build the exact PATCH body accepted by the server-side receipt CAS. */
export function buildInstalledCatalogReceiptPatch(input) {
  if (!isRecord(input) || !hasOnlyKeys(
    input,
    ['sourceId', 'entryId', 'operationId', 'catalogReceipt'],
    ['runtimeServerId']
  )) {
    fail('registry_catalog_receipt_patch_input_invalid')
  }
  const sourceId = requireBoundedString(input.sourceId, 'receipt_patch_source_id', 160)
  const entryId = requireBoundedString(input.entryId, 'receipt_patch_entry_id', 240)
  const operationId = requireBoundedString(input.operationId, 'receipt_patch_operation_id', 36)
  if (!OPERATION_ID.test(operationId)) fail('registry_catalog_receipt_patch_operation_id_invalid')
  const candidate = validateServerCatalogReceipt(input.catalogReceipt)
  if (candidate.catalogSourceId !== sourceId || candidate.entryId !== entryId) {
    fail('registry_catalog_receipt_identity_mismatch')
  }
  const catalogReceipt = candidate.kind === 'service'
    ? completeServiceCatalogReceipt(candidate, input.runtimeServerId)
    : (() => {
        if (input.runtimeServerId !== undefined) fail('registry_catalog_receipt_runtime_server_id_forbidden')
        return candidate
      })()
  return {
    sourceId,
    operationId,
    status: 'installed',
    version: catalogReceipt.releaseVersion,
    catalogReceipt,
  }
}

/** Validate exact MCP uninstall ownership without consulting the current catalog. */
export function resolveServiceUninstallOwnership(input) {
  if (!isRecord(input) || !hasOnlyKeys(input, ['locator', 'snapshot', 'entries'])) {
    fail('registry_catalog_service_uninstall_input_invalid')
  }
  if (!isRecord(input.locator) || !hasOnlyKeys(input.locator, ['sourceId', 'entryId', 'operation'])) {
    fail('registry_catalog_service_uninstall_locator_invalid')
  }
  const sourceId = requireBoundedString(input.locator.sourceId, 'service_uninstall_source_id', 160)
  const entryId = requireBoundedString(input.locator.entryId, 'service_uninstall_entry_id', 240)
  if (!SAFE_SOURCE_ID.test(sourceId) || !SAFE_ENTRY_ID.test(entryId)) {
    fail('registry_catalog_service_uninstall_locator_invalid')
  }
  const operation = validateOperation(input.locator.operation)
  if (operation.action !== 'uninstall') fail('registry_catalog_service_uninstall_operation_invalid')
  const snapshot = validateSnapshot(input.snapshot)
  if (!Array.isArray(input.entries)) fail('registry_catalog_service_uninstall_entries_invalid')
  const matches = input.entries.filter((entry) =>
    isRecord(entry) &&
    entry.sourceId === sourceId &&
    entry.entryId === entryId &&
    entry.deviceId === operation.deviceId &&
    entry.operationId === operation.operationId &&
    entry.status === 'uninstalling'
  )
  if (matches.length !== 1) {
    return {
      allowed: false,
      deleteAllowed: false,
      reason: matches.length === 0
        ? 'registry_catalog_pending_intent_not_found'
        : 'registry_catalog_pending_intent_ambiguous',
    }
  }
  const receiptValue = matches[0].catalogReceipt
  if (!isRecord(receiptValue)) {
    return { allowed: false, deleteAllowed: false, reason: 'registry_acquisition_receipt_missing' }
  }
  let receipt
  try {
    receipt = validateServerCatalogReceipt(receiptValue, { kind: 'service', sourceId, entryId, snapshot })
  } catch {
    return { allowed: false, deleteAllowed: false, reason: 'registry_acquisition_ownership_mismatch' }
  }
  const runtimeServerId = receipt.runtimeServerId ?? ''
  if (!runtimeServerId) {
    return { allowed: false, deleteAllowed: false, reason: 'registry_acquisition_receipt_missing' }
  }
  const expectedComposite = registryCatalogRuntimeServerId(sourceId, entryId)
  if (
    runtimeServerId !== expectedComposite &&
    !(sourceId === 'registry:official' && runtimeServerId === entryId)
  ) {
    return { allowed: false, deleteAllowed: false, reason: 'registry_acquisition_ownership_mismatch' }
  }
  return {
    allowed: true,
    deleteAllowed: true,
    sourceId,
    entryId,
    deviceId: operation.deviceId,
    operationId: operation.operationId,
    runtimeServerId,
  }
}

/** Build the exact operation-bound query tuple for catalog MCP DELETE. */
export function buildServiceCatalogDeleteTarget(locator) {
  if (!isRecord(locator) || !hasOnlyKeys(locator, ['sourceId', 'entryId', 'operation'])) {
    fail('registry_catalog_service_delete_locator_invalid')
  }
  const sourceId = requireBoundedString(locator.sourceId, 'service_delete_source_id', 160)
  const entryId = requireBoundedString(locator.entryId, 'service_delete_entry_id', 240)
  if (!SAFE_SOURCE_ID.test(sourceId) || !SAFE_ENTRY_ID.test(entryId)) {
    fail('registry_catalog_service_delete_locator_invalid')
  }
  const operation = validateOperation(locator.operation)
  if (operation.action !== 'uninstall') fail('registry_catalog_service_delete_operation_invalid')
  return {
    entryId,
    sourceId,
    deviceId: operation.deviceId,
    operationId: operation.operationId,
  }
}

function validateSuccessData(expected, body) {
  if (!isRecord(body) || body.success !== true || !isRecord(body.data)) {
    fail('registry_catalog_resolver_response_invalid')
  }
  const data = body.data
  if (!hasOnlyKeys(
    data,
    ['kind', 'sourceId', 'entryId', 'snapshot', 'manifest', 'catalogReceipt'],
    ['install', 'connection', 'installGuide']
  )) {
    fail('registry_catalog_resolver_response_invalid')
  }
  if (data.kind !== 'app' && data.kind !== 'service') fail('registry_catalog_resolver_response_invalid')
  const responseIdentity = {
    kind: data.kind,
    sourceId: requireBoundedString(data.sourceId, 'resolver_source_id', 160),
    entryId: requireBoundedString(data.entryId, 'resolver_entry_id', 240),
    snapshot: validateSnapshot(data.snapshot),
  }
  if (
    responseIdentity.kind !== expected.kind ||
    responseIdentity.sourceId !== expected.sourceId ||
    responseIdentity.entryId !== expected.entryId ||
    !snapshotsEqual(responseIdentity.snapshot, expected.snapshot)
  ) {
    fail('registry_catalog_resolver_identity_mismatch')
  }
  if (!isRecord(data.manifest) || data.manifest.id !== expected.entryId) {
    fail('registry_catalog_resolver_manifest_identity_mismatch')
  }
  const catalogReceipt = validateServerCatalogReceipt(data.catalogReceipt, {
    kind: expected.kind,
    sourceId: expected.sourceId,
    entryId: expected.entryId,
    snapshot: expected.snapshot,
  })
  if (catalogReceipt.runtimeServerId !== undefined) {
    fail('registry_catalog_resolver_receipt_runtime_forbidden')
  }
  const lifecycleManifest = catalogReceipt.lifecycle.manifest
  if (
    data.manifest.type !== lifecycleManifest.type ||
    data.manifest.name !== lifecycleManifest.name ||
    data.manifest.version !== lifecycleManifest.version ||
    data.manifest.description !== lifecycleManifest.description
  ) {
    fail('registry_catalog_resolver_receipt_manifest_mismatch')
  }
  if (expected.kind === 'app') {
    if (!['docker-app', 'native-app'].includes(data.manifest.type)) fail('registry_catalog_resolver_manifest_kind_mismatch')
    const installGuide = requireBoundedText(data.installGuide, 'install_guide', 64 * 1024)
    if (catalogReceipt.lifecycle.installGuide !== installGuide) {
      fail('registry_catalog_resolver_receipt_install_guide_mismatch')
    }
    // App execution consumes only the server-authorized manifest and install guide.
    return {
      allowed: true,
      kind: expected.kind,
      sourceId: expected.sourceId,
      entryId: expected.entryId,
      snapshot: expected.snapshot,
      manifest: data.manifest,
      installGuide,
      catalogReceipt,
    }
  }
  if (data.manifest.type !== 'mcp') {
    fail('registry_catalog_resolver_manifest_kind_mismatch')
  }
  if (data.installGuide !== undefined) fail('registry_catalog_resolver_install_guide_forbidden')
  if (!isRecord(data.install) || !isRecord(data.connection)) {
    fail('registry_catalog_resolver_response_invalid')
  }
  return {
    allowed: true,
    kind: expected.kind,
    sourceId: expected.sourceId,
    entryId: expected.entryId,
    snapshot: expected.snapshot,
    manifest: data.manifest,
    install: data.install,
    connection: data.connection,
    catalogReceipt,
  }
}

/**
 * Convert the resolver HTTP result into a binary execution decision. Every non-200 result is
 * blocked; the caller must not read local registry data or execute docker/bash as a fallback.
 */
export function evaluateRegistryCatalogResolverResult(expectedValue, status, body) {
  const expected = validateRegistryCatalogAcquisitionRequest(expectedValue)
  if (!Number.isInteger(status)) fail('registry_catalog_http_status_invalid')
  if (status === 200) return validateSuccessData(expected, body)

  const errorCode = isRecord(body) && typeof body.errorCode === 'string'
    ? body.errorCode
    : 'unexpected_resolver_error'
  const reasons = isRecord(body) ? boundedReasons(body.reasons) : undefined
  if (
    ![400, 404, 409].includes(status) ||
    (status === 400 && errorCode !== 'registry_acquisition_invalid_request') ||
    (status === 404 && errorCode !== 'registry_acquisition_not_found') ||
    (status === 409 && ![
      'registry_acquisition_snapshot_stale',
      'registry_acquisition_blocked',
      'registry_acquisition_client_upgrade_required',
      'registry_acquisition_config_mismatch',
      'registry_acquisition_install_guide_unavailable',
      'registry_acquisition_receipt_missing',
      'registry_acquisition_ownership_mismatch',
    ].includes(errorCode))
  ) {
    return { allowed: false, errorCode: 'unexpected_resolver_error', status, mayExecuteCommands: false }
  }
  return {
    allowed: false,
    errorCode: RESOLVER_ERROR_CODES.has(errorCode) ? errorCode : 'unexpected_resolver_error',
    status,
    mayExecuteCommands: false,
    ...(reasons ? { reasons } : {}),
  }
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  const command = process.argv[2]
  if (command === 'parse-message') {
    process.stdout.write(`${JSON.stringify(parseRegistryCatalogAcquisitionMessage(await readStdin()))}\n`)
    return
  }
  if (command === 'parse-locator') {
    process.stdout.write(`${JSON.stringify(parseRegistryCatalogAcquisitionLocatorMessage(await readStdin()))}\n`)
    return
  }
  if (command === 'evaluate-response') {
    const input = JSON.parse(await readStdin())
    if (!isRecord(input) || !hasOnlyKeys(input, ['expected', 'status', 'body'])) {
      fail('registry_catalog_evaluation_input_invalid')
    }
    process.stdout.write(`${JSON.stringify(evaluateRegistryCatalogResolverResult(input.expected, input.status, input.body))}\n`)
    return
  }
  if (command === 'plan-settlement') {
    const input = JSON.parse(await readStdin())
    process.stdout.write(`${JSON.stringify(planRegistryCatalogPreExecutionSettlement(input))}\n`)
    return
  }
  if (command === 'validate-receipt-candidate') {
    const input = JSON.parse(await readStdin())
    process.stdout.write(`${JSON.stringify(validateServerCatalogReceipt(input))}\n`)
    return
  }
  if (command === 'build-receipt-patch') {
    const input = JSON.parse(await readStdin())
    process.stdout.write(`${JSON.stringify(buildInstalledCatalogReceiptPatch(input))}\n`)
    return
  }
  if (command === 'resolve-service-uninstall') {
    const input = JSON.parse(await readStdin())
    process.stdout.write(`${JSON.stringify(resolveServiceUninstallOwnership(input))}\n`)
    return
  }
  if (command === 'build-service-delete') {
    const input = JSON.parse(await readStdin())
    process.stdout.write(`${JSON.stringify(buildServiceCatalogDeleteTarget(input))}\n`)
    return
  }
  fail('usage: registry-catalog-acquisition.mjs parse-locator|parse-message|evaluate-response|plan-settlement|validate-receipt-candidate|build-receipt-patch|resolve-service-uninstall|build-service-delete')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'registry_catalog_unknown_error'}\n`)
    process.exitCode = 1
  })
}
