# Installing, maintaining and enabling contribution products

[简体中文](plugin-contributions.zh-CN.md) · [General v2 flow](agent-led-installation.md)

Plugins add host capabilities; applications own business workspaces and may also provide contributions or consume direct dependencies. productKind selects the principal product category; extension describes those relationships. An extension does not turn an application into a plugin. Protected system applications retain their trusted identity; do not fabricate user installation IDs.

## Confirm target and client support

Use the v2 Plan, exact instance resolution and actual resource claims. For fresh catalog installations, read knowledge.productKind/type/extension/descriptorRequired. The writer rereads the exact catalog source/product before recording; request-body knownProduct is not authority. If these fields are unavailable for a declared extension, investigate client support instead of submitting the old default-application example. Unsupported artifact, descriptor or settings contracts require a client update; never drop fields, read tokens or edit the ledger to bypass rejection.

Use fixed catalog products or authorized user materials. Non-catalog packages use sourceId=user-managed and id=target.softwareId. Changing a source label cannot claim official publication. Identify source, product, installation, device and host rather than matching display names.

## Prepare actual descriptor material

Save AppDefinition JSON in the actual installation directory with sourceId/id/name/version/productKind/entrypoints/placementPolicy and extension. Plugins need a real contribution and may have empty entrypoints. Uses-only applications may have empty contributes but retain a valid principal entrypoint. Contribution, configuration Schema, service descriptor and Skill references use package-relative paths and actual SHA-256 digests, never unverified inline model declarations.

Resolve the descriptor using GET /api/files/resolve-reference?agentId=<current-agent>&path=<URL-encoded-absolute-path> and hash its raw bytes. Submit deployment.descriptor={fileRef: resourceRef, sha256: actual digest}, actual type/version/resources/materials/data locations and maintenance notes. Descriptor and observed versions must agree; never substitute a catalog version for unknown deployed facts.

Fresh catalog contribution installations retain knowledge.type, the principal category and extension relationships. Missing descriptors, discarded extensions, plugin-to-application substitution or changed delivery types are rejected. Repair recording material without repeating software side effects. Declarative packages use artifact with runtime.kind=declarative and no fictitious ports/processes. Service plugins retain real native-app/docker-app deployments and reference existing governed connection/tool identities; installation grants no execution authority.

Verify the agreed consumer capability and record through PATCH /api/installed-entries/instances/<installationId>. Non-catalog extensions also need descriptors. Installation, enablement and current health remain separate facts; prose, model claims and responding ports cannot replace actual consumer checks.

## Settings, dependencies and enablement

GET /api/installed-entries/<installationId>/extensions returns exact installation/revisions, settings, configuration Schema, activation and diagnostics. Validate non-secret configuration using the verified Draft-07 Schema. New keys do not automatically modify UI or services; their semantics require an actual consumer contract. Declaration edits require new material revisions.

PATCH /api/installed-entries/<installationId>/extension-settings uses an actual mutationId, current expectedRevision (none initially), installationRevision, manifestDigest, enabled, complete configuration and dependencyBindings. Preserve existing user configuration and choices. Retry identical bodies with identical IDs; on 409 reread and merge rather than replacing the revision to overwrite another choice.

Enablement does not grant Tool/Agent/team/parent Run authority. Missing required dependencies block; optional dependencies degrade explicitly. Match source/product/contribution and compatible versions, selecting exact instances when ambiguous. Do not automatically install/enable, choose names, cascade removal or delete shared services.

After disabling, reread authoritative state and distinguish closed admission from cleanup pending/failure. Release only this installation's references. Failed requests, disconnections and late responses require current-owner reconciliation rather than inferred success.

## Temporary session development previews

For natural-language customization, first write the actual AppDefinition and package contribution JSON into a currently authorized work directory, verify raw-byte digests, and resolve the descriptor resourceRef. The preview path is `/api/agents/<agentId>/conversations/<conversationId>/plugin-preview`. Use the actual Agent/Conversation identifiers from the current trusted conversation, never inferred names or another user's/session's identifiers. The service verifies conversation ownership from authenticated identity; the descriptor reference must also belong to the current Agent and target hostInstanceId. An API address, material or model declaration grants no authority.

