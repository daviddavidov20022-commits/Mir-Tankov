import os
import sys
import json
import time
import struct
import threading
import glob
import customtkinter as ctk
from tkinter import filedialog

# --- Настройки внешнего вида (Premium) ---
ctk.set_appearance_mode("dark")  # Тёмная тема
ctk.set_default_color_theme("blue")  # Синие акценты (подходит под стиль Танков)

# --- Пути ---
if getattr(sys, 'frozen', False):
    application_path = os.path.dirname(sys.executable)
else:
    application_path = os.path.dirname(os.path.abspath(__file__))

ENCOUNTERS_FILE = os.path.join(application_path, "encounters.json")
CONFIG_FILE = os.path.join(application_path, "radar_config.json")

def load_json(path, default=None):
    if default is None: default = {}
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return default
    return default

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)

# --- Логика парсинга реплеев ---
def parse_replay(filepath):
    """
    Супер-умный парсер. 
    Игнорирует бинарную структуру заголовков (Lesta там многое поменяла)
    и напрямую ищет первый JSON-блок в сыром файле.
    """
    try:
        if not os.path.exists(filepath) or os.path.getsize(filepath) == 0:
            return None, "Файл пока пустой (0 байт)"
            
        # Читаем первые 200 КБ файла (заголовок боя обычно занимает 15-20 КБ)
        with open(filepath, 'rb') as f:
            data = f.read(1024 * 200)
            
        # Ищем классический старт массива метрик или объекта
        start = data.find(b'[{"')
        if start == -1:
            start = data.find(b'{"')
            
        if start == -1:
            return None, "Не найдено начало JSON-метрик"
            
        # Декодируем как текст игнорируя бинарный "мусор"
        text = data[start:].decode('utf-8', errors='ignore')
        
        # raw_decode автоматически распарсит первый JSON объект/массив, игнорируя остаток
        try:
            obj, _ = json.JSONDecoder().raw_decode(text)
        except Exception as e:
            return None, f"Ошибка JSON: {e}"
            
        players = []
        # Вытаскиваем первого элемента (если это список блоков)
        if isinstance(obj, list) and len(obj) > 0:
            block_info = obj[0]
        else:
            block_info = obj
            
        vehicles = block_info.get("vehicles", {})
        
        for v_id, v_info in vehicles.items():
            name = v_info.get("name")
            if name:
                players.append(name)
                
        if not players:
            return None, "В найденном JSON нет поля 'vehicles'"
            
        return players, "OK"
        
    except Exception as e:
        return None, f"Ошибка чтения файла: {e}"


