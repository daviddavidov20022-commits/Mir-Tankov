import os
for path in ['webapp/challenges.html', 'site/challenges.html']:
    full = os.path.join(r'd:\mir-tankov-bot', path)
    with open(full, 'rb') as f:
        data = f.read()
    data = data.replace(b'global-challenge-tab.js?v=50', b'global-challenge-tab.js?v=51')
    with open(full, 'wb') as f:
        f.write(data)
    print('Updated', path, 'size=', len(data))
