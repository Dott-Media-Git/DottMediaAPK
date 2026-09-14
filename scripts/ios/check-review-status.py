"""Read Apple's current review and release state without changing the listing."""
import json
from codemagic.tools.app_store_connect import AppStoreConnect
from codemagic.tools.app_store_connect.arguments import Types

tool = AppStoreConnect(
    key_identifier=Types.KeyIdentifierArgument.from_environment_variable_default().value,
    issuer_id=Types.IssuerIdArgument.from_environment_variable_default().value,
    private_key=Types.PrivateKeyArgument.from_environment_variable_default().value)
base = 'https://api.appstoreconnect.apple.com/v1'
paths = [
    '/apps/6755872330/appStoreVersions',
    '/reviewSubmissions/76b44f3d-fa30-43ae-9859-8ef4f122a15e',
    '/reviewSubmissions/76b44f3d-fa30-43ae-9859-8ef4f122a15e/items',
]
for path in paths:
    response = tool.api_client.session.get(base + path)
    print(path, response.status_code, flush=True)
    response.raise_for_status()
    data = response.json()['data']
    for record in data if isinstance(data, list) else [data]:
        print(json.dumps({'id':record['id'], 'type':record['type'], 'attributes':record.get('attributes')}), flush=True)
