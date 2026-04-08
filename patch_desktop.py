import glob, re

files = glob.glob('webapp/*.html')
count = 0

for f in files:
    with open(f, 'r', encoding='utf-8') as fh:
        content = fh.read()
    
    changed = False
    
    # Add desktop.css if not present
    if 'desktop.css' not in content:
        # Insert after the last CSS link
        content = re.sub(
            r'(<link[^>]*href="css/style\.css"[^>]*>)',
            r'\1\n    <link rel="stylesheet" href="css/desktop.css">',
            content,
            count=1
        )
        # If style.css not found, try landing.css
        if 'desktop.css' not in content:
            content = re.sub(
                r'(<link[^>]*href="css/landing\.css"[^>]*>)',
                r'\1\n    <link rel="stylesheet" href="css/desktop.css">',
                content,
                count=1
            )
        changed = True
    
    # Add desktop-nav.js if not present — BEFORE </body>
    if 'desktop-nav.js' not in content:
        content = content.replace(
            '</body>',
            '<script src="js/desktop-nav.js"></script>\n</body>'
        )
        changed = True
    
    if changed:
        with open(f, 'w', encoding='utf-8') as fh:
            fh.write(content)
        count += 1
        print(f"Patched: {f}")

# Also clean up the old broken responsive CSS from style.css
with open('webapp/css/style.css', 'r', encoding='utf-8') as f:
    css = f.read()

css = re.sub(
    r'/\* =+\s*\n\s*DESKTOP ADAPTIVE.*',
    '',
    css,
    flags=re.DOTALL
)
css = re.sub(
    r'/\* =+\s*\n\s*DESKTOP RESPONSIVE OVERHAUL.*',
    '',
    css,
    flags=re.DOTALL
)

with open('webapp/css/style.css', 'w', encoding='utf-8') as f:
    f.write(css.rstrip() + '\n')

print(f"\nDone. Patched {count} HTML files.")
print("Cleaned old responsive CSS from style.css.")
