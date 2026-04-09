# -*- coding: utf-8 -*-
"""
Радар-Оверлей — Portable версия
Автоматически находит папку с игрой, запускает локальный сервер и показывает оверлей.
"""
import os
import sys
import json
import glob
import threading
import http.server
import socketserver
import shutil

try:
    import webview
except ImportError:
    os.system('pip install pywebview')
    import webview

# ============================================================
# PATHS — автоопределение
# ============================================================
def get_base_dir():
    """Папка, где лежит exe или скрипт"""
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))

BASE_DIR = get_base_dir()
SITE_DIR = os.path.join(BASE_DIR, 'site')
CONFIG_FILE = os.path.join(BASE_DIR, 'radar_config.json')

def find_game_folder():
    """Ищет папку World_of_Tanks_RU на всех дисках"""
    # 1. Из конфига
    if os.path.exists(CONFIG_FILE):
        try:
            cfg = json.load(open(CONFIG_FILE, 'r', encoding='utf-8'))
            path = cfg.get('game_dir', '')
            if path and os.path.isdir(path):
                return path
        except:
            pass
    
    # 2. Типичные пути
    common = [
        r'D:\Танки\World_of_Tanks_RU',
        r'C:\Games\World_of_Tanks_RU',
        r'D:\Games\World_of_Tanks_RU',
        r'C:\World_of_Tanks_RU',
        r'D:\World_of_Tanks_RU',
    ]
    for p in common:
        if os.path.isdir(p):
            return p
    
    # 3. Поиск по дискам
    import string
    for drive in string.ascii_uppercase:
        d = drive + ':\\'
        if not os.path.exists(d):
            continue
        # Ищем в корне и 1 уровень вглубь
        for pattern in [
            os.path.join(d, 'World_of_Tanks_RU'),
            os.path.join(d, '*', 'World_of_Tanks_RU'),
            os.path.join(d, 'Games', '*', 'World_of_Tanks_RU'),
        ]:
            matches = glob.glob(pattern)
            for m in matches:
                if os.path.isdir(m) and os.path.exists(os.path.join(m, 'WorldOfTanks.exe')):
                    return m
    
    return None

def find_game_version(game_dir):
    """Находит текущую версию (папка мода)"""
    mods_dir = os.path.join(game_dir, 'mods')
    if not os.path.isdir(mods_dir):
        return None
    versions = [d for d in os.listdir(mods_dir) if os.path.isdir(os.path.join(mods_dir, d)) and d[0].isdigit()]
    if versions:
        versions.sort(reverse=True)
        return versions[0]
    return None

def save_config(game_dir):
    """Сохраняет путь к игре в конфиг"""
    try:
        json.dump({'game_dir': game_dir}, open(CONFIG_FILE, 'w', encoding='utf-8'), ensure_ascii=False)
    except:
        pass

# ============================================================
# LOCAL HTTP SERVER
# ============================================================
def start_http_server(port=8090):
    """Запускает HTTP-сервер для site/"""
    os.chdir(SITE_DIR)
    handler = http.server.SimpleHTTPRequestHandler
    handler.log_message = lambda *a: None  # тихий режим
    try:
        httpd = socketserver.TCPServer(("", port), handler)
        httpd.serve_forever()
    except OSError:
        pass  # Порт уже занят — ОК

# ============================================================
# SYNC RADAR DATA
# ============================================================
RADAR_JSON = None
OBS_COPY = os.path.join(SITE_DIR, 'obs', 'radar_results_overlay.json') if os.path.isdir(SITE_DIR) else None

def sync_radar_loop():
    """Копирует radar_results.json из игры в папку сервера"""
    import time
    while True:
        try:
            if RADAR_JSON and os.path.exists(RADAR_JSON) and OBS_COPY:
                with open(RADAR_JSON, 'r', encoding='utf-8') as src:
                    data = src.read()
                os.makedirs(os.path.dirname(OBS_COPY), exist_ok=True)
                with open(OBS_COPY, 'w', encoding='utf-8') as dst:
                    dst.write(data)
        except:
            pass
        time.sleep(2)

# ============================================================
# INSTALL MOD
# ============================================================
def install_mod(game_dir, version):
    """Копирует .mtmod в папку модов игры"""
    mod_src = os.path.join(BASE_DIR, 'mods', 'radar_helper_1.0.0.mtmod')
    if not os.path.exists(mod_src):
        return False
    mod_dst = os.path.join(game_dir, 'mods', version, 'radar_helper_1.0.0.mtmod')
    try:
        os.makedirs(os.path.dirname(mod_dst), exist_ok=True)
        shutil.copy2(mod_src, mod_dst)
        return True
    except:
        return False

# ============================================================
# PYWEBVIEW API
# ============================================================
window = None

class RadarAPI:
    def __init__(self):
        self._saved_size = (380, 600)
    
    def read_radar_json(self):
        try:
            if RADAR_JSON and os.path.exists(RADAR_JSON):
                with open(RADAR_JSON, 'r', encoding='utf-8') as f:
                    return f.read()
        except:
            pass
        return None
    
    def minimize_window(self):
        global window
        if window:
            self._saved_size = (window.width, window.height)
            window.resize(50, 50)
    
    def restore_window(self):
        global window
        if window:
            w, h = self._saved_size
            window.resize(w, h)
    
    def close(self):
        global window
        if window:
            window.destroy()

# ============================================================
# MAIN
# ============================================================
if __name__ == '__main__':
    print("=" * 40)
    print("  Radar Overlay — Мир Танков")
    print("=" * 40)
    
    # Найти игру
    game_dir = find_game_folder()
    if game_dir:
        print(f"[OK] Игра найдена: {game_dir}")
        save_config(game_dir)
        RADAR_JSON = os.path.join(game_dir, 'radar_results.json')
        
        version = find_game_version(game_dir)
        if version:
            print(f"[OK] Версия игры: {version}")
            # Установка мода при первом запуске
            mod_check = os.path.join(game_dir, 'mods', version, 'radar_helper_1.0.0.mtmod')
            if not os.path.exists(mod_check):
                if install_mod(game_dir, version):
                    print("[OK] Мод установлен!")
                else:
                    print("[!] Мод не найден в пакете — установите вручную")
    else:
        print("[!] Папка с игрой не найдена автоматически.")
        print("[!] Укажите путь в radar_config.json")
    
    # Проверяем наличие site/
    if not os.path.isdir(SITE_DIR):
        print(f"[!] Папка site/ не найдена: {SITE_DIR}")
        input("Нажмите Enter...")
        sys.exit(1)
    
    # Запускаем HTTP-сервер
    server_thread = threading.Thread(target=start_http_server, args=(8090,), daemon=True)
    server_thread.start()
    print("[OK] HTTP-сервер запущен на порту 8090")
    
    # Запускаем синхронизацию
    sync_thread = threading.Thread(target=sync_radar_loop, daemon=True)
    sync_thread.start()
    
    import time
    time.sleep(1)
    
    # Запускаем оверлей
    api = RadarAPI()
    window = webview.create_window(
        title='Мир Танков — Радар',
        url='http://localhost:8090/radar-overlay.html',
        width=450,
        height=650,
        x=50,
        y=100,
        frameless=True,
        on_top=True,
        transparent=False,
        resizable=True,
        min_size=(50, 50),
        js_api=api,
        background_color='#0a0e14'
    )
    
    print("[OK] Оверлей запущен!")
    webview.start(debug=False)
