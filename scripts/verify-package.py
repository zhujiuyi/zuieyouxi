"""Verify deploy manifests, archive contents, runtime architecture, and Linux file modes."""
import hashlib
import json
import struct
import tarfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '部署包'
results = {}
sha = lambda data: hashlib.sha256(data).hexdigest()
for platform in ['Windows', 'Linux']:
    name = f'赎罪之旅-{platform}-x64'
    folder = OUT / name
    lines = (folder / 'SHA256SUMS.txt').read_text(encoding='utf-8').splitlines()
    for line in lines:
        expected, relative = line.split('  ', 1)
        assert sha((folder / relative).read_bytes()) == expected, relative
    assert not list((folder / 'data').iterdir()), 'Deployment must not ship test rooms.'
    for source in ['server.mjs', 'lib/engine.mjs', 'lib/rooms.mjs', 'public/app.js', 'public/table3d.js', 'public/wickedness.js', 'public/wickedness.css', 'public/home.css']:
        assert sha((ROOT / source).read_bytes()) == sha((folder / source).read_bytes()), source
    version = json.loads((folder / '版本信息.json').read_text(encoding='utf-8'))
    if platform == 'Windows':
        archive = OUT / (name + '.zip')
        with zipfile.ZipFile(archive) as z:
            assert z.testzip() is None
            for line in lines:
                expected, relative = line.split('  ', 1)
                assert sha(z.read(name + '/' + relative)) == expected, relative
        binary = (folder / 'runtime' / 'node.exe').read_bytes()
        assert binary[:2] == b'MZ'
        assert sha(binary) == '3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237'
        assert b'\r\n' in (folder / 'start.bat').read_bytes()
    else:
        archive = OUT / (name + '.tar.gz')
        with tarfile.open(archive, 'r:gz') as t:
            for line in lines:
                expected, relative = line.split('  ', 1)
                assert sha(t.extractfile(name + '/' + relative).read()) == expected, relative
            assert t.getmember(name + '/start.sh').mode == 0o755
            assert t.getmember(name + '/runtime/node').mode == 0o755
        binary = (folder / 'runtime' / 'node').read_bytes()
        assert binary[:5] == b'\x7fELF\x02'
        assert struct.unpack_from('<H', binary, 18)[0] == 62, 'Expected AMD64 ELF.'
        assert b'/lib64/ld-linux-x86-64.so.2' in binary
        assert b'\r\n' not in (folder / 'start.sh').read_bytes()
    results[platform] = {'filesVerified': len(lines), 'archive': archive.name, 'archiveBytes': archive.stat().st_size, 'archiveSha256': sha(archive.read_bytes()), 'runtimeSha256': version['runtimeSha256'], 'emptyDataDirectory': True}
(ROOT / 'evidence' / 'package-verification.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
print('Both packages verified: every file, runtime architecture, archive and start-script modes.')
