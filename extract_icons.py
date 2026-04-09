"""
Извлечение игровых иконок для виджета контейнеров
Источники:
1. gui_lootboxes.pkg — иконки контейнеров
2. gui-part1.pkg — иконки валют (золото, кредиты, опыт)
3. Скачивание из CDN — танки
"""
import zipfile, os, sys, time

GAME_DIR = r"D:\Танки\World_of_Tanks_RU\res\packages"
OUTPUT_DIR = r"d:\mir-tankov-bot\game_assets"

# Создаём директории
for subdir in ["lootboxes", "currency", "tanks", "items", "misc"]:
    os.makedirs(os.path.join(OUTPUT_DIR, subdir), exist_ok=True)

# ================================================================
# 1. Извлекаем иконки лутбоксов (маленький файл, 184 МБ)
# ================================================================
print("=== Извлечение иконок лутбоксов ===")
lootbox_pkg = os.path.join(GAME_DIR, "gui_lootboxes.pkg")
count = 0

with zipfile.ZipFile(lootbox_pkg, 'r') as z:
    for name in z.namelist():
        if not name.endswith('.png'):
            continue
        # Сохраняем только нужные иконки
        if any(k in name for k in ['lootboxes/160x106', 'lootboxes/48x32', 'lootboxes/80x', 'icon_', 'reward']):
            # Плоское имя файла
            flat_name = name.split('/')[-1]
            dest = os.path.join(OUTPUT_DIR, "lootboxes", flat_name)
            if not os.path.exists(dest):
                data = z.read(name)
                with open(dest, 'wb') as f:
                    f.write(data)
                count += 1
    print(f"  Лутбоксы: извлечено {count} файлов")


# ================================================================
# 2. Ищем иконки валют в gui-part1.pkg (БОЛЬШОЙ файл — читаем только индекс)
# ================================================================
print("\n=== Поиск иконок валют в gui-part1.pkg ===")
gui_pkg = os.path.join(GAME_DIR, "gui-part1.pkg")

# Ключевые слова для иконок из виджета на скрине
WANTED_PATTERNS = [
    'gold', 'credit', 'freeXP', 'free_xp', 'freexp',
    'premium_time', 'premiumPlus', 'premium_plus',
    'crystal', 'blueprint', 'equipment',
    'crew_book', 'crewBook', 'personal_reserve',
    'booster', 'slot', 'garage_slot',
    'customization', 'style', 'camo',
    'demount_kit', 'demountKit',
    'currency', 'icon_res'
]

print("  Сканируем индекс (может занять 2-3 минуты)...")
t0 = time.time()

try:
    with zipfile.ZipFile(gui_pkg, 'r') as z:
        all_names = z.namelist()
        print(f"  Индекс прочитан за {time.time()-t0:.1f}с. Файлов: {len(all_names)}")
        
        # Фильтруем только PNG с нужными ключевыми словами
        matches = []
        for name in all_names:
            if not name.endswith('.png'):
                continue
            name_lower = name.lower()
            if any(pat in name_lower for pat in WANTED_PATTERNS):
                matches.append(name)
        
        print(f"  Найдено совпадений: {len(matches)}")
        
        # Извлекаем
        extracted = 0
        for name in matches:
            flat_name = name.split('/')[-1]
            # Определяем подпапку
            subdir = "currency"
            if 'crew' in name.lower() or 'book' in name.lower():
                subdir = "items"
            elif 'equipment' in name.lower() or 'demount' in name.lower():
                subdir = "items"
            elif 'booster' in name.lower() or 'reserve' in name.lower():
                subdir = "items"
            elif 'blueprint' in name.lower():
                subdir = "items"
            elif 'style' in name.lower() or 'camo' in name.lower() or 'custom' in name.lower():
                subdir = "misc"
            
            dest = os.path.join(OUTPUT_DIR, subdir, flat_name)
            if not os.path.exists(dest):
                try:
                    data = z.read(name)
                    with open(dest, 'wb') as f:
                        f.write(data)
                    extracted += 1
                except:
                    pass
        
        print(f"  Валюты/предметы: извлечено {extracted} файлов")

except Exception as e:
    print(f"  Ошибка при чтении gui-part1.pkg: {e}")
    print("  Пропускаем — скачаем иконки из CDN")


# ================================================================
# 3. Ищем иконки в gui-part2.pkg тоже
# ================================================================
print("\n=== Поиск в gui-part2.pkg ===")
gui_pkg2 = os.path.join(GAME_DIR, "gui-part2.pkg")

try:
    with zipfile.ZipFile(gui_pkg2, 'r') as z:
        all_names = z.namelist()
        print(f"  Индекс прочитан. Файлов: {len(all_names)}")
        
        matches = []
        for name in all_names:
            if not name.endswith('.png'):
                continue
            name_lower = name.lower()
            if any(pat in name_lower for pat in WANTED_PATTERNS):
                matches.append(name)
        
        print(f"  Найдено: {len(matches)}")
        
        extracted = 0
        for name in matches:
            flat_name = name.split('/')[-1]
            subdir = "currency"
            if any(k in name.lower() for k in ['crew', 'book', 'equipment', 'demount', 'booster', 'reserve', 'blueprint']):
                subdir = "items"
            elif any(k in name.lower() for k in ['style', 'camo', 'custom']):
                subdir = "misc"
            
            dest = os.path.join(OUTPUT_DIR, subdir, flat_name)
            if not os.path.exists(dest):
                try:
                    data = z.read(name)
                    with open(dest, 'wb') as f:
                        f.write(data)
                    extracted += 1
                except:
                    pass
        
        print(f"  Извлечено: {extracted}")

except Exception as e:
    print(f"  Ошибка: {e}")


# ================================================================
# ИТОГ
# ================================================================
print("\n=== ИТОГ ===")
for subdir in ["lootboxes", "currency", "items", "misc", "tanks"]:
    path = os.path.join(OUTPUT_DIR, subdir)
    files = os.listdir(path) if os.path.exists(path) else []
    print(f"  {subdir}/: {len(files)} файлов")

print(f"\nВсе иконки в: {OUTPUT_DIR}")
