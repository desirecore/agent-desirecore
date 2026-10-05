# Agent-led installation and maintenance (v2)

[简体中文](agent-led-installation.zh-CN.md)

Use the active Agent Service's existing HttpRequest capability and authenticated context. These APIs resolve context, coordinate resources and record facts; they never install software. Do not read tokens or bypass failures by editing the ledger.

## Handoff and investigation

Use the supplied ApplicationManagement envelope. For a natural-language request, create the structure below with actual UUIDs and save requestId/installationId in the existing Plan. target.softwareId is a stable software identity: the catalog entry ID, or a persistent software UUID for supplied materials. Software and deployment UUIDs are independent. For existing installations first GET /api/installed-entries and select the exact installationId; never choose the first display-name match.

```json
{
  "protocol": "application-management-v2",
  "requestId": "replace with delegation UUID",
  "installationId": "replace with deployment UUID; reuse on recovery",
  "deviceId": "local",
  "action": "install",
  "target": { "softwareId": "stable-software-id", "name": "Application", "description": "Installation goal" },
  "desiredOutcome": "Capability the user expects to work and be verified",
  "constraints": "Explicit version, data, directory and network limits",
  "materials": []
}
```

This is a structural example; replace UUID placeholders. Catalog targets may add catalogSourceId; omit it for supplied materials. Actions are install/manage/update/uninstall. local means the service host, not necessarily the desktop. Other device IDs must be registered nodes. Use existing authorized remote tools, never treating a remote endpoint as local.

Each material contains purpose and exactly one url/fileRef, optionally revision/sha256. Use issued file references; absolute paths are not fileRef objects. Reference SQL, code, templates and large files instead of copying their bodies into JSON. Mutable URLs may start an investigation; retain available revision/hash for actually used content. Materials confer no execution authority.

For a local file without an existing reference, GET `/api/files/resolve-reference?agentId=<current-agent-id>&path=<URL-encoded-absolute-path>` on the active service and use the returned top-level `resourceRef` as `fileRef`. The service checks registered roots; do not manufacture root IDs or expand permissions to bypass rejection. A material has no `location` field. If no reference can be issued, retain the actual path and reason in maintenance notes and disclose the missing structured reference; never invent a URL. A 400 validation response has no registration effects: correct only the rejected fields, preserving the deployment and SQL state, then retry recording.

POST /api/registry/acquisitions/resolve with the envelope. Continue only on success=true and data.protocol=application-management-v2; retain data.material and expectedRevision. knowledge is catalog installation knowledge and may lack installGuide; that absence does not prohibit installation. record contains historical instance/maintenance/observation data and supports catalog-offline maintenance. Legacy resolution returns the existing stable identity; after v2 migration, v1 cannot mutate the instance.

Read instructions, inspect the host and existing installations, then select the method. Evaluate available Compose/scripts; otherwise build a method from README, source, configuration and SQL. Adapt within constraints without requiring a standard software installation API.

The resolved material includes hostInstanceId to bind the ledger host. Preserve it on subsequent requests. A host mismatch after switching connections must stop the operation; never remove the binding to install on another machine. It validates the target and grants no permission.

## Resource ownership

Before side effects POST /api/installed-entries/resource-claims with `{material, operation:"claim", resources:["actual absolute installation directory or stable container/project locator"]}`. Use resolved material unchanged. All tasks must use consistent locators. Windows drive paths normalize case/separators; other locators must be stable. Claim shared databases by server/database identity too, not only the software directory.

Coordinate a conflicting holder rather than changing UUID and executing concurrently. Claims survive crashes without automatic expiry; the same requestId can resume. Release using the same material/resources and operation=release only after confirming no side effects remain in flight. HTTP disconnection does not prove execution stopped. Claims coordinate cooperation; they grant no permissions and cannot force unrelated external programs to cooperate.

## Verify and record

For plugins and applications with contributions or direct dependencies, first read [Contribution installation and settings](plugin-contributions.md). For a fresh catalog target, knowledge.productKind/type/extension/descriptorRequired come from the server catalog. When a descriptor is required, add the actual deployment.type and descriptor: {fileRef, sha256}. The generic example below does not replace these requirements; missing declarations must not be registered as default applications. Non-catalog declarative artifacts also require a descriptor.

PATCH /api/installed-entries/instances/{installationId}:

```text
{
  material: unchanged data.material,
  expectedRevision: latest resolved/read revision,
  submissionId: recording UUID (reuse ID and body on retry),
  observation: {result:"present|absent", observedAt: ISO time, location: actual location, evidenceRefs:[real evidence references], notes: optional summary},
  verification: {readiness:"verified|incomplete|failed|notChecked", scope: actual checks, remainingWork: remaining work or empty string},
  deployment: {
    method: actual method, actualVersion: observed version or null,
    resources: [stable actual locators], dataLocations: [preserved data locations],
    materials: [actually used references and available provenance],
    maintenance: secret-free Markdown maintenance notes (maximum 32768 characters)
  }
}
```

Existing resources with failed database initialization mean present + incomplete/failed, not completed installation. verified requires the agreed capability check and empty remainingWork. Inspect actual schema/migration facts after SQL interruption or duplicate requests; never blindly replay. Confirm a responding port belongs to this instance. Record absent only after confirming software removal, retaining preserved-data locations.

Maintenance notes persist within the instance record. Include actual version, resource/data locations, identification/opening methods, initialization/migration history, verification, update/removal preservation rules and unfinished work. Reference larger materials durably; do not rely exclusively on expiring URLs, temporary attachments or session caches. Later Agents read these notes; the platform does not execute them.

Recording does not require the catalog to remain listed. Structure, host/owner, material scope and revision are still checked. Report software results and recording results separately on failure.

## Recovery and maintenance

GET /api/installed-entries/instances/{installationId} returns record/revision. After a lost response, read first. If observation.requestId matches submissionId, retrying the identical body returns replayed=true without reinstalling. On revision conflict reread and investigate; do not merely replace expectedRevision. Unknown legacy facts remain unknown.

GET /api/installed-entries/instances/{installationId}/history/{revision} retrieves previous maintenance records; current observation.baseRevision points to the previous record. Updating notes preserves earlier materials. A new conversation reads record.installation for target/provenance/maintenance, investigates current state, then opens, repairs, updates or removes the instance. Historical verification is not live health.

Existing user installations may be adopted after inspection without reinstalling. Remove only the precise instance's software, preserving data by default; additional data deletion follows existing permissions. Failure implies neither automatic rollback nor successful removal. Investigate unknown outcomes; recording idempotency is not exactly-once command execution.
