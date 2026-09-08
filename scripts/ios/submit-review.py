"""Submit the existing release using credentials held by Codemagic."""
import json
import subprocess


def resources(*args):
    result = subprocess.run(
        ["app-store-connect", *args, "--json"],
        check=True, capture_output=True, text=True,
    )
    value = json.loads(result.stdout)
    if isinstance(value, dict):
        value = value.get("data", [value])
    return value


apps = resources("apps", "list", "--bundle-id-identifier", "com.dottmedia.dottmediaapk", "--strict-match-identifier")
if len(apps) != 1:
    raise SystemExit("Expected exactly one Dotti app record")
app_id = apps[0]["id"]
print("Apple app ID:", app_id, flush=True)
builds = resources("builds", "list", "--app-id", app_id, "--build-version-number", "38", "--pre-release-version", "1.0.0", "--not-expired")
if len(builds) != 1:
    raise SystemExit("Expected exactly one non-expired build 1.0.0 (38)")
print("Build:", builds[0]["id"], "processing:", builds[0].get("attributes", {}).get("processingState"), flush=True)
subprocess.run([
    "app-store-connect", "builds", "submit-to-app-store", builds[0]["id"],
    "--release-type", "AFTER_APPROVAL", "--version-string", "1.0.0",
], check=True)
