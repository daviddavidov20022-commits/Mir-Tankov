# -*- coding: utf-8 -*-
"""
Радар-Оверлей v3 — ЛЁГКАЯ ВЕРСИЯ (без pywebview!)
Только HTTP-сервер + синхронизация данных.
UI открывается в Chrome --app (мгновенно, без Chromium overhead).
"""
import os
import sys
import json
import threading
import http.server
import socketserver
import shutil
import subprocess
import time

# ============================================================
# PATHS
# ============================================================
def get_base_dir():
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))

BASE_DIR = get_base_dir()
SITE_DIR = os.path.join(BASE_DIR, 'site')
CONFIG_FILE = os.path.join(BASE_DIR, 'radar_config.json')
PORT = 8090

def find_game_folder():
    """Быстрый поиск — только конфиг + типичные пути (без glob по дискам!)"""
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            path = cfg.get('game_dir', '')
            if path and os.path.isdir(path):
                return path
        except:
            pass
    
    for p in [
        r'D:\Танки\World_of_Tanks_RU',
        r'C:\Games\World_of_Tanks_RU',
        r'D:\Games\World_of_Tanks_RU',
    ]:
        if os.path.isdir(p):
            return p
    return None

def save_config(game_dir):
    try:
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump({'game_dir': game_dir}, f, ensure_ascii=False)
    except:
        pass

# ============================================================
# HTTP SERVER (с CORS, без логов)
# ============================================================
class QuietCORSHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass
    
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store')
        super().end_headers()

def start_http_server():
    os.chdir(SITE_DIR)
    httpd = socketserver.TCPServer(("", PORT), QuietCORSHandler)
    httpd.serve_forever()

def is_port_busy(port):
    """Проверяем, занят ли порт"""
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

# ============================================================
# SYNC RADAR DATA (из игры → в site/obs/)
# ============================================================
def sync_radar_loop(radar_json_path):
    obs_copy = os.path.join(SITE_DIR, 'obs', 'radar_results_overlay.json')
    os.makedirs(os.path.dirname(obs_copy), exist_ok=True)
    last_content = None
    last_mtime = 0
    
    while True:
        try:
            if os.path.exists(radar_json_path):
                mtime = os.path.getmtime(radar_json_path)
                # Читаем только если файл РЕАЛЬНО изменился (по mtime)
                if mtime != last_mtime:
                    last_mtime = mtime
                    with open(radar_json_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    # Пишем только если содержимое отличается
                    if content != last_content and content.strip():
                        # Проверяем что JSON валидный (не полузаписанный)
                        try:
                            json.loads(content)
                            last_content = content
                            # Атомарная запись через temp-файл (анти-мерцание!)
                            tmp = obs_copy + '.tmp'
                            with open(tmp, 'w', encoding='utf-8') as f:
                                f.write(content)
                            os.replace(tmp, obs_copy)  # атомарная замена
                        except json.JSONDecodeError:
                            pass  # Файл ещё пишется — пропускаем
        except:
            pass
        time.sleep(1)

# ============================================================
# OPEN CHROME --app (мгновенный запуск)
# ============================================================
def open_chrome_app(url):
    """Открывает Chrome в app-режиме (как отдельное окно без адресной строки)"""
    chrome_paths = [
        r'C:\Program Files\Google\Chrome\Application\chrome.exe',
        r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    ]
    chrome = None
    for p in chrome_paths:
        if os.path.exists(p):
            chrome = p
            break
    
    if chrome:
        subprocess.Popen([
            chrome,
            f'--app={url}',
            '--window-size=420,650',
            '--window-position=50,100',
            '--profile-directory=Profile 112',
            '--disable-extensions',
        ])
        return True
    else:
        # Fallback: открыть через системный браузер
        import webbrowser
        webbrowser.open(url)
        return True

# ============================================================
# MAIN
# ============================================================
if __name__ == '__main__':
    print("=" * 40)
    print("  Radar Overlay v3 — Мир Танков")
    print("  (Chrome App Mode — без лагов)")
    print("=" * 40)
    
    # 1. Найти игру
    game_dir = find_game_folder()
    radar_json = None
    if game_dir:
        print(f"[OK] Игра: {game_dir}")
        save_config(game_dir)
        radar_json = os.path.join(game_dir, 'radar_results.json')
    else:
        print("[!] Папка с игрой не найдена — укажите в radar_config.json")
    
    # 2. Проверяем site/
    if not os.path.isdir(SITE_DIR):
        print(f"[!] Папка site/ не найдена: {SITE_DIR}")
        input("Нажмите Enter...")
        sys.exit(1)
    
    # 3. HTTP-сервер (если порт свободен)
    if not is_port_busy(PORT):
        server_thread = threading.Thread(target=start_http_server, daemon=True)
        server_thread.start()
        print(f"[OK] HTTP-сервер: порт {PORT}")
    else:
        print(f"[OK] Порт {PORT} уже занят — используем существующий сервер")
    
    # 4. Синхронизация данных
    if radar_json:
        sync_thread = threading.Thread(target=sync_radar_loop, args=(radar_json,), daemon=True)
        sync_thread.start()
        print("[OK] Синхронизация данных запущена")
    
    # 5. Даём серверу 0.5 сек на старт и открываем
    time.sleep(0.5)
    
    url = f'http://localhost:{PORT}/radar-overlay.html'
    print(f"[OK] Открываю: {url}")
    open_chrome_app(url)
    
    print("\n[i] Радар работает. Нажмите Ctrl+C для выхода.")
    print("[i] Окно Chrome можно перетаскивать и ресайзить.")
    
    # Держим процесс живым (для сервера и синхронизации)
    try:
        while True:
            time.sleep(10)
    except KeyboardInterrupt:
        print("\n[OK] Радар остановлен.")
