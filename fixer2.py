import re
import codecs

path = r'd:\mir-tankov-bot\webapp\js\gc_utf8.js'
with codecs.open(path, 'r', encoding='utf-8') as f:
    text = f.read()

# Fix loader using regex
fixed_text = re.sub(
    r'(console\.error\(\'(GC)? load error:\', e\);.*?if\s*\(_gcIsFirstLoad\)\s*\{)(.*?\})', 
    r'\1\n        _gcIsFirstLoad = false;\n        const ldr = document.getElementById("gcLoading");\n        if (ldr) ldr.style.display = "none";\n        gcShowEmpty();',
    text,
    flags=re.DOTALL
)

# Replace 'if (isAdmin) {'
fixed_text = fixed_text.replace("if (isAdmin) {", "const isAdminNow_chk = window.isAdmin || (typeof window.isAdmin !== 'undefined' && window.isAdmin) || (typeof isAdmin !== 'undefined' && isAdmin); if (isAdminNow_chk) {")

with codecs.open(r'd:\mir-tankov-bot\webapp\js\global-challenge-tab.js', 'w', encoding='utf-8') as f:
    f.write(fixed_text)

with codecs.open(r'd:\mir-tankov-bot\site\js\global-challenge-tab.js', 'w', encoding='utf-8') as f:
    f.write(fixed_text)

print("Replacement Complete")
