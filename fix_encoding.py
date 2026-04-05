"""Remove UTF-8 BOM from webapp HTML/JS files that were corrupted by PowerShell Set-Content -Encoding UTF8"""
import os
import glob

dirs_to_fix = [
    r'd:\mir-tankov-bot\webapp',
    r'd:\mir-tankov-bot\site',
]

BOM = b'\xef\xbb\xbf'
fixed = []

for d in dirs_to_fix:
    for pattern in ['*.html', 'js/*.js', '*.css']:
        for path in glob.glob(os.path.join(d, pattern)):
            try:
                with open(path, 'rb') as f:
                    data = f.read()
                if data.startswith(BOM):
                    with open(path, 'wb') as f:
                        f.write(data[3:])
                    fixed.append(path.replace(r'd:\mir-tankov-bot\\', ''))
                    print(f'Fixed: {path}')
            except Exception as e:
                print(f'ERROR {path}: {e}')

print(f'\nTotal fixed: {len(fixed)} files')
