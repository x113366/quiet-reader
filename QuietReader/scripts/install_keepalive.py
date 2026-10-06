#!/usr/bin/env python3
"""Install the current user's macOS login-time Supabase health job."""
from pathlib import Path
import os,sys,plistlib,shutil,subprocess
if sys.platform != 'darwin':
    raise SystemExit('This installer is for macOS launchd.')
project=Path(__file__).resolve().parent.parent
root=Path.home()/'Library/Application Support/QuietReaderKeepalive'
root.mkdir(parents=True,exist_ok=True)
shutil.copyfile(project/'scripts/keepalive.py',root/'keepalive.py')
shutil.copyfile(project/'src/cloud-config.json',root/'cloud-config.json')
plist=Path.home()/'Library/LaunchAgents/local.quietreader.supabase-keepalive.plist'
plist.parent.mkdir(parents=True,exist_ok=True)
subprocess.run(['launchctl','bootout',f'gui/{os.getuid()}',str(plist)],capture_output=True)
with plist.open('wb') as f:
    plistlib.dump({'Label':'local.quietreader.supabase-keepalive','ProgramArguments':[sys.executable,str(root/'keepalive.py')],'RunAtLoad':True,'StartInterval':43200,'ProcessType':'Background','StandardOutPath':str(root/'launchd.log'),'StandardErrorPath':str(root/'launchd.log')},f)
subprocess.run(['launchctl','bootstrap',f'gui/{os.getuid()}',str(plist)],check=True)
print(f'Installed: {plist}\nLog: {root / "keepalive.log"}')
