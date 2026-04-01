import struct, marshal, dis, sys

# Check what Python version was used to compile existing .pyc from the battleresults cache mod
import zipfile

fp = r"D:\Танки\World_of_Tanks_RU\mods\1.41.0.0\net.openwg\net.openwg.fix.battleresultscache_1.8.1.mtmod"
with zipfile.ZipFile(fp, 'r') as z:
    pyc_data = z.read("res/scripts/client/gui/mods/mod_battle_results_cache_fix.pyc")
    
print(f"PYC file size: {len(pyc_data)} bytes")
print(f"First 16 bytes hex: {pyc_data[:16].hex()}")

# Magic number determines Python version
magic = struct.unpack('<H', pyc_data[:2])[0]
print(f"Magic number: {magic} (0x{magic:04x})")

# Python magic numbers:
# 3394-3395 = Python 3.8
# 3413 = Python 3.9 
# 3430-3439 = Python 3.10
# 3495 = Python 3.11
# 3531 = Python 3.12
# 2.7 = 62211

magics = {
    62211: "Python 2.7",
    3394: "Python 3.8.0a1", 3401: "Python 3.8",
    3413: "Python 3.9",
    3430: "Python 3.10", 3439: "Python 3.10",
    3495: "Python 3.11",
    3531: "Python 3.12",
}

version_found = magics.get(magic, f"Unknown (magic={magic})")
print(f"Detected Python version: {version_found}")
print(f"Our Python version: {sys.version}")

# Try to unmarshal the code object
try:
    # For Python 3.x .pyc: 4 bytes magic + 4 bytes flags + 8 bytes timestamp/size + code
    code = marshal.loads(pyc_data[16:])
    print(f"\nCode object loaded!")
    print(f"  co_filename: {code.co_filename}")
    print(f"  co_names: {code.co_names[:20]}")
    
    # Get imports
    print(f"\n  Constants (first 15):")
    for c in code.co_consts[:15]:
        if isinstance(c, str):
            print(f"    '{c}'")
except Exception as e:
    print(f"\nCould not unmarshal: {e}")
    
    # Try Python 2.7 format (8 bytes header: 4 magic + 4 timestamp)
    try:
        code = marshal.loads(pyc_data[8:])
        print(f"Python 2.7 format worked!")
        print(f"  co_filename: {code.co_filename}")
    except Exception as e2:
        print(f"  Also failed with 2.7 format: {e2}")
