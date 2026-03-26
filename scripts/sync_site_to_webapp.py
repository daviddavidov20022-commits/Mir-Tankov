"""
Синхронизация site/ → webapp/
Копирует изменённые файлы и исправляет ссылки на Telegram SDK.
Запуск: python scripts/sync_site_to_webapp.py
"""
import shutil, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, 'site')
WEBAPP = os.path.join(ROOT, 'webapp')

# ==========================================
# Файлы для прямого копирования (без изменений)
# ⚠️ НЕ включать stream.js и stream.css — webapp имеет свои версии!
# ==========================================
DIRECT_COPY = [
    'css/military-theme.css',
    'css/global-challenge.css',
    'css/stats.css',
    'css/style.css',
    'js/global-challenge-tab.js',
    'js/gc-obs-links.js',
    'js/stats-page.js',
    'js/app.js',
]

# ==========================================
# HTML файлы (нужна замена SDK)
# ⚠️ НЕ включать player.html — webapp имеет свою версию (preview вместо iframe)!
# ==========================================
HTML_FILES = [
    'design-editor.html',
    'gc-widget.html',
    'global-challenge.html',
    'challenges.html',
    'stats.html',
    'index.html',
    'profile.html',
]

# ==========================================
# Папки картинок (полная копия)
# ==========================================
IMAGE_DIRS = [
    'img/military',
    'img/icons',
]

def fix_html_for_telegram(html_content):
    """Заменяет site-page.js на telegram-web-app.js и убирает site.css"""
    # Заменяем mock SDK на настоящий Telegram SDK
    html_content = html_content.replace(
        '<script src="js/site-page.js"></script>',
        '<script src="https://telegram.org/js/telegram-web-app.js"></script>'
    )
    # Убираем site.css (он только для standalone сайта)
    html_content = html_content.replace(
        '    <link rel="stylesheet" href="css/site.css">\n', ''
    )
    html_content = html_content.replace(
        '    <link rel="stylesheet" href="css/site.css">\r\n', ''
    )
    return html_content

def sync():
    copied = 0
    skipped = 0
    
    print("🔄 Синхронизация site/ → webapp/")
    print("=" * 50)
    
    # 1. Прямое копирование JS/CSS
    for rel_path in DIRECT_COPY:
        src = os.path.join(SITE, rel_path)
        dst = os.path.join(WEBAPP, rel_path)
        if not os.path.exists(src):
            print(f"  ⏭ {rel_path} — не найден в site/")
            skipped += 1
            continue
        # Проверяем нужно ли обновлять
        if os.path.exists(dst):
            src_mtime = os.path.getmtime(src)
            dst_mtime = os.path.getmtime(dst)
            if src_mtime <= dst_mtime:
                print(f"  ⏭ {rel_path} — без изменений")
                skipped += 1
                continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
        print(f"  ✅ {rel_path}")
        copied += 1
    
    # 2. HTML файлы (с заменой SDK)
    for rel_path in HTML_FILES:
        src = os.path.join(SITE, rel_path)
        dst = os.path.join(WEBAPP, rel_path)
        if not os.path.exists(src):
            print(f"  ⏭ {rel_path} — не найден")
            skipped += 1
            continue
        with open(src, 'r', encoding='utf-8') as f:
            content = f.read()
        fixed = fix_html_for_telegram(content)
        # Проверяем изменилось ли содержимое
        if os.path.exists(dst):
            with open(dst, 'r', encoding='utf-8') as f:
                existing = f.read()
            if existing == fixed:
                print(f"  ⏭ {rel_path} — без изменений")
                skipped += 1
                continue
        with open(dst, 'w', encoding='utf-8') as f:
            f.write(fixed)
        print(f"  ✅ {rel_path} (+ SDK fix)")
        copied += 1
    
    # 3. Картинки
    for img_dir in IMAGE_DIRS:
        src_dir = os.path.join(SITE, img_dir)
        dst_dir = os.path.join(WEBAPP, img_dir)
        if not os.path.isdir(src_dir):
            continue
        os.makedirs(dst_dir, exist_ok=True)
        for fname in os.listdir(src_dir):
            src = os.path.join(src_dir, fname)
            dst = os.path.join(dst_dir, fname)
            if not os.path.isfile(src):
                continue
            if os.path.exists(dst) and os.path.getmtime(src) <= os.path.getmtime(dst):
                skipped += 1
                continue
            shutil.copy2(src, dst)
            print(f"  🖼 {img_dir}/{fname}")
            copied += 1
    
    print("=" * 50)
    print(f"✅ Скопировано: {copied} | ⏭ Пропущено: {skipped}")
    
    if copied > 0:
        print("\n📌 Не забудь: git add -A && git commit && git push")
    else:
        print("\n✅ Всё уже актуально!")
    
    return copied

if __name__ == '__main__':
    sync()
