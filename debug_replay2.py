import struct, json, os

f = r"D:\Танки\World_of_Tanks_RU\replays\replay_last_battle.mtreplay"
data = open(f, 'rb').read()
bc = struct.unpack('<I', data[4:8])[0]
b1s = struct.unpack('<I', data[8:12])[0]
after = 12 + b1s
rest_len = len(data) - after
print(f"blocks={bc}, b1_size={b1s}, file_size={len(data)}, data_after_block1={rest_len} bytes")
print(f"Next 100 bytes hex: {data[after:after+100].hex()}")

# Search for any JSON-like structures after block 1
chunk = data[after:]
for marker in [b'"damageDealt"', b'"kills"', b'"xp"', b'"credits"']:
    pos = chunk.find(marker)
    if pos >= 0:
        print(f"\nFOUND {marker} at offset {after+pos}")
        ctx_start = max(0, pos-100)
        ctx_end = min(len(chunk), pos+200)
        print(f"Context: {chunk[ctx_start:ctx_end].decode('utf-8', errors='replace')}")
    else:
        print(f"NOT FOUND: {marker}")
