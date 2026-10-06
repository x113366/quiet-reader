#!/usr/bin/env python3
"""One public, read-only database health request; launched every 12 hours by launchd."""
import json
import sys
from pathlib import Path
from datetime import datetime
from urllib.request import Request, urlopen
root = Path(__file__).resolve().parent
config = json.loads((root / 'cloud-config.json').read_text())
log = root / 'keepalive.log'
try:
    request = Request(config['url'] + '/rest/v1/rpc/reader_health', data=b'{}', headers={'apikey':config['key'],'Content-Type':'application/json'}, method='POST')
    with urlopen(request, timeout=25) as response:
        ok = json.loads(response.read()) == 'ok'
    message = 'OK' if ok else 'ERROR unexpected response'
except Exception as error:
    message = 'ERROR ' + type(error).__name__ + ': ' + str(error)[:180]
if log.exists() and log.stat().st_size > 1024 * 1024:
    log.replace(root / 'keepalive.previous.log')
with log.open('a') as stream:
    stream.write(datetime.now().astimezone().isoformat(timespec='seconds') + ' ' + message + '\n')
sys.exit(0 if message == 'OK' else 1)
