import sys, re

path = 'webapp/js/global-challenge-tab.js'

try:
    with open(path, 'rb') as f:
        raw = f.read()
    content = raw.decode('windows-1251')
except Exception as e:
    content = raw.decode('utf-8', errors='ignore')

new = '''                <div class="gc-lb-item ${cls}" style="cursor:pointer; position:relative; align-items:center" onclick="gcShowPlayerDetail(${p.telegram_id}, '${(p.nickname || '').replace(/'/g, \\\\"\\\\'\\\\")}', true, ${ch.id})">
                    <div class="gc-lb-rank ${rankCls}">${medal}</div>
                    <div class="gc-lb-info" style="flex:1">
                        <div class="gc-lb-name">${p.nickname}</div>
                        <div style="font-size:0.5rem; opacity:0.6; margin-top:2px">🔍 подробно</div>
                    </div>
                    <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px">
                        <div class="gc-lb-value" style="text-align:right">${gcFormatLbValue(p, ch)}</div>
                        <div style="font-size:0.6rem; color:#8a94a6; background:rgba(0,0,0,0.3); padding:3px 8px; border-radius:8px; border:1px solid rgba(255,255,255,0.06)">⚔️ ${p.battles_played || 0} боёв</div>
                    </div>
                </div>'''

content = re.sub(r'<div class="gc-lb-item \$\{cls\}".*?</div>\s*</div>\s*<div class="gc-lb-value" style="text-align:right">.*?</div>\s*</div>', new, content, flags=re.DOTALL)

with open(path, 'w', encoding='windows-1251', errors='ignore') as f:
    f.write(content)
print('Done!')
