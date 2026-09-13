import json
import os
import pathlib
import time
import urllib.request

build_id = os.environ['EAS_BUILD_ID']
auth = json.loads(os.environ['EAS_SESSION_AUTH'])
query = '''query($id: ID!) { builds { byId(buildId: $id) {
  id status appVersion appBuildVersion artifacts { buildUrl }
} } }'''
last = None
for attempt in range(160):
    request = urllib.request.Request('https://api.expo.dev/graphql',
        data=json.dumps({'query': query, 'variables': {'id': build_id}}).encode(),
        headers={'Content-Type': 'application/json', 'expo-session': auth['sessionSecret']})
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)
    if result.get('errors'):
        raise RuntimeError('Expo could not resolve the selected build')
    build = result['data']['builds']['byId']
    if build['status'] != last:
        print('Selected Android build:', build_id, build['status'], flush=True)
        last = build['status']
    if build['status'] == 'FINISHED':
        url = build['artifacts']['buildUrl']
        if not url.startswith('https://expo.dev/artifacts/eas/'):
            raise RuntimeError('Unexpected artifact source')
        pathlib.Path('/tmp/dotti-aab-url').write_text(url)
        pathlib.Path('build/android-check').mkdir(parents=True, exist_ok=True)
        pathlib.Path('build/android-check/build.json').write_text(json.dumps(build, indent=2))
        break
    if build['status'] in ('ERRORED', 'CANCELED'):
        raise RuntimeError('Selected Android build did not succeed')
    time.sleep(15)
else:
    raise RuntimeError('Timed out waiting for the selected Android bundle')
