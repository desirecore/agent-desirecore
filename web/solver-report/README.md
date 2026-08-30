# Solver Report Web

Version-controlled source and build tooling for the public Solver Agent Team evidence report.

This directory owns the Web application, interaction behavior, build contract, validators, and deployment verification scripts. Scenario packs, runtime receipts, and original screenshots remain external build inputs so the core DesireCore Agent bootstrap does not grow by hundreds of megabytes.

## Image viewer

The screenshot viewer supports:

- fit-to-window and 1:1 pixel modes;
- bounded zoom buttons and `+` / `-` / `0` / `1` keyboard shortcuts, including 1:1 source pixels on mobile;
- `Ctrl`/`Command` + wheel or trackpad pinch zoom around the pointer;
- double-click zoom and mouse/touch drag panning;
- two-pointer touch pinch zoom;
- an original-file download link and accessible live zoom status.

Each newly opened image starts in fit mode. Closing and reopening the viewer does not retain stale zoom or pan state.

## Build

The build consumes an evidence directory with `scenario-packs/`, `evidence/`, and `report-web/dist/` output. Rendering dependencies are resolved from a DesireCore application checkout.

Public builds also require `evidence/public-release-attestation.json`. The [Draft-07 Schema](./public-release-attestation.schema.json) binds the review to the content roots of every public message and all 174 screenshots, together with the review methods, evidence ownership, and public-release verdict. Any message or screenshot change invalidates the old attestation and fails the build.

The site consumes `evidence/screenshots/public-screenshot-plan.json`, a derivation plan whose `sourceSha256` values bind every public image to the immutable raw evidence. Raw screenshots containing local paths must never be used as public originals.

```bash
export SOLVER_REPORT_INPUT_ROOT=/absolute/path/to/scenario-book
export DESIRECORE_APP_ROOT=/absolute/path/to/desirecore
node scripts/build-report-web.mjs
node scripts/validate-report-web.mjs
```

Optional environment variables:

- `SOLVER_REPORT_OUTPUT_ROOT`: override the generated directory. To make recursive cleanup safe, it must remain below `<SOLVER_REPORT_INPUT_ROOT>/report-web/` and must not overlap the Agent source or DesireCore application checkout.
- `LATEST_PLATFORM_REGRESSION_FILE`: override the latest regression summary.
- `SOLVER_REPORT_PUBLIC_RELEASE_ATTESTATION_FILE`: override the public-release attestation path.
- `SOLVER_REPORT_VALIDATION_FILE`: override the validation report path.
- `REPORT_BASE_URL`: public URL used by `validate-deployed-report.mjs`.
- `SOLVER_REPORT_DEPLOYMENT_VALIDATION_FILE`: override deployment validation output.

Run the source contract tests with `node --test tests/*.test.mjs`.

Before signing a public-release attestation, review every original screenshot at readable resolution. Contact sheets are only a hash-labelled coverage index; they are not sufficient for reading small credentials. On macOS, run the original-resolution Apple Vision OCR gate as a second, independent check:

```bash
export SOLVER_REPORT_SCREENSHOT_OCR_FILE=/private/tmp/solver-report-ocr.json
export SOLVER_REPORT_SCREENSHOT_OCR_VALIDATION_FILE=/private/tmp/solver-report-ocr-validation.json
npm run privacy:ocr
```

The validator requires all 174 planned files in order, recomputes every source hash, and applies the same fail-closed sensitive-text policy to recognized text. OCR and full-resolution visual review are both required before updating the attestation. Review-only artifacts never enter the site output or Agent bootstrap.

## Deployment boundary

The builder projects only allowlisted public provenance fields and rejects local paths, email addresses, private URLs, common key formats, and named credentials. Deployment validation also requires `build.json#gates.publicReleasePrivacy=pass` and an attestation digest matching the manifest.

Generate a new immutable release, verify every `integrity.json` entry before switching, and atomically update the server's `current` symlink. Never overwrite an existing release or relabel historical evidence as output from a newer platform commit.
