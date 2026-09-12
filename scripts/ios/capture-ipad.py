"""Capture the real release app on an available large iPad simulator."""
import json
import pathlib
import subprocess
import time
import shutil

def run(*args):
    return subprocess.check_output(args, text=True).strip()

devices = json.loads(run('xcrun', 'simctl', 'list', 'devices', 'available', '--json'))
candidates = [d for group in devices['devices'].values() for d in group
              if 'iPad Pro' in d['name'] and ('13-inch' in d['name'] or '12.9' in d['name'])]
if not candidates:
    raise RuntimeError('No App Store sized iPad simulator is installed')
device = candidates[0]
uid = device['udid']
if device['state'] != 'Booted':
    run('xcrun', 'simctl', 'boot', uid)
run('xcrun', 'simctl', 'bootstatus', uid, '-b')
run('xcrun', 'simctl', 'status_bar', uid, 'override', '--time', '9:41', '--batteryState', 'charged', '--batteryLevel', '100')
apps = list(pathlib.Path('build/simulator/Build/Products/Release-iphonesimulator').glob('*.app'))
if len(apps) != 1:
    raise RuntimeError(f'Expected one simulator app, found {len(apps)}')
run('xcrun', 'simctl', 'install', uid, str(apps[0]))
run('xcrun', 'simctl', 'launch', uid, 'com.dottmedia.dottmediaapk')
time.sleep(25)
pathlib.Path('build/ipad-screenshots').mkdir(parents=True, exist_ok=True)
run('xcrun', 'simctl', 'io', uid, 'screenshot', 'build/ipad-screenshots/dotti-ipad.png')
diagnostics = pathlib.Path('build/ipad-diagnostics')
diagnostics.mkdir(parents=True, exist_ok=True)
for report in (pathlib.Path.home() / 'Library/Logs/DiagnosticReports').glob('*'):
    if report.is_file() and ('Dott' in report.name or report.suffix == '.ips'):
        shutil.copy2(report, diagnostics / report.name)
logs = subprocess.run(['xcrun','simctl','spawn',uid,'log','show','--last','3m','--style','compact','--predicate','process == "DottMediaCRM"'], capture_output=True, text=True)
(diagnostics / 'app-log.txt').write_text(logs.stdout + logs.stderr)
print('Captured native app on', device['name'])
