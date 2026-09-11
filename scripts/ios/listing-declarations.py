"""Owner-authorized free pricing and content declarations, 11 September 2026."""
import json
from decimal import Decimal


def complete_declarations(client, app_id, info_id):
    base = "https://api.appstoreconnect.apple.com/v1"

    def request(method, path, payload=None):
        response = client.session.request(method, base + path, json=payload)
        if not response.ok:
            print(response.text, flush=True)
        response.raise_for_status()
        return response.json()

    request("PATCH", f"/apps/{app_id}", {"data": {
        "type": "apps", "id": app_id,
        "attributes": {"contentRightsDeclaration": "USES_THIRD_PARTY_CONTENT"},
    }})
    print("Content rights: authorized user and connected-platform content", flush=True)

    age = request("GET", f"/appInfos/{info_id}/ageRatingDeclaration")["data"]
    # Business/CRM content, not a game or a catalog of mature entertainment.
    # Disclose user content, social-platform integration and messaging explicitly.
    attributes = dict.fromkeys([
        "alcoholTobaccoOrDrugUseOrReferences", "contests", "gamblingSimulated",
        "gunsOrOtherWeapons", "medicalOrTreatmentInformation", "profanityOrCrudeHumor",
        "sexualContentGraphicAndNudity", "sexualContentOrNudity", "horrorOrFearThemes",
        "matureOrSuggestiveThemes", "violenceCartoonOrFantasy", "violenceRealistic",
        "violenceRealisticProlongedGraphicOrSadistic",
    ], "NONE")
    attributes.update({
        "advertising": True,
        "gambling": False, "healthOrWellnessTopics": False, "lootBox": False,
        "messagingAndChat": True, "parentalControls": False, "ageAssurance": False,
        "unrestrictedWebAccess": False, "userGeneratedContent": True,
        "socialMedia": True, "socialMediaAgeRestricted": False,
        "ageRatingOverrideV2": "NONE", "koreaAgeRatingOverride": "NONE",
    })
    request("PATCH", f"/ageRatingDeclarations/{age['id']}", {"data": {
        "type": "ageRatingDeclarations", "id": age["id"], "attributes": attributes,
    }})
    saved_age = request("GET", f"/appInfos/{info_id}/ageRatingDeclaration")["data"]["attributes"]
    assert all(saved_age.get(k) == v for k, v in attributes.items()), "Age declaration verification failed"
    print("Age questionnaire saved; no voluntary age override; UGC, messaging, advertising and social features declared", flush=True)

    # Free download was explicitly confirmed by the owner; in-app service pricing is separate.
    points = request("GET", f"/apps/{app_id}/appPricePoints?filter[territory]=USA&limit=200")
    free = next((p for p in points["data"] if Decimal(p["attributes"]["customerPrice"]) == 0), None)
    while free is None and points.get("links", {}).get("next"):
        next_url = points["links"]["next"]
        if not next_url.startswith(base + "/"):
            raise RuntimeError("Unexpected pricing pagination host")
        points = request("GET", next_url[len(base):])
        free = next((p for p in points["data"] if Decimal(p["attributes"]["customerPrice"]) == 0), None)
    if free is None:
        raise RuntimeError("Apple did not return a free app price point")
    schedule = request("POST", "/appPriceSchedules", {
        "data": {"type": "appPriceSchedules", "relationships": {
            "app": {"data": {"type": "apps", "id": app_id}},
            "baseTerritory": {"data": {"type": "territories", "id": "USA"}},
            "manualPrices": {"data": [{"type": "appPrices", "id": "${dotti-free}"}]},
        }},
        "included": [{"type": "appPrices", "id": "${dotti-free}",
            "attributes": {"startDate": None, "endDate": None},
            "relationships": {"appPricePoint": {"data": {"type": "appPricePoints", "id": free["id"]}}},
        }],
    })
    prices = request("GET", f"/appPriceSchedules/{schedule['data']['id']}/manualPrices?include=appPricePoint")
    saved_points = [p for p in prices.get("included", []) if p["type"] == "appPricePoints"]
    assert saved_points and all(Decimal(p["attributes"]["customerPrice"]) == 0 for p in saved_points), "Free price verification failed"
    print("App Store download price verified: FREE", flush=True)
    updated_info = request("GET", f"/appInfos/{info_id}")["data"]["attributes"]
    print("Apple calculated ratings:", json.dumps({k: v for k, v in updated_info.items() if "rating" in k.lower()}), flush=True)
