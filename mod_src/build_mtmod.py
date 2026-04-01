import py_compile
import zipfile
import os

src = r"d:\mir-tankov-bot\mod_src\mod_radar_helper.py"
pyc = r"d:\mir-tankov-bot\mod_src\mod_radar_helper.pyc"
py_compile.compile(src, pyc, doraise=True)
print "Compiled OK"

mtmod = r"d:\mir-tankov-bot\mod_src\radar_helper_1.0.0.mtmod"

meta_xml = """<root>
    <id>mir.tankov.radar.helper</id>
    <version>1.0.0</version>
    <name>RadarHelper</name>
    <description>Sends battle results to Radar app</description>
</root>"""

# ZIP_STORED = no compression! Game requires this!
with zipfile.ZipFile(mtmod, 'w', zipfile.ZIP_STORED) as z:
    z.writestr("meta.xml", meta_xml)
    z.writestr("res/", "")
    z.writestr("res/scripts/", "")
    z.writestr("res/scripts/client/", "")
    z.writestr("res/scripts/client/gui/", "")
    z.writestr("res/scripts/client/gui/mods/", "")
    z.write(pyc, "res/scripts/client/gui/mods/mod_radar_helper.pyc")

print "Built:", mtmod, "(%d bytes)" % os.path.getsize(mtmod)
