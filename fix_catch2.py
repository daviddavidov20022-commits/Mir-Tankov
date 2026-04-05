"""Fix the catch block in gcLoadChallenge using the actual line endings found in file"""
import os

for path in [
    r'd:\mir-tankov-bot\webapp\js\global-challenge-tab.js',
    r'd:\mir-tankov-bot\site\js\global-challenge-tab.js',
]:
    with open(path, 'rb') as f:
        data = f.read()

    # Find the actual catch block by searching for the key string
    marker = b"console.error('GC load error:', e);"
    idx = data.find(marker)
    if idx < 0:
        print(f'ERROR: marker not found in {path}')
        continue

    # Find start of catch block (search backwards for "} catch (e) {")
    catch_start_marker = b'} catch (e) {'
    catch_start = data.rfind(catch_start_marker, 0, idx)
    if catch_start < 0:
        print(f'ERROR: catch start not found in {path}')
        continue

    # Find end of catch block (search for "} finally {")
    finally_marker = b'} finally {'
    finally_pos = data.find(finally_marker, idx)
    if finally_pos < 0:
        print(f'ERROR: finally not found in {path}')
        continue

    # Extract the old catch block
    old_block = data[catch_start:finally_pos]
    print(f'Found catch block at {catch_start}-{finally_pos} ({len(old_block)} bytes)')

    # Detect actual line ending
    if b'\r\r\n' in old_block:
        nl = b'\r\r\n'
        print('  Line ending: \\r\\r\\n (double CR)')
    elif b'\r\n' in old_block:
        nl = b'\r\n'
        print('  Line ending: \\r\\n (CRLF)')
    else:
        nl = b'\n'
        print('  Line ending: \\n (LF)')

    # Build replacement catch block using same line endings
    new_block = (
        b'} catch (e) {' + nl +
        nl +
        b"        console.error('GC load error:', e);" + nl +
        nl +
        b'        _gcIsFirstLoad = false;' + nl +
        nl +
        b"        var _ldr = document.getElementById('gcLoading');" + nl +
        nl +
        b"        if (_ldr) _ldr.style.display = 'none';" + nl +
        nl +
        b'        try { gcShowEmpty(); } catch(e2) {}' + nl +
        nl +
        b'        try {' + nl +
        nl +
        b"            var _ap = document.getElementById('gcAdminPanel');" + nl +
        nl +
        b"            if (_ap) _ap.style.display = '';" + nl +
        nl +
        b'        } catch(e3) {}' + nl +
        nl +
        b'    '
    )

    data = data[:catch_start] + new_block + data[finally_pos:]

    with open(path, 'wb') as f:
        f.write(data)
    print(f'PATCHED: {path} (new size: {len(data)})')
