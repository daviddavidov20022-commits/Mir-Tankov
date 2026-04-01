import zipfile, os, sys

# Check structure of existing .mtmod files
mods_dir = r"D:\Танки\World_of_Tanks_RU\mods\1.41.0.0"

# Pick the smallest mtmod for analysis
mtmods = []
for root, dirs, files in os.walk(mods_dir):
    for f in files:
        if f.endswith('.mtmod'):
            fp = os.path.join(root, f)
            mtmods.append((f, fp, os.path.getsize(fp)))

mtmods.sort(key=lambda x: x[2])
print("=== All .mtmod files (sorted by size) ===")
for name, fp, sz in mtmods:
    print(f"  {name:60s} {sz:>10,} bytes")

# Analyze the smallest ones
for name, fp, sz in mtmods[:3]:
    print(f"\n=== INSIDE: {name} ({sz:,} bytes) ===")
    try:
        with zipfile.ZipFile(fp, 'r') as z:
            for info in z.infolist():
                print(f"  {info.filename:50s} {info.file_size:>8,} bytes")
                # Print content of small text files
                if info.file_size < 5000 and (info.filename.endswith('.xml') or info.filename.endswith('.json') or info.filename.endswith('.py')):
                    content = z.read(info.filename).decode('utf-8', errors='ignore')
                    print(f"  --- CONTENT ---")
                    for line in content.split('\n')[:30]:
                        print(f"    {line}")
                    print(f"  --- END ---")
    except Exception as e:
        print(f"  ERROR: {e}")

# Also check the battleresultsreplays mod specifically
print("\n\n=== BATTLERESULTS REPLAY MOD ===")
for name, fp, sz in mtmods:
    if 'battleresultsreplay' in name.lower():
        with zipfile.ZipFile(fp, 'r') as z:
            for info in z.infolist():
                print(f"  {info.filename:50s} {info.file_size:>8,} bytes")
                content = z.read(info.filename)
                if info.file_size < 10000:
                    try:
                        txt = content.decode('utf-8', errors='ignore')
                        print(f"  --- CONTENT ---")
                        for line in txt.split('\n')[:50]:
                            print(f"    {line}")
                        print(f"  --- END ---")
                    except: pass
