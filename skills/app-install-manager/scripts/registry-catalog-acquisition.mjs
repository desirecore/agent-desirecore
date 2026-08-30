#!/usr/bin/env node

import { pathToFileURL } from 'node:url'

const MACHINE_LINE_PREFIX = 'RegistryCatalogAcquisition='
const IMMUTABLE_COMMIT = /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/
const SHA256 = /^[a-fA-F0-9]{64}$/
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,239}$/
const BLOCKED_ERROR_CODES = new Set([
  'invalid',
  'not_found',
  'stale',
  'blocked',
  'client_upgrade_required',
  'config_mismatch',
  'install_guide_unavailable',
])

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
  if (!SAFE_ID.test(catalogSourceId)) fail('registry_catalog_catalog_source_id_invalid')
  const catalogCommit = requireBoundedString(value.catalogCommit, 'catalog_commit', 64)
  if (!IMMUTABLE_COMMIT.test(catalogCommit)) fail('registry_catalog_catalog_commit_invalid')
  const catalogPath = requireBoundedString(value.catalogPath, 'catalog_path', 1024)
  const releaseVersion = requireBoundedString(value.releaseVersion, 'release_version', 256)
  if (value.contentRef !== undefined) requireBoundedString(value.contentRef, 'content_ref', 512)
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
  if (!isRecord(value) || !hasOnlyKeys(value, ['kind', 'sourceId', 'entryId', 'snapshot'], ['install', 'connection'])) {
    fail('registry_catalog_request_invalid')
  }
  if (value.kind !== 'app' && value.kind !== 'service') fail('registry_catalog_kind_invalid')
  const sourceId = requireBoundedString(value.sourceId, 'source_id', 240)
  const entryId = requireBoundedString(value.entryId, 'entry_id', 240)
  if (!SAFE_ID.test(sourceId)) fail('registry_catalog_source_id_invalid')
  if (!SAFE_ID.test(entryId)) fail('registry_catalog_entry_id_invalid')
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
    ...(value.kind === 'service' && value.install !== undefined ? { install: value.install } : {}),
    ...(value.kind === 'service' && value.connection !== undefined ? { connection: value.connection } : {}),
  }
}

/**
 * Extract exactly one standalone machine line. Human prose is never inspected for identity,
 * snapshot, install, or connection fields.
 */
export function parseRegistryCatalogAcquisitionMessage(message) {
  if (typeof message !== 'string') fail('registry_catalog_message_invalid')
  const matches = message
    .split(/\r?\n/)
    .filter((line) => line.startsWith(MACHINE_LINE_PREFIX))
  if (matches.length === 0) fail('registry_catalog_machine_line_missing')
  if (matches.length !== 1) fail('registry_catalog_machine_line_ambiguous')
  const encoded = matches[0].slice(MACHINE_LINE_PREFIX.length)
  if (!encoded || encoded !== encoded.trim()) fail('registry_catalog_machine_line_malformed')
  let parsed
  try {
    parsed = JSON.parse(encoded)
  } catch {
    fail('registry_catalog_machine_line_malformed')
  }
  return validateRegistryCatalogAcquisitionRequest(parsed)
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

function validateSuccessData(expected, body) {
  if (!isRecord(body) || body.success !== true || !isRecord(body.data)) {
    fail('registry_catalog_resolver_response_invalid')
  }
  const data = body.data
  if (!hasOnlyKeys(
    data,
    ['kind', 'sourceId', 'entryId', 'snapshot', 'manifest'],
    ['install', 'connection', 'installGuide']
  )) {
    fail('registry_catalog_resolver_response_invalid')
  }
  if (data.kind !== 'app' && data.kind !== 'service') fail('registry_catalog_resolver_response_invalid')
  const responseIdentity = {
    kind: data.kind,
    sourceId: requireBoundedString(data.sourceId, 'resolver_source_id', 240),
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
  if (expected.kind === 'app') {
    if (data.manifest.type !== 'docker-app') fail('registry_catalog_resolver_manifest_kind_mismatch')
    requireBoundedText(data.installGuide, 'install_guide', 1024 * 1024)
    // App execution consumes only the server-authorized manifest and install guide.
    return {
      allowed: true,
      kind: expected.kind,
      sourceId: expected.sourceId,
      entryId: expected.entryId,
      snapshot: expected.snapshot,
      manifest: data.manifest,
      installGuide: data.installGuide,
    }
  }
  if (data.manifest.type !== 'mcp' && data.manifest.type !== 'http-api') {
    fail('registry_catalog_resolver_manifest_kind_mismatch')
  }
  return {
    allowed: true,
    kind: expected.kind,
    sourceId: expected.sourceId,
    entryId: expected.entryId,
    snapshot: expected.snapshot,
    manifest: data.manifest,
    ...(data.install !== undefined ? { install: data.install } : {}),
    ...(data.connection !== undefined ? { connection: data.connection } : {}),
    ...(data.installGuide !== undefined ? { installGuide: data.installGuide } : {}),
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
  if (
    (status === 400 && errorCode !== 'invalid') ||
    (status === 404 && errorCode !== 'not_found') ||
    (status === 409 && !BLOCKED_ERROR_CODES.has(errorCode))
  ) {
    return { allowed: false, errorCode: 'unexpected_resolver_error', status }
  }
  return {
    allowed: false,
    errorCode: BLOCKED_ERROR_CODES.has(errorCode) ? errorCode : 'unexpected_resolver_error',
    status,
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
  if (command === 'evaluate-response') {
    const input = JSON.parse(await readStdin())
    if (!isRecord(input) || !hasOnlyKeys(input, ['expected', 'status', 'body'])) {
      fail('registry_catalog_evaluation_input_invalid')
    }
    process.stdout.write(`${JSON.stringify(evaluateRegistryCatalogResolverResult(input.expected, input.status, input.body))}\n`)
    return
  }
  fail('usage: registry-catalog-acquisition.mjs parse-message|evaluate-response')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'registry_catalog_unknown_error'}\n`)
    process.exitCode = 1
  })
}
