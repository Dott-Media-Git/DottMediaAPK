"""Update known listing facts without inventing review or privacy declarations."""
import json
import os
import runpy
from pathlib import Path

from codemagic.tools.app_store_connect import AppStoreConnect
from codemagic.tools.app_store_connect.arguments import Types

tool = AppStoreConnect(
    key_identifier=Types.KeyIdentifierArgument.from_environment_variable_default().value,
    issuer_id=Types.IssuerIdArgument.from_environment_variable_default().value,
    private_key=Types.PrivateKeyArgument.from_environment_variable_default().value,
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
runpy.run_path(str(Path(__file__).with_name("listing-declarations.py")))["complete_declarations"](client, app_id, info["id"])
patch("appInfos", info["id"], relationships={"primaryCategory": {"data": {"type": "appCategories", "id": "BUSINESS"}}})
for localization in get(f"/appInfos/{info['id']}/appInfoLocalizations"):
    patch("appInfoLocalizations", localization["id"], attributes={"privacyPolicyUrl": "https://dotti.dott-media.org/privacy"})
patch("appStoreVersions", version_id, attributes={"releaseType": "AFTER_APPROVAL"})
if os.environ.get("APP_REVIEW_PASSWORD"):
    review_attributes = {
        "contactFirstName": "Dott",
        "contactLastName": "Media",
        "contactEmail": "info@dott-media.org",
        "contactPhone": "+256775067216",
        "demoAccountRequired": True,
        "demoAccountName": "apple-review@dott-media.org",
        "demoAccountPassword": os.environ["APP_REVIEW_PASSWORD"],
        "notes": "Sign in using Email and Password with the supplied review credentials. This dedicated workspace has complimentary Business access and no customer data or connected social accounts. Email verification is already complete. Explore the assistant, content creation, scheduling, CRM and integration settings. Publishing to an external platform requires connecting an authorized platform account, as it does for other users.",
    }
    response = client.session.get(base + f"/appStoreVersions/{version_id}/appStoreReviewDetail")
    if response.ok and response.json().get("data"):
        patch("appStoreReviewDetails", response.json()["data"]["id"], attributes=review_attributes)
    elif response.status_code == 404 or (response.ok and not response.json().get("data")):
        response = client.session.post(base + "/appStoreReviewDetails", json={"data": {
            "type": "appStoreReviewDetails", "attributes": review_attributes,
            "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": version_id}}},
        }})
        if not response.ok:
            print("Review details creation failed:", response.status_code, flush=True)
        response.raise_for_status()
        print("Created private review login details", flush=True)
    else:
        response.raise_for_status()
    saved_review = get(f"/appStoreVersions/{version_id}/appStoreReviewDetail")["attributes"]
    print("Review login verified:", saved_review.get("demoAccountName") == review_attributes["demoAccountName"] and saved_review.get("demoAccountPassword") == review_attributes["demoAccountPassword"], flush=True)
    print("Review contact complete:", all(saved_review.get(k) for k in ("contactFirstName", "contactLastName", "contactEmail", "contactPhone")), flush=True)
version = get(f"/appStoreVersions/{version_id}")
print("Version state:", json.dumps({k: version["attributes"].get(k) for k in ("versionString", "appStoreState", "releaseType")}), flush=True)
for localization in get(f"/appStoreVersions/{version_id}/appStoreVersionLocalizations"):
    attrs = localization["attributes"]
    patch("appStoreVersionLocalizations", localization["id"], attributes={"supportUrl": "https://dott-media.org/contact"})
    print("Listing fields:", json.dumps({"locale": attrs.get("locale"), "descriptionPresent": bool(attrs.get("description")), "supportUrl": attrs.get("supportUrl")}), flush=True)
    for screenshots in get(f"/appStoreVersionLocalizations/{localization['id']}/appScreenshotSets"):
        files = get(f"/appScreenshotSets/{screenshots['id']}/appScreenshots")
        print("Screenshots:", screenshots["attributes"]["screenshotDisplayType"], len(files), flush=True)
print("Check remaining requirements: iPad screenshot; reachable review contact phone/email; published privacy data disclosures; live account data access.", flush=True)
