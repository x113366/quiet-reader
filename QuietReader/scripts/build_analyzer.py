"""Build a self-contained analyzer for the host platform and architecture."""
from pathlib import Path
import subprocess
import json
import platform
import sys
root = Path(__file__).resolve().parents[1]
args = [sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir',
        '--name', 'quiet-analyzer', '--distpath', str(root / 'runtime'),
        '--workpath', str(root / 'runtime-build'), '--specpath', str(root / 'runtime-build'),
        '--collect-all', 'jieba']
for name in ['analysis_config.json', 'stopwords_custom.txt', 'stopwords_general.txt', 'stopwords_narrative.txt']:
    args += ['--add-data', str(root / 'analysis' / name) + ':.' ]
subprocess.run(args + [str(root / 'analysis/analyze_novel.py')], check=True)

machine = platform.machine().lower()
info = {"platform": {"darwin": "darwin", "win32": "win32", "linux": "linux"}[sys.platform], "arch": {"aarch64": "arm64", "arm64": "arm64", "x86_64": "x64", "amd64": "x64"}[machine]}
(root / "runtime/quiet-analyzer/build-info.json").write_text(json.dumps(info))
