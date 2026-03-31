import os
import time
import json
import struct
import glob
import sys
from colorama import init, Fore, Style

init(autoreset=True)

# Чтобы сохранение работало рядом с EXE
if getattr(sys, 'frozen', False):
    application_path = os.path.dirname(sys.executable)
else:
    application_path = os.path.dirname(os.path.abspath(__file__))

ENCOUNTERS_FILE = os.path.join(application_path, "encounters.json")

def load_encounters():
    if os.path.exists(ENCOUNTERS_FILE):
        try:
            with open(ENCOUNTERS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            return {}
    return {}

def save_encounters(data):
    with open(ENCOUNTERS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)

def get_default_replays_path():
    paths = [
        r"C:\Games\Lesta\Мир танков\replays",
        r"D:\Games\Lesta\Мир танков\replays",
        r"C:\Games\World_of_Tanks\replays",
        r"D:\Games\World_of_Tanks\replays",
    ]
    for p in paths:
        if os.path.exists(p):
            return p
    return ""

def parse_replay(filepath):
    try:
        with open(filepath, 'rb') as f:
            magic = f.read(4)
            # Replay magic is \x12\x32\x34\x11
            if magic != b'\x12\x32\x34\x11':
                return None
            
            blocks_count = struct.unpack("I", f.read(4))[0]
            if blocks_count > 0:
                block1_size = struct.unpack("I", f.read(4))[0]
                block1_data = f.read(block1_size)
                data = json.loads(block1_data.decode('utf-8'))
                
                players = []
                
                # Обычно игроки лежат в первом блоке внутри массива (или dict) "vehicles"
                if isinstance(data, list) and len(data) > 0:
                    block_info = data[0]
                else:
                    block_info = data
                    
                vehicles = block_info.get("vehicles", {})
                for v_id, v_info in vehicles.items():
                    name = v_info.get("name")
                    if name:
                        players.append(name)

                return players
    except Exception as e:
        # File might be locked by game
        pass
    return None

def main():
    print(Fore.YELLOW + "=============================================")
    print(Fore.YELLOW + "      РАДАР ИГРОКОВ (Мир Танков) v1.0")
    print(Fore.YELLOW + "=============================================")
    print(Fore.WHITE + "Эта программа читает реплеи боев в реальном")
    print(Fore.WHITE + "времени и показывает с кем вы попадаетесь.\n")
    
    replays_dir = get_default_replays_path()
    
    if replays_dir:
        print(Fore.GREEN + f"Автоматически найдена папка реплеев: {replays_dir}")
        ans = input("Использовать эту папку? (Д/Н) [Д]: ").strip().upper()
        if ans == 'Н' or ans == 'N' or ans == 'Y' or ans == 'НЕТ':
            if ans != 'Y':
                replays_dir = input("Введите путь к папке replays вручную:\n> ").strip()
    else:
        replays_dir = input(Fore.CYAN + "Введите путь к папке replays (например C:\\Games\\Lesta\\Мир танков\\replays):\n> ").strip()
    
    if not os.path.isdir(replays_dir):
        print(Fore.RED + "Папка не найдена! перезапустите программу.")
        time.sleep(5)
        return
        
    print(Fore.CYAN + f"\n[ОЖИДАНИЕ] Ждем начало нового боя...")
    
    encounters = load_encounters()
    last_file = None
    
    # Чтобы не обрабатывать старые бои при запуске, запомним самый свежий
    list_of_files = glob.glob(os.path.join(replays_dir, '*.wotreplay'))
    if list_of_files:
        last_file = max(list_of_files, key=os.path.getctime)
    
    while True:
        try:
            list_of_files = glob.glob(os.path.join(replays_dir, '*.wotreplay'))
            if list_of_files:
                latest_file = max(list_of_files, key=os.path.getctime)
                
                if latest_file != last_file:
                    time.sleep(2) # Даем игре время записать заголовок
                    players = parse_replay(latest_file)
                    
                    if players:
                        print(Fore.YELLOW + f"\n[!] БОЙ НАЧАЛСЯ! Игроков найдено: {len(players)}")
                        print(Fore.CYAN + "-" * 40)
                        
                        current_encounters = {}
                        for p in players:
                            if p not in encounters:
                                encounters[p] = 0
                            encounters[p] += 1
                            current_encounters[p] = encounters[p]
                            
                        save_encounters(encounters)
                        
                        # Сортируем: сначала те, с кем виделись чаще
                        sorted_players = sorted(current_encounters.items(), key=lambda x: x[1], reverse=True)
                        
                        for p, count in sorted_players:
                            if count > 1:
                                print(Fore.GREEN + f"★ {p} — встречаем {count} раз(а)!")
                            else:
                                print(Fore.WHITE + f"  {p}")
                                
                        print(Fore.YELLOW + f"Всего в базе: {len(encounters)} уникальных игроков.")
                        print(Fore.CYAN + "-" * 40)
                        print(Fore.WHITE + "Ждем следующий бой...\n")
                        
                    last_file = latest_file
                        
        except Exception as e:
            pass
            
        time.sleep(3)

if __name__ == "__main__":
    main()
