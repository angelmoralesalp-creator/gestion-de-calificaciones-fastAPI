import json
import urllib.request
import urllib.error

API = 'http://127.0.0.1:8000'

def http_request(path, method='GET', data=None, headers=None):
    url = API + path
    body = None
    if data is not None:
        body = json.dumps(data).encode('utf-8')
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header('Content-Type', 'application/json')
    if headers:
        for k,v in headers.items():
            req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.getcode(), json.load(resp)
    except urllib.error.HTTPError as e:
        try:
            err = e.read().decode('utf-8')
            return e.code, json.loads(err)
        except Exception:
            return e.code, {'detail': str(e)}
    except Exception as e:
        return None, {'detail': str(e)}

# 1) Register user
import random, string
suf = ''.join(random.choice('abcdefghijklmnopqrstuvwxyz0123456789') for _ in range(6))
username = f'testuser_{suf}'
email = f'{username}@example.com'
password = 'P@ssw0rd123'
print('Registering user', username, email)
code, resp = http_request('/auth/register', method='POST', data={'username': username, 'email': email, 'password': password})
print('Register response:', code, resp)
if code not in (200,201):
    print('Failed to register, exiting')
    raise SystemExit(1)
token = resp.get('access_token')
if not token:
    print('No token returned, exiting')
    raise SystemExit(1)
headers = {'Authorization': f'Bearer {token}'}

# 2) Create a class (PUT)
item_id = 9999
product = {
    'name': 'clase_prueba',
    'price': 0.0,
    'is_offer': False,
    'partials': []
}
print('Creating product with id', item_id)
code, resp = http_request(f'/items/{item_id}', method='PUT', data=product, headers=headers)
print('Create response:', code, resp)
if code not in (200,201):
    print('Failed to create product, exiting')
    raise SystemExit(1)

# 3) Delete the class
print('Deleting product', item_id)
code, resp = http_request(f'/items/{item_id}', method='DELETE', headers=headers)
print('Delete response:', code, resp)

# 4) Try to GET the deleted item
print('Checking item exists')
code, resp = http_request(f'/items/{item_id}', method='GET', headers=headers)
print('GET after delete:', code, resp)