# --- Графический интерфейс ---
class App(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.title("Радар Игроков — Мир Танков")
        self.geometry("800x600")
        self.minsize(600, 450)
        
        # Настройки сетки (layout)
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(1, weight=1)

        # Базы данных
        self.encounters = load_json(ENCOUNTERS_FILE)
        self.config = load_json(CONFIG_FILE, {"replays_dir": ""})
        
        self.is_monitoring = False
        self.monitor_thread = None
        
        self.create_widgets()
        self.init_radar()

    def create_widgets(self):
        # 1. Левая панель (Настройки и статистика)
        self.sidebar_frame = ctk.CTkFrame(self, width=220, corner_radius=0)
        self.sidebar_frame.grid(row=0, column=0, rowspan=2, sticky="nsew")
        self.sidebar_frame.grid_rowconfigure(4, weight=1)

        self.logo_label = ctk.CTkLabel(self.sidebar_frame, text="🛡 РАДАР", font=ctk.CTkFont(size=24, weight="bold"))
        self.logo_label.grid(row=0, column=0, padx=20, pady=(20, 10))
        
        self.status_label = ctk.CTkLabel(self.sidebar_frame, text="Ожидание...", text_color="gray")
        self.status_label.grid(row=1, column=0, padx=20, pady=5)

        self.btn_select_folder = ctk.CTkButton(self.sidebar_frame, text="Выбрать папку Replays", command=self.select_folder)
        self.btn_select_folder.grid(row=2, column=0, padx=20, pady=10)

        # Статистика встреч
        self.stats_label = ctk.CTkLabel(self.sidebar_frame, text=f"В базе: {len(self.encounters)} игроков", 
                                        font=ctk.CTkFont(size=13, weight="normal"))
        self.stats_label.grid(row=3, column=0, padx=20, pady=10)

        # 2. Основная рабочая зона (Список игроков)
        self.main_frame = ctk.CTkFrame(self, corner_radius=10, fg_color="transparent")
        self.main_frame.grid(row=0, column=1, rowspan=2, sticky="nsew", padx=20, pady=20)
        self.main_frame.grid_rowconfigure(1, weight=1)
        self.main_frame.grid_columnconfigure(0, weight=1)

        self.header_label = ctk.CTkLabel(self.main_frame, text="Список игроков в текущем бою", font=ctk.CTkFont(size=20, weight="bold"))
        self.header_label.grid(row=0, column=0, sticky="w", pady=(0, 10))

        # Текстовое поле (ScrollableFrame для игроков)
        self.players_scroll = ctk.CTkScrollableFrame(self.main_frame, fg_color="#1a1a1a", corner_radius=10)
        self.players_scroll.grid(row=1, column=0, sticky="nsew")

    def log_message(self, text, color="white", bold=False):
        # Добавляем текстовый блок (ярлык) в скролл-область
        weight = "bold" if bold else "normal"
        lbl = ctk.CTkLabel(self.players_scroll, text=text, text_color=color, anchor="w", justify="left",
                           font=ctk.CTkFont(size=14, weight=weight))
        lbl.pack(fill="x", padx=10, pady=2)
        
        # Скролл вниз (хитрость Tkinter)
        self.players_scroll._parent_canvas.yview_moveto(1.0)

    def clear_players_list(self):
        for widget in self.players_scroll.winfo_children():
            widget.destroy()

    def select_folder(self):
        folder = filedialog.askdirectory(title="Выберите папку с реплеями World of Tanks / Мир Танков")
        if folder:
            self.config["replays_dir"] = folder
            save_json(CONFIG_FILE, self.config)
            self.init_radar()

    def init_radar(self):
        replays_dir = self.config.get("replays_dir")
        
        # Попытка автонайти
        if not replays_dir or not os.path.exists(replays_dir):
            paths = [
                r"C:\Games\Lesta\Мир танков\replays",
                r"D:\Games\Lesta\Мир танков\replays",
                r"C:\Games\World_of_Tanks_RU\replays",
                r"D:\Games\World_of_Tanks_RU\replays",
                r"D:\Танки\World_of_Tanks_RU\replays"
            ]
            for p in paths:
                if os.path.exists(p):
                    replays_dir = p
                    self.config["replays_dir"] = replays_dir
                    save_json(CONFIG_FILE, self.config)
                    break

        if not replays_dir or not os.path.exists(replays_dir):
            self.status_label.configure(text="Папка не найдена!", text_color="red")
            self.log_message("ОШИБКА: Папка реплеев не найдена.\nПожалуйста, нажмите 'Выбрать папку Replays'", color="#ff5252")
            return

        self.status_label.configure(text="РАБОТАЕТ (Радар активен)", text_color="#00e676")
        self.clear_players_list()
        self.log_message(f"📍 Отслеживаю реплеи в папке:\n{replays_dir}", color="#bdbdbd")
        self.log_message("\n⏳ Мониторинг активен. Запустите бой в игре...", color="#00bcd4", bold=True)
        
        # Запускаем железный мониторинг
        self.is_monitoring = False
        if self.monitor_thread:
            self.monitor_thread.join(timeout=1.0)
            
        self.is_monitoring = True
        self.monitor_thread = threading.Thread(target=self.poll_replays, args=(replays_dir,), daemon=True)
        self.monitor_thread.start()

    def poll_replays(self, replays_dir):
        """Железный метод отслеживания файлов через постоянный скан (чтобы 100% обходить античиты и баги Windows)"""
        last_mtimes = {}
        processed_times = {} # Защита от спама парсера
        first_scan = True
        
        while self.is_monitoring:
            try:
                # Ищем как старые .wotreplay, так и новые .mtreplay файлы
                files = glob.glob(os.path.join(replays_dir, '*.mtreplay')) + glob.glob(os.path.join(replays_dir, '*.wotreplay'))
                
                for f in files:
                    try:
                        mtime = os.path.getmtime(f)
                    except:
                        continue
                        
                    # Если файл появился первый раз за историю сессии
                    if f not in last_mtimes:
                        last_mtimes[f] = mtime
                        if not first_scan:
                            self.trigger_parsing(f, processed_times)
                    # Если файл был изменён (игра пишет/обновляет)
                    elif mtime > last_mtimes[f]:
                        last_mtimes[f] = mtime
                        self.trigger_parsing(f, processed_times)
                        
                first_scan = False
            except Exception as e:
                pass
            time.sleep(1.0) # Проверяем папку каждую секунду
            
    def trigger_parsing(self, filepath, processed_times):
        # Если файл парсился успешно меньше 30 секунд назад - игнорируем
        last_time = processed_times.get(filepath, 0)
        if time.time() - last_time < 30.0:
            return
            
        self.after(0, self.log_message, f"[Отладка] файл изменен: {os.path.basename(filepath)}", "gray", False)
        
        # Ждем секунду и парсим
        time.sleep(1.5)
        players, debug_msg = parse_replay(filepath)
        
        if players:
            processed_times[filepath] = time.time()
            self.after(0, self._render_new_battle, os.path.basename(filepath), players)
        else:
            self.after(0, self.log_message, f"[Отладка] Провал: {debug_msg}", "red", False)

    def _render_new_battle(self, filename, players):
        self.clear_players_list()
        self.log_message(f"⚔️ БОЙ НАЧАЛСЯ! Игроков загружено: {len(players)}", color="#ffc107", bold=True)
        self.log_message(f"(Файл: {filename})\n", color="gray")

        # Обновляем базу встреч
        current_encounters = {}
        for p in players:
            if p not in self.encounters:
                self.encounters[p] = 0
            # Увеличиваем счетчик (за этот бой)
            self.encounters[p] += 1
            current_encounters[p] = self.encounters[p]

        save_json(ENCOUNTERS_FILE, self.encounters)
        
        self.stats_label.configure(text=f"В базе: {len(self.encounters)} игроков")

        # Выводим сначала "знакомых", потом новых
        sorted_players = sorted(current_encounters.items(), key=lambda x: x[1], reverse=True)
        
        for p, count in sorted_players:
            if count > 1:
                # Если встречали раньше - выводим зеленым и жирным
                self.log_message(f"★ {p} — встречаем {count} раз(а)!", color="#00e676", bold=True)
            else:
                # Новый игрок - обычным
                self.log_message(f"   {p}", color="#ffffff")

    def on_closing(self):
        self.is_monitoring = False
        self.destroy()


if __name__ == "__main__":
    app = App()
    app.protocol("WM_DELETE_WINDOW", app.on_closing)
    app.mainloop()
