import glob
import os

script_tag = '<script src="js/auth-interceptor.js?v=52"></script>\n'

for folder in ['site', 'webapp']:
    for filepath in glob.glob(f'{folder}/*.html'):
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
            
        if 'auth-interceptor.js' in content: continue
            
        # find the first <script src="js/ or just append before <!-- App -->
        if '</head>' in content:
            content = content.replace('</head>', script_tag + '</head>')
        else:
            # find first <script
            idx = content.find('<script')
            if idx != -1:
                content = content[:idx] + script_tag + content[idx:]
                
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
print('Done!')
