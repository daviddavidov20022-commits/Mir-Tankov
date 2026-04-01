import os, pickle, json, struct, sys

wot_cache = r"C:\Users\user\AppData\Roaming\Wargaming.net\WorldOfTanks"

# List all files sorted by modification time
files = []
for f in os.listdir(wot_cache):
    fp = os.path.join(wot_cache, f)
    if os.path.isfile(fp):
        files.append((f, os.path.getsize(fp), os.path.getmtime(fp)))

files.sort(key=lambda x: x[2], reverse=True)
print("=== Recent files in WoT cache ===")
for name, sz, mt in files[:15]:
    import datetime
    dt = datetime.datetime.fromtimestamp(mt)
    print(f"  {name:50s} {sz:>10,} bytes  {dt}")

# Try to read newest .dat file with battle results  
for name, sz, mt in files[:5]:
    fp = os.path.join(wot_cache, name)
    if not name.endswith('.dat'):
        continue
    print(f"\n=== Trying to parse: {name} ===")
    try:
        with open(fp, 'rb') as f:
            data = f.read()
        # Try pickle
        try:
            obj = pickle.loads(data)
            print(f"  PICKLE OK! Type: {type(obj)}")
            if isinstance(obj, dict):
                print(f"  Keys: {list(obj.keys())[:10]}")
            elif isinstance(obj, (list, tuple)):
                print(f"  Length: {len(obj)}, first type: {type(obj[0]) if obj else None}")
        except:
            pass
        # Try JSON
        try:
            obj = json.loads(data)
            print(f"  JSON OK! Type: {type(obj)}")
        except:
            pass
        # Check for damageDealt
        if b'damageDealt' in data:
            pos = data.find(b'damageDealt')
            print(f"  FOUND 'damageDealt' at offset {pos}")
            print(f"  Context: {data[max(0,pos-30):pos+60]}")
        # Show first bytes
        print(f"  First 40 bytes hex: {data[:40].hex()}")
    except Exception as e:
        print(f"  Error: {e}")

# Also check hash-named files (those large ones might be battle results cache)
hash_files = [f for f in files if len(f[0]) == 32 and not f[0].endswith('.dat')]
if hash_files:
    print(f"\n=== Hash-named files (possible battle_results): {len(hash_files)} ===")
    newest = hash_files[0]
    fp = os.path.join(wot_cache, newest[0])
    print(f"Checking newest: {newest[0]} ({newest[1]:,} bytes)")
    with open(fp, 'rb') as f:
        data = f.read()
    if b'damageDealt' in data:
        pos = data.find(b'damageDealt')
        print(f"  FOUND 'damageDealt' at offset {pos}!")
    print(f"  First 40 bytes hex: {data[:40].hex()}")
    # Try pickle
    try:
        obj = pickle.loads(data)
        print(f"  PICKLE OK! Type={type(obj)}")
        if isinstance(obj, (list, tuple)) and len(obj) > 0:
            first = obj[0]
            if isinstance(first, dict):
                print(f"  Keys: {list(first.keys())[:10]}")
    except Exception as e:
        print(f"  Not pickle: {e}")
