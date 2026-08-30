#!/usr/bin/env python3
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1]).resolve()
integrity = json.loads((root / "integrity.json").read_text(encoding="utf-8"))
failures = []
for entry in integrity["entries"]:
    raw_path = entry.get("path")
    if (
        not isinstance(raw_path, str)
        or not raw_path
        or "//" in raw_path
        or "\\" in raw_path
        or "%" in raw_path
        or "?" in raw_path
        or "#" in raw_path
    ):
        failures.append({"path": str(raw_path), "issue": "unsafe-path"})
        continue
    relative_path = pathlib.PurePosixPath(raw_path)
    if relative_path.is_absolute() or any(part in ("", ".", "..") for part in relative_path.parts):
        failures.append({"path": raw_path, "issue": "unsafe-path"})
        continue
    path = (root / pathlib.Path(*relative_path.parts)).resolve()
    if path == root or root not in path.parents:
        failures.append({"path": raw_path, "issue": "path-escape"})
        continue
    if not path.is_file():
        failures.append({"path": raw_path, "issue": "missing"})
        continue
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if len(data) != entry["bytes"] or digest != entry["sha256"]:
        failures.append({"path": raw_path, "issue": "mismatch"})

manifest = json.loads((root / "data" / "manifest.json").read_text(encoding="utf-8"))
build = json.loads((root / "build.json").read_text(encoding="utf-8"))
if build.get("gates", {}).get("publicReleasePrivacy") != "pass":
    failures.append({"path": "build.json", "issue": "public-release-privacy-gate"})
if build.get("gates", {}).get("decisionTrees") != "pass":
    failures.append({"path": "build.json", "issue": "decision-tree-gate"})
if build.get("publicReleaseAttestationSha256") != manifest.get("publicReleaseAttestationSha256"):
    failures.append({"path": "build.json", "issue": "public-release-attestation-mismatch"})
if (
    build.get("buildId") != manifest.get("buildId")
    or build.get("contentRootSha256") != manifest.get("contentRootSha256")
    or integrity.get("contentRootSha256") != manifest.get("contentRootSha256")
    or build.get("publicEvidenceRoots") != manifest.get("publicEvidenceRoots")
    or build.get("counts") != manifest.get("counts")
    or build.get("integrityEntries") != len(integrity.get("entries", []))
    or not any(entry.get("path") == "build.json" for entry in integrity.get("entries", []))
):
    failures.append({"path": "build.json", "issue": "build-manifest-integrity-projection"})
result = {
    "buildId": manifest["buildId"],
    "contentRootSha256": manifest["contentRootSha256"],
    "chapters": len(manifest["chapters"]),
    "integrityEntries": len(integrity["entries"]),
    "failures": failures,
    "passed": not failures,
}
print(json.dumps(result, ensure_ascii=False))
raise SystemExit(0 if result["passed"] else 1)