| Operation | API and body | Result and next action |
| --- | --- | --- |
| Read | `GET <preview-path>` | `data.preview` is the current snapshot or null. Check its revision, hostInstanceId, agentId and conversationId against the intended scope. |
| Create/replace | `PUT <preview-path>`, `{ "descriptor": { "fileRef": <actual-resourceRef>, "sha256": "<actual-digest>" }, "configuration": {}, "expectedRevision": "none-or-current-revision" }` | Use none initially and the current revision for replacement. Only success publishes a replacement; failure retains the previous snapshot. configuration is the complete non-secret preview configuration; omission means an empty object. |
| Exit | `DELETE <preview-path>`, `{ "expectedRevision": "<current-revision>", "mutationId": "<UUID>" }` | Success returns null, removing the temporary preview and restoring ordinary session contributions. It does not uninstall or disable an already saved formal instance. DELETE also requires mutationId, but it does not prove retry success; GET after a lost receipt. |
| Save and use | `POST <preview-path>/save`, `{ "expectedRevision": "<current-revision>", "mutationId": "<UUID>" }` | The fixed snapshot is retained under the currently authorized writable root, then recorded and enabled through the existing installation writer and contribution settings owner. Complete success returns savedInstallationId. The preview remains until a separate DELETE. |

Temporary previews currently accept only sourceId=user-managed, productKind=plugin, entrypoints=[], runtime.kind=declarative, exactly one agent-service host and no dependencies. Contributions are limited to session.widgets, session.panels and session.actions; actions only open-panel. Existing finite native UI consumes these declarations. Previews do not run arbitrary HTML/JavaScript, tools, parsers, Skills, services or arbitrary actions. Other contributions use formal installation, authorization and consumer verification; do not discard capabilities to pretend preview support. A generic configuration Schema defines validation and storage; display or behavior still requires an actual consumer contract.

A preview is a fixed historical material snapshot verified at creation/replacement. Later edits or deletion of source files do not silently change it. To continue editing, verify new materials and PUT using the current revision. Saving retains the snapshot the user is viewing, rather than rereading source files and including unpreviewed edits. Temporary records live only in the current service instance's memory. A different instance or service restart cannot claim recovery of the old preview; formal saved installations recover through the existing record/settings owners.

On 409, GET and reconcile the snapshot the user is viewing; never simply replace expectedRevision to force an overwrite. After disconnection or an uncertain result, GET first. If pendingSaveMutationId is returned, reuse it and the same revision for /save rather than creating another installation. After complete success, read formal installation/settings state by savedInstallationId. If a service restart returns null, first reconcile the previously recorded formal instance; null does not prove the earlier save never happened and does not justify duplicate creation. plugin-preview:changed only prompts a reread for the same trusted conversation and carries no material/configuration. Revoked roots or an unavailable trusted conversation require stopping reads/saves with the actual error, never bypassing it with old references or tokens.

## Updates, removal and natural-language customization

Updates/reinstallation, including same-version replacement, reverify the descriptor, package material and digests through the existing writer. File edits never hot-replace formal active versions. Enlarged authority needs review and configuration must satisfy the new Schema; failures do not imply automatic rollback.

Before removal, identify disablement, shared references and actual process/material scope. Preserve user data by default. Record absent only after verifying the exact removal; removed descriptor files do not prevent retaining existing snapshots for removal or exact committed retries. Existing instances remain maintainable from recorded facts when the catalog is offline.

Persist descriptor locations/digests, settings entrypoints, tool/service references, verification and shared-data preservation rules in maintenance notes. Generate declarative contributions in supported session-scoped development previews; exiting releases temporary bindings. Only explicit save-and-use creates durable material through the same installation/settings owners. Generation or preview is not installation/enablement and does not authorize sharing or publication.
