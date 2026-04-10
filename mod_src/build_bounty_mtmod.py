import py_compile
import zipfile
import os

src = r"d:\mir-tankov-bot\mod_src\mod_bounty_hunter.py"
pyc = r"d:\mir-tankov-bot\mod_src\mod_bounty_hunter.pyc"
py_compile.compile(src, pyc, doraise=True)
print("Compiled OK")

mtmod = r"d:\mir-tankov-bot\mod_src\bounty_hunter_1.0.0.mtmod"

meta_xml = """<root>
    <id>mir.tankov.bounty.hunter</id>
    <version>1.1.0</version>
    <name>BountyHunter</name>
    <description>Tracks damage dealt to streamer for bounty system</description>
</root>"""

with zipfile.ZipFile(mtmod, 'w', zipfile.ZIP_STORED) as z:
    z.writestr("meta.xml", meta_xml)
    z.writestr("res/", "")
    z.writestr("res/scripts/", "")
    z.writestr("res/scripts/client/", "")
    z.writestr("res/scripts/client/gui/", "")
    z.writestr("res/scripts/client/gui/mods/", "")
    z.write(pyc, "res/scripts/client/gui/mods/mod_bounty_hunter.pyc")

print("Built: %s (%d bytes)" % (mtmod, os.path.getsize(mtmod)))
