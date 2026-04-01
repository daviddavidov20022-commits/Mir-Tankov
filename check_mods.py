import os, glob

game = r"D:\Танки\World_of_Tanks_RU"

# 1. Check python.log
log = os.path.join(game, "python.log")
if os.path.exists(log):
    print(f"=== python.log (last 80 lines) ===")
    lines = open(log, 'r', encoding='utf-8', errors='ignore').readlines()
    for l in lines[-80:]:
        print(l.rstrip())
else:
    print("NO python.log found!")
    for f in os.listdir(game):
        if f.endswith('.log'):
            print(f"  Found log: {f}")

# 2. Check what mods folder structure looks like
mods_base = os.path.join(game, "res_mods", "1.41.0.0")
print(f"\n=== Mods structure under {mods_base} ===")
for root, dirs, files in os.walk(mods_base):
    for f in files:
        fp = os.path.join(root, f)
        rel = os.path.relpath(fp, mods_base)
        print(f"  {rel}  ({os.path.getsize(fp)} bytes)")

# 3. Check what other mods exist (maybe different folder)
mods2 = os.path.join(game, "mods")
if os.path.exists(mods2):
    print(f"\n=== mods/ folder ===")
    for root, dirs, files in os.walk(mods2):
        for f in files:
            fp = os.path.join(root, f)
            rel = os.path.relpath(fp, mods2)
            sz = os.path.getsize(fp)
            if sz > 0:
                print(f"  {rel}  ({sz} bytes)")
