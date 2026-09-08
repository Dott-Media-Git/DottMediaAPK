"""Update known listing facts without inventing review or privacy declarations."""
import json
import os

from codemagic.tools.app_store_connect import AppStoreConnect

tool = AppStoreConnect(
    key_identifier=os.environ.get("APP_STORE_CONNECT_KEY_IDENTIFIER"),
    issuer_id=os.environ.get("APP_STORE_CONNECT_ISSUER_ID"),
    private_key=os.environ.get("APP_STORE_CONNECT_PRIVATE_KEY"),
)
client = tool.api_client
base = "https://api.appstoreconnect.apple.com/v1"
app_id = "6755872330"
version_id = "16684293-368b-4a1b-b037-4ef02df4f968"


def get(path):
    response = client.session.get(base + path)
    response.raise_for_status()
    return response.json()["data"]


def patch(kind, resource_id, **values):
    response = client.session.patch(base + "/" + kind + "/" + resource_id, json={
        "data": {"type": kind, "id": resource_id, **values},
    })
    if not response.ok:
        print(response.text, flush=True)
    response.raise_for_status()
    print("Updated", kind, resource_id, flush=True)


infos = get(f"/apps/{app_id}/appInfos")
editable = [i for i in infos if i["attributes"]["appStoreState"] in ("PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "METADATA_REJECTED", "REJECTED")]
if len(editable) != 1:
    raise SystemExit("Expected one editable app info; leaving existing records unchanged")
info = editable[0]
patch("appInfos", info["id"], relationships={"primaryCategory": {"data": {"type": "appCategories", "id": "BUSINESS"}}})
for localization in get(f"/appInfos/{info['id']}/appInfoLocalizations"):
    patch("appInfoLocalizations", localization["id"], attributes={"privacyPolicyUrl": "https://dotti.dott-media.org/privacy"})
patch("appStoreVersions", version_id, attributes={"releaseType": "AFTER_APPROVAL"})
version = get(f"/appStoreVersions/{version_id}")
print("Version state:", json.dumps({k: version["attributes"].get(k) for k in ("versionString", "appStoreState", "releaseType")}), flush=True)
for localization in get(f"/appStoreVersions/{version_id}/appStoreVersionLocalizations"):
    attrs = localization["attributes"]
    print("Listing fields:", json.dumps({"locale": attrs.get("locale"), "descriptionPresent": bool(attrs.get("description")), "supportUrl": attrs.get("supportUrl")}), flush=True)
    for screenshots in get(f"/appStoreVersionLocalizations/{localization['id']}/appScreenshotSets"):
        files = get(f"/appScreenshotSets/{screenshots['id']}/appScreenshots")
        print("Screenshots:", screenshots["attributes"]["screenshotDisplayType"], len(files), flush=True)
print("Remaining owner input: iPad screenshot; review contact and demo access; privacy data disclosures; age rating and content rights; pricing.", flush=True)
