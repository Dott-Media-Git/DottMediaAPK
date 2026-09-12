"""Upload an inspected native iPad capture to the existing App Store version."""
import hashlib
import pathlib
import time
import requests
from codemagic.tools.app_store_connect import AppStoreConnect
from codemagic.tools.app_store_connect.arguments import Types

tool = AppStoreConnect(
    key_identifier=Types.KeyIdentifierArgument.from_environment_variable_default().value,
    issuer_id=Types.IssuerIdArgument.from_environment_variable_default().value,
    private_key=Types.PrivateKeyArgument.from_environment_variable_default().value)
session = tool.api_client.session
base = 'https://api.appstoreconnect.apple.com/v1'
locale = '95f385a7-5f68-4aee-95fc-c672337fa732'

def call(method, path, data=None):
    r = session.request(method, base + path, json=data)
    if not r.ok:
        print(r.text)
    r.raise_for_status()
    return r.json()['data']

sets = call('GET', f'/appStoreVersionLocalizations/{locale}/appScreenshotSets')
ipad = next((s for s in sets if s['attributes']['screenshotDisplayType'] == 'APP_IPAD_PRO_3GEN_129'), None)
if not ipad:
    ipad = call('POST', '/appScreenshotSets', {'data': {
        'type': 'appScreenshotSets',
        'attributes': {'screenshotDisplayType': 'APP_IPAD_PRO_3GEN_129'},
        'relationships': {'appStoreVersionLocalization': {'data': {'type': 'appStoreVersionLocalizations', 'id': locale}}}}})
data = pathlib.Path('assets/app-store/dotti-ipad.png').read_bytes()
checksum = hashlib.md5(data).hexdigest()
existing = call('GET', f'/appScreenshotSets/{ipad["id"]}/appScreenshots')
shot = next((s for s in existing if s['attributes'].get('sourceFileChecksum') == checksum), None)
if not shot:
    shot = call('POST', '/appScreenshots', {'data': {'type': 'appScreenshots',
        'attributes': {'fileName': 'dotti-ipad.png', 'fileSize': len(data)},
        'relationships': {'appScreenshotSet': {'data': {'type': 'appScreenshotSets', 'id': ipad['id']}}}}})
    for op in shot['attributes']['uploadOperations']:
        r = requests.request(op['method'], op['url'],
            headers={h['name']: h['value'] for h in op['requestHeaders']},
            data=data[op['offset']:op['offset'] + op['length']], timeout=60)
        r.raise_for_status()
    shot = call('PATCH', '/appScreenshots/' + shot['id'], {'data': {
        'id': shot['id'], 'type': 'appScreenshots',
        'attributes': {'uploaded': True, 'sourceFileChecksum': checksum}}})
for _ in range(30):
    shot = call('GET', '/appScreenshots/' + shot['id'])
    state = shot['attributes']['assetDeliveryState']['state']
    if state == 'COMPLETE':
        print('Verified iPad screenshot uploaded:', shot['id'])
        break
    if state == 'FAILED':
        raise RuntimeError(str(shot['attributes']['assetDeliveryState']))
    time.sleep(5)
else:
    raise RuntimeError('Screenshot processing has not completed')
