# -*- coding: utf-8 -*-
import zipfile, marshal, types

fp = r"D:\Танки\World_of_Tanks_RU\mods\1.41.0.0\net.openwg\net.openwg.fix.battleresultscache_1.8.1.mtmod"

with zipfile.ZipFile(fp, 'r') as z:
    pyc = z.read("res/scripts/client/gui/mods/mod_battle_results_cache_fix.pyc")

code = marshal.loads(pyc[8:])

def show(co, depth=0):
    p = "  " * depth
    print p + "=== " + str(co.co_filename) + " ==="
    print p + "Names: " + str(co.co_names)
    for c in co.co_consts:
        if isinstance(c, str) and len(c) > 3 and not c.startswith('\n'):
            print p + "  str: '" + c + "'"
        if isinstance(c, types.CodeType):
            show(c, depth+1)

show(code)

print "\n\n=== REPLAYS FIX ==="
fp2 = r"D:\Танки\World_of_Tanks_RU\mods\1.41.0.0\net.openwg\net.openwg.fix.battleresultsreplays_1.0.5.mtmod"
with zipfile.ZipFile(fp2, 'r') as z:
    pyc2 = z.read("res/scripts/client/gui/mods/mod_battle_results_replays_fix.pyc")
code2 = marshal.loads(pyc2[8:])
show(code2)
