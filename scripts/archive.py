"""Create portable archives, with explicit POSIX modes in the Linux tarball."""
import sys
import tarfile
import zipfile
from pathlib import Path

source = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2]).resolve()
assert source.is_dir() and source.parent.name == '部署包'
assert destination.parent == source.parent
if destination.suffix == '.zip':
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file in sorted(source.rglob('*')):
            archive.write(file, file.relative_to(source.parent).as_posix())
else:
    def permissions(info):
        info.uid = info.gid = 0
        info.uname = info.gname = ''
        name = Path(info.name)
        info.mode = 0o755 if info.isdir() or name.suffix == '.sh' or (name.name == 'node' and name.parent.name == 'runtime') else 0o644
        return info
    with tarfile.open(destination, 'w:gz', compresslevel=6) as archive:
        archive.add(source, arcname=source.name, filter=permissions)
print('Archive written successfully.')
