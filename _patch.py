fp = r'd:\mir-tankov-bot\site\challenges.html'
with open(fp, 'rb') as f:
    content = f.read()

old = b'            </div>\r\n        </div>\r\n\r\n        <!-- ============================== -->\r\n        <!-- TAB: ACTIVE / INCOMING          -->'

new_section = b"""            </div>

            <!-- MY PVP CHALLENGES (inline) -->
            <div class="my-pvp-section" id="myPvpSection" style="margin-top:24px">
                <div class="section-lbl" style="display:flex;justify-content:space-between;align-items:center">
                    <span>\xf0\x9f\x93\x8b \xd0\x9c\xd0\xbe\xd0\xb8 \xd0\xb2\xd1\x8b\xd0\xb7\xd0\xbe\xd0\xb2\xd1\x8b</span>
                    <button onclick="loadMyPvpChallenges()" style="background:none;border:none;color:#C8AA6E;font-size:0.7rem;cursor:pointer;padding:4px 8px">\xf0\x9f\x94\x84</button>
                </div>
                <div id="myPvpList">
                    <div style="text-align:center;color:#5A6577;font-size:0.7rem;padding:16px">\xe2\x8f\xb3 \xd0\x97\xd0\xb0\xd0\xb3\xd1\x80\xd1\x83\xd0\xb7\xd0\xba\xd0\xb0...</div>
                </div>
            </div>
        </div>

        <!-- ============================== -->
        <!-- TAB: ACTIVE / INCOMING          -->""".replace(b'\n', b'\r\n')

if old in content:
    content = content.replace(old, new_section, 1)
    with open(fp, 'wb') as f:
        f.write(content)
    print('OK - patched!')
else:
    print('NOT FOUND')
