import struct, json, os, sys

f = r"D:\Танки\World_of_Tanks_RU\replays\replay_last_battle.mtreplay"
print(f"File: {f}")
print(f"Exists: {os.path.exists(f)}")
print(f"Size: {os.path.getsize(f)} bytes")

data = open(f, 'rb').read()

# First 20 bytes hex
print(f"\nFirst 20 bytes hex: {data[:20].hex()}")

# Magic number
magic = struct.unpack('<I', data[0:4])[0]
print(f"Magic: {magic} (0x{magic:08x})")

# Block count
bc = struct.unpack('<I', data[4:8])[0]
print(f"Block count: {bc}")

offset = 8
for i in range(min(bc, 5)):  # Max 5 blocks
    if offset + 4 > len(data):
        print(f"\nBlock {i+1}: OUT OF DATA at offset {offset}")
        break
    
    b_size = struct.unpack('<I', data[offset:offset+4])[0]
    print(f"\nBlock {i+1}: size={b_size}, offset={offset+4}")
    offset += 4
    
    if offset + b_size > len(data):
        print(f"  Block data TRUNCATED (need {b_size}, have {len(data)-offset})")
        break
    
    raw = data[offset:offset+b_size]
    offset += b_size
    
    try:
        text = raw.decode('utf-8', errors='ignore')
        obj = json.loads(text)
        
        if isinstance(obj, list):
            print(f"  Type: LIST, length={len(obj)}")
            for j, item in enumerate(obj[:3]):
                if isinstance(item, dict):
                    keys = list(item.keys())[:10]
                    print(f"  [{j}] dict keys: {keys}")
                    if "vehicles" in item:
                        vehs = item["vehicles"]
                        if isinstance(vehs, dict):
                            first_key = list(vehs.keys())[0] if vehs else None
                            if first_key:
                                first_val = vehs[first_key]
                                if isinstance(first_val, list):
                                    print(f"      vehicles[{first_key}] = list, first item keys: {list(first_val[0].keys())[:15]}")
                                elif isinstance(first_val, dict):
                                    print(f"      vehicles[{first_key}] = dict keys: {list(first_val.keys())[:15]}")
                                    if "damageDealt" in first_val:
                                        print(f"      >>> FOUND damageDealt = {first_val['damageDealt']}")
                                    if "name" in first_val:
                                        print(f"      >>> name = {first_val['name']}")
                else:
                    print(f"  [{j}] type={type(item).__name__}")
        elif isinstance(obj, dict):
            keys = list(obj.keys())[:15]
            print(f"  Type: DICT, keys: {keys}")
            if "vehicles" in obj:
                vehs = obj["vehicles"]
                if isinstance(vehs, dict):
                    first_key = list(vehs.keys())[0] if vehs else None
                    if first_key:
                        first_val = vehs[first_key]
                        if isinstance(first_val, list):
                            print(f"      vehicles[{first_key}] = list, first item keys: {list(first_val[0].keys())[:15]}")
                            if "damageDealt" in first_val[0]:
                                print(f"      >>> FOUND damageDealt = {first_val[0]['damageDealt']}")
                        elif isinstance(first_val, dict):
                            print(f"      vehicles[{first_key}] = dict keys: {list(first_val.keys())[:15]}")
                            if "damageDealt" in first_val:
                                print(f"      >>> FOUND damageDealt = {first_val['damageDealt']}")
                            if "name" in first_val:
                                print(f"      >>> name = {first_val['name']}")
    except json.JSONDecodeError as e:
        print(f"  NOT valid JSON: {e}")
        print(f"  First 100 chars: {raw[:100]}")

# Also search for damageDealt anywhere in file
pos = data.find(b'damageDealt')
if pos >= 0:
    print(f"\n=== 'damageDealt' found at byte offset {pos} ===")
    context = data[max(0,pos-50):pos+100].decode('utf-8', errors='ignore')
    print(f"Context: ...{context}...")
else:
    print(f"\n=== 'damageDealt' NOT FOUND anywhere in file ===")
