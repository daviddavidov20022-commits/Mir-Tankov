import codecs

path = r'd:\mir-tankov-bot\webapp\js\global-challenge-tab.js'

with codecs.open(path, 'r', encoding='utf-16le') as f:
    text = f.read()

# Fix loader bug
old_loader = """        if (_gcIsFirstLoad) {
            _gcIsFirstLoad = false;
            document.getElementById('gcLoading').style.display = 'none';
            gcShowEmpty();
        }"""
new_loader = """        _gcIsFirstLoad = false;
        const _ldr = document.getElementById('gcLoading');
        if (_ldr) _ldr.style.display = 'none';
        gcShowEmpty();"""

if old_loader in text:
    text = text.replace(old_loader, new_loader)
else:
    print("Warning: old_loader not found. Trying regex.")
    import re
    text = re.sub(r'if \(_gcIsFirstLoad\) \{(.*?)\} \/\/', r'_gcIsFirstLoad = false; document.getElementById("gcLoading").style.display = "none"; gcShowEmpty(); //', text, flags=re.DOTALL)

# Fix isAdmin ReferenceErrors
text = text.replace("if (isAdmin) {", "const isAdminNow_chk = window.isAdmin || (typeof isAdmin !== 'undefined' && isAdmin);\n    if (isAdminNow_chk) {")

with codecs.open(path, 'w', encoding='utf-16le') as f:
    f.write(text)

print("Done")
