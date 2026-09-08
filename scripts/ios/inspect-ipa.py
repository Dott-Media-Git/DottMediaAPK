import argparse
import datetime
import hashlib
import json
import pathlib
import plistlib
import re
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('ipa')
parser.add_argument('--sha256')
parser.add_argument('--build')
args = parser.parse_args()
path = pathlib.Path(args.ipa)
if args.sha256 and hashlib.sha256(path.read_bytes()).hexdigest() != args.sha256.lower():
    raise SystemExit('IPA checksum mismatch')
with zipfile.ZipFile(path) as archive:
    info_path = next(name for name in archive.namelist() if re.fullmatch(r'Payload/[^/]+\.app/Info.plist', name))
    info = plistlib.loads(archive.read(info_path))
    root = info_path.rsplit('/', 1)[0]
    raw = archive.read(root + '/embedded.mobileprovision')
    start = raw.index(b'<?xml')
    profile = plistlib.loads(raw[start:raw.index(b'</plist>', start) + 8])
    assert info['CFBundleIdentifier'] == 'com.dottmedia.dottmediaapk', 'Unexpected bundle identifier'
    assert not args.build or info['CFBundleVersion'] == args.build, 'Unexpected build number'
    assert profile['TeamIdentifier'] == ['VDUKXWBYVR'], 'Unexpected Apple developer team'
    assert not profile.get('ProvisionedDevices') and not profile.get('ProvisionsAllDevices'), 'App Store distribution profile required'
    assert not profile['Entitlements'].get('get-task-allow'), 'Development signing is not allowed'
    assert profile['ExpirationDate'] > datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None), 'Provisioning profile expired'
    assert root + '/_CodeSignature/CodeResources' in archive.namelist(), 'Signature resources missing'
    print(json.dumps({'bundleId': info['CFBundleIdentifier'], 'version': info['CFBundleShortVersionString'], 'build': info['CFBundleVersion'], 'sdk': info.get('DTSDKName'), 'profileExpires': str(profile['ExpirationDate'])}))
