"""Fix the catch block in gcLoadChallenge - make loader always hide on error"""
import os

for path in [
    r'd:\mir-tankov-bot\webapp\js\global-challenge-tab.js',
    r'd:\mir-tankov-bot\site\js\global-challenge-tab.js',
]:
    with open(path, 'rb') as f:
        data = f.read()

    # The original catch block (from commit c3edd59):
    old_catch = b"""    } catch (e) {\r
\r
        console.error('GC load error:', e);\r
\r
        if (_gcIsFirstLoad) {\r
\r
            _gcIsFirstLoad = false;\r
\r
            document.getElementById('gcLoading').style.display = 'none';\r
\r
            gcShowEmpty();\r
\r
        }\r
\r
        // \xd0\x94\xd0\xb0\xd0\xb6\xd0\xb5 \xd0\xbf\xd1\x80\xd0\xb8 \xd0\xbe\xd1\x88\xd0\xb8\xd0\xb1\xd0\xba\xd0\xb5 \xe2\x80\x94 \xd0\xbf\xd0\xbe\xd0\xba\xd0\xb0\xd0\xb7\xd1\x8b\xd0\xb2\xd0\xb0\xd0\xb5\xd0\xbc admin panel\r
\r
        if (isAdminNow) {\r
\r
            const adminPanel = document.getElementById('gcAdminPanel');\r
\r
            if (adminPanel) adminPanel.style.display = '';\r
\r
        }\r
\r
    } finally {"""

    # New catch block - always hide loader, safe variable scope
    new_catch = b"""    } catch (e) {\r
\r
        console.error('GC load error:', e);\r
\r
        _gcIsFirstLoad = false;\r
\r
        var _ldr = document.getElementById('gcLoading');\r
\r
        if (_ldr) _ldr.style.display = 'none';\r
\r
        try { gcShowEmpty(); } catch(e2) {}\r
\r
        // \xd0\x94\xd0\xb0\xd0\xb6\xd0\xb5 \xd0\xbf\xd1\x80\xd0\xb8 \xd0\xbe\xd1\x88\xd0\xb8\xd0\xb1\xd0\xba\xd0\xb5 \xe2\x80\x94 \xd0\xbf\xd0\xbe\xd0\xba\xd0\xb0\xd0\xb7\xd1\x8b\xd0\xb2\xd0\xb0\xd0\xb5\xd0\xbc admin panel\r
\r
        try {\r
\r
            var _ap = document.getElementById('gcAdminPanel');\r
\r
            if (_ap) _ap.style.display = '';\r
\r
        } catch(e3) {}\r
\r
    } finally {"""

    if old_catch in data:
        data = data.replace(old_catch, new_catch)
        with open(path, 'wb') as f:
            f.write(data)
        print(f'PATCHED: {path}')
    else:
        print(f'NOT FOUND in {path} - checking...')
        # Try to find the catch block
        idx = data.find(b'console.error(\'GC load error:\', e);')
        if idx >= 0:
            print(f'  Found GC load error at byte {idx}')
            print(f'  Context: {data[idx-50:idx+200]}')
        else:
            print(f'  GC load error string NOT found at all!')
