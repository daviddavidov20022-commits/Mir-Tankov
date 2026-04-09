import shutil, os

src = r'd:\mir-tankov-bot\game_assets'
dst = r'd:\mir-tankov-bot\site\obs\assets'

for d in ['currency', 'items', 'lootboxes']:
    os.makedirs(os.path.join(dst, d), exist_ok=True)

# Currency
for f in ['goldIcon.png', 'creditsIcon.png', 'freeXP.png', 'gold.png', 'credits.png']:
    s = os.path.join(src, 'currency', f)
    if os.path.exists(s):
        shutil.copy2(s, os.path.join(dst, 'currency', f))
        print('OK:', f)

# Items
src_items = os.path.join(src, 'items')
c = 0
for f in os.listdir(src_items):
    shutil.copy2(os.path.join(src_items, f), os.path.join(dst, 'items', f))
    c += 1
print(f'items: {c}')

# Lootboxes
src_lb = os.path.join(src, 'lootboxes')
c = 0
for f in os.listdir(src_lb):
    shutil.copy2(os.path.join(src_lb, f), os.path.join(dst, 'lootboxes', f))
    c += 1
print(f'lootboxes: {c}')

print('DONE')
