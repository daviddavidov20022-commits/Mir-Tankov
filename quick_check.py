import json, os

rj = r'D:\Танки\World_of_Tanks_RU\radar_results.json'
if os.path.exists(rj):
    data = json.load(open(rj, 'r'))
    print('=== radar_results.json ===')
    print('Timestamp:', data.get('timestamp'))
    players = data.get('players', [])
    print('Players:', len(players))
    for p in players[:5]:
        print('  ', p)
    has_dmg = any(p.get('damage', 0) > 0 for p in players)
    print('Has damage > 0:', has_dmg)
else:
    print('NO FILE')

log = r'D:\Танки\World_of_Tanks_RU\python.log'
lines = open(log, 'r', errors='ignore').readlines()
print('\n=== Radar log lines ===')
for l in lines:
    if 'radar' in l.lower() or 'RadarHelper' in l:
        print(l.rstrip())
print('\n=== Errors near radar ===')
for i, l in enumerate(lines):
    if 'radar' in l.lower():
        for j in range(max(0,i-1), min(len(lines),i+3)):
            if 'error' in lines[j].lower() or 'warning' in lines[j].lower() or 'exception' in lines[j].lower() or 'traceback' in lines[j].lower():
                print(f'{j}: {lines[j].rstrip()}')
