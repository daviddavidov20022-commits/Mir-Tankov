import os, sys, json, time, threading, copy, subprocess
from urllib import request as urlreq
import customtkinter as ctk
from tkinter import filedialog, messagebox

ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")

if getattr(sys, 'frozen', False):
    APP = os.path.dirname(sys.executable)
else:
    APP = os.path.dirname(os.path.abspath(__file__))

# ROOT — корень проекта (папка выше Radar/)
ROOT = os.path.dirname(APP) if os.path.basename(APP) == 'Radar' else APP

CFG_FILE  = os.path.join(APP, "radar_config.json")
DATA_FILE = os.path.join(APP, "radar_data_v7.json")
API_URL   = "https://mir-tankov-production.up.railway.app/api/users/check"
LESTA_API = "https://api.tanki.su/wot"
DEFAULT_APP_ID = "c984faa7dc529f4cb0139505d5e8043c"

BG="#0b0e13"; BG2="#0f1319"; CARD="#141a23"; CARD2="#1a2230"
CARD_A="#0f2818"; CARD_E="#280f0f"; GOLD="#C8AA6E"; GREEN="#4ade80"
BLUE="#60a5fa"; RED="#ef4444"; GRAY="#5a6577"; WHITE="#e2e8f0"
STAR_ON="#f5d36e"; STAR_OFF="#333d4d"; ALLY_CLR="#22c55e"; ENM_CLR="#ef4444"
ORANGE="#f59e0b"; CYAN="#22d3ee"

def load_json(p, d=None):
    if d is None: d = {}
    try:
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f: return json.load(f)
    except: pass
    return copy.deepcopy(d)

def save_json(p, d):
    with open(p, "w", encoding="utf-8") as f: json.dump(d, f, ensure_ascii=False, indent=2)

def api_check(nicks, url):
    try:
        if not nicks: return {}
        body = json.dumps({"nicknames": nicks}).encode()
        req = urlreq.Request(url, data=body, headers={"Content-Type":"application/json"})
        with urlreq.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode()).get("registered", {})
    except: return {}

def wr_color(wr):
    if wr <= 0: return GRAY
    if wr < 47: return RED
    if wr < 50: return ORANGE
    if wr < 53: return WHITE
    if wr < 57: return GREEN
    return CYAN

def lesta_fetch_stats(account_ids, app_id):
    """Fetch win rates for a batch of account IDs from Lesta API."""
    result = {}
    if not app_id or not account_ids: return result
    try:
        ids_str = ",".join(str(i) for i in account_ids[:100])
        url = f"{LESTA_API}/account/info/?application_id={app_id}&account_id={ids_str}&fields=statistics.all.wins,statistics.all.battles"
        req = urlreq.Request(url)
        with urlreq.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode())
        if data.get("status") == "ok":
            for aid, info in data.get("data", {}).items():
                if info is None: continue
                stats = info.get("statistics", {}).get("all", {})
                battles = stats.get("battles", 0)
                wins = stats.get("wins", 0)
                wr = round(wins / battles * 100, 1) if battles > 0 else 0
                result[str(aid)] = {"wr": wr, "battles": battles, "wins": wins}
    except Exception as e:
        pass
    return result


class MatchPopup(ctk.CTkToplevel):
    def __init__(self, master, nick, matches, total_dmg, total_kills):
        super().__init__(master)
        self.app = master
        self.nick = nick
        self.title(f"История: {nick}"); self.geometry("600x550"); self.configure(fg_color=BG); self.attributes('-topmost', 1)
        
        info = self.app.db.get("players", {}).get(nick, {})
        self.is_fav = info.get("is_fav", False)
        self.comment = info.get("comment", "")

        h = ctk.CTkFrame(self, fg_color=CARD, corner_radius=0, height=80); h.pack(fill="x")
        
        tf = ctk.CTkFrame(h, fg_color="transparent")
        tf.pack(pady=(10,0))
        
        ctk.CTkLabel(tf, text=nick, font=("Segoe UI",22,"bold"), text_color=GOLD).pack(side="left", padx=(0, 15))
        
        self.btn_fav = ctk.CTkButton(tf, text="Убрать из избранного" if self.is_fav else "⭐ В избранное", 
                                     width=140, height=28, 
                                     fg_color=GOLD if self.is_fav else CARD2, 
                                     text_color=BG if self.is_fav else WHITE, 
                                     font=("Segoe UI", 12, "bold"), 
                                     command=self._toggle_fav)
        self.btn_fav.pack(side="left")
        
        ctk.CTkLabel(h, text=f"Боёв вместе: {len(matches)}  ·  Σ Урон: {total_dmg:,}  ·  Σ Фраги: {total_kills}", font=("Segoe UI",13), text_color=GRAY).pack(pady=(4,10))

        cf = ctk.CTkFrame(self, fg_color=CARD2, corner_radius=8, height=80)
        cf.pack(fill="x", padx=15, pady=(15, 0)); cf.pack_propagate(False)
        ctk.CTkLabel(cf, text="📝 Комментарий:", font=("Segoe UI", 11, "bold"), text_color=GRAY).pack(anchor="w", padx=10, pady=(5,0))
        self.comment_box = ctk.CTkTextbox(cf, height=40, fg_color="#0b0e13", text_color=WHITE, font=("Segoe UI", 12))
        self.comment_box.pack(fill="both", expand=True, padx=10, pady=(0, 10))
        self.comment_box.insert("1.0", self.comment)
        
        save_btn = ctk.CTkButton(cf, text="Сохранить", width=80, height=24, command=self._save_comment, fg_color=GOLD, text_color=BG)
        save_btn.place(relx=1.0, rely=0.0, anchor="ne", x=-10, y=5)

        sc = ctk.CTkScrollableFrame(self, fg_color="transparent"); sc.pack(fill="both", expand=True, padx=15, pady=15)
        for m in sorted(matches, key=lambda x: x.get("battle",0), reverse=True):
            row = ctk.CTkFrame(sc, fg_color=CARD2, corner_radius=8, height=42); row.pack(fill="x", pady=3); row.pack_propagate(False)
            ctk.CTkLabel(row, text=f"#{m.get('battle','?')}", width=50, font=("Segoe UI",11,"bold"), text_color=GOLD).pack(side="left", padx=8)
            ctk.CTkLabel(row, text=m.get("date",""), width=110, font=("Segoe UI",11), text_color=GRAY).pack(side="left", padx=5)
            ctk.CTkLabel(row, text=m.get("tank","?"), font=("Segoe UI",12,"bold"), text_color=WHITE).pack(side="left", padx=8)
            ctk.CTkLabel(row, text=f"💥 {m.get('dmg',0):,}", font=("Segoe UI",12,"bold"), text_color=GREEN).pack(side="right", padx=10)
            ctk.CTkLabel(row, text=f"☠ {m.get('kills',0)}", font=("Segoe UI",12), text_color=RED).pack(side="right", padx=8)

    def _toggle_fav(self):
        self.is_fav = not self.is_fav
        self.btn_fav.configure(text="Убрать из избранного" if self.is_fav else "⭐ В избранное",
                               fg_color=GOLD if self.is_fav else CARD2,
                               text_color=BG if self.is_fav else WHITE)
        if self.nick not in self.app.db["players"]:
            self.app.db["players"][self.nick] = {"matches": []}
        self.app.db["players"][self.nick]["is_fav"] = self.is_fav
        save_json(DATA_FILE, self.app.db)
        self.app._refresh()

    def _save_comment(self):
        text = self.comment_box.get("1.0", "end-1c").strip()
        if self.nick not in self.app.db["players"]:
            self.app.db["players"][self.nick] = {"matches": []}
        self.app.db["players"][self.nick]["comment"] = text
        save_json(DATA_FILE, self.app.db)
        messagebox.showinfo("Успех", "Комментарий сохранён!", parent=self)


class BountyPopup(ctk.CTkToplevel):
    def __init__(self, master):
        super().__init__(master)
        self.title("🎯 Управление: Охота на стримера")
        self.geometry("400x350")
        self.configure(fg_color=BG)
        self.attributes('-topmost', 1)
        self.json_path = os.path.join(ROOT, "site", "obs", "bounty_session.json")
        
        lbl = ctk.CTkLabel(self, text="УПРАВЛЕНИЕ ОХОТОЙ", font=("Segoe UI", 16, "bold"), text_color=GOLD)
        lbl.pack(pady=(20, 10))

        self.status_lbl = ctk.CTkLabel(self, text="Загрузка...", font=("Segoe UI", 12))
        self.status_lbl.pack(pady=5)
        
        btn_frame = ctk.CTkFrame(self, fg_color="transparent")
        btn_frame.pack(pady=20)
        
        self.btn_start = ctk.CTkButton(btn_frame, text="▶ СТАРТ / ПРОДОЛЖИТЬ", fg_color=GREEN, hover_color="#16a34a", text_color=BG, font=("Segoe UI", 12, "bold"), command=self._start)
        self.btn_start.pack(fill="x", pady=5)
        
        self.btn_stop = ctk.CTkButton(btn_frame, text="⏹ ОСТАНОВИТЬ", fg_color=RED, hover_color="#b91c1c", text_color=WHITE, font=("Segoe UI", 12, "bold"), command=self._stop)
        self.btn_stop.pack(fill="x", pady=5)
        
        self.btn_reset = ctk.CTkButton(btn_frame, text="🔄 СБРОСИТЬ (Новая охота)", fg_color=CARD, border_width=1, border_color=GOLD, text_color=GOLD, font=("Segoe UI", 12, "bold"), command=self._reset)
        self.btn_reset.pack(fill="x", pady=20)

        self._refresh_status()

    def _read_data(self):
        try:
            if os.path.exists(self.json_path):
                with open(self.json_path, "r", encoding="utf-8") as f:
                    return json.load(f)
        except: pass
        return {'status': 'stopped', 'total_damage_received': 0}

    def _write_data(self, data):
        data['last_update'] = str(time.strftime("%Y-%m-%d %H:%M:%S"))
        try:
            with open(self.json_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            messagebox.showerror("Ошибка", str(e))

    def _refresh_status(self):
        data = self._read_data()
        st = data.get('status', 'stopped')
        dmg = data.get('total_damage_received', 0)
        if st == 'active':
            self.status_lbl.configure(text=f"Статус: АКТИВНА\nНанесено урона: {dmg}", text_color=GREEN)
            self.btn_start.configure(state="disabled")
            self.btn_stop.configure(state="normal")
        else:
            self.status_lbl.configure(text=f"Статус: ОСТАНОВЛЕНА\nИтоговый урон: {dmg}", text_color=RED)
            self.btn_start.configure(state="normal")
            self.btn_stop.configure(state="disabled")

    def _save_to_history(self, d):
        """Сохраняет текущую сессию в bounty_history.json"""
        if not d.get('session_start') or not d.get('total_damage_received'):
            return  # Пустая сессия — не сохраняем
        history_path = os.path.join(ROOT, "site", "obs", "bounty_history.json")
        try:
            history = []
            if os.path.exists(history_path):
                with open(history_path, "r", encoding="utf-8") as f:
                    history = json.load(f)
            session = {
                'session_start': d.get('session_start', ''),
                'session_end': str(time.strftime("%Y-%m-%d %H:%M:%S")),
                'total_damage': d.get('total_damage_received', 0),
                'total_gold': d.get('total_gold_given', 0),
                'gold_rate': d.get('gold_rate', 1),
                'attackers': d.get('attackers', {})
            }
            history.insert(0, session)
            history = history[:200]  # Держим не более 200 сессий
            with open(history_path, "w", encoding="utf-8") as f:
                json.dump(history, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[BountyHistory] Save error: {e}")

    def _start(self):
        d = self._read_data()
        d['status'] = 'active'
        if not d.get('session_start'):
            d['session_start'] = str(time.strftime("%Y-%m-%d %H:%M:%S"))
        self._write_data(d)
        self._refresh_status()

    def _stop(self):
        d = self._read_data()
        self._save_to_history(d)   # Сохраняем в историю перед остановкой
        d['status'] = 'stopped'
        d['session_end'] = str(time.strftime("%Y-%m-%d %H:%M:%S"))
        self._write_data(d)
        self._refresh_status()

    def _reset(self):
        if messagebox.askyesno("Подтверждение", "Точно сбросить всю статистику охоты?"):
            d = self._read_data()
            self._save_to_history(d)   # Архивируем перед сбросом
            d = {
                'status': 'stopped',
                'session_start': str(time.strftime("%Y-%m-%d %H:%M:%S")),
                'total_damage_received': 0, 'total_gold_given': 0, 'gold_rate': 1,
                'attackers': {}, 'recent_hits': [], 'last_update': ''
            }
            self._write_data(d)
            self._refresh_status()


class RadarApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("Радар 7.0 — Battle Analyzer")
        self.geometry("1200x850"); self.minsize(1050, 700); self.configure(fg_color=BG)
        self.cfg = load_json(CFG_FILE, {"game_dir":"","api_url":API_URL,"lesta_app_id":DEFAULT_APP_ID})
        if not self.cfg.get("lesta_app_id"):
            self.cfg["lesta_app_id"] = DEFAULT_APP_ID
            save_json(CFG_FILE, self.cfg)
        self.db  = load_json(DATA_FILE, {"players":{},"favorites":[],"battles":[]})
        if "battles" not in self.db:
            self.db["battles"] = []
        self.battle_list = self.db["battles"]
        self.current_view = None
        self.sub_nicks = set()
        self.wr_cache = {}
        self.is_monitoring = True
        self._bounty_live = False
        self._last_refresh_hash = ''
        self._last_bounty_mtime = 0
        self._build_ui()
        self._start_monitor()

    def _build_ui(self):
        self.grid_columnconfigure(1, weight=1); self.grid_rowconfigure(0, weight=1)
        sb = ctk.CTkFrame(self, width=230, corner_radius=0, fg_color=BG2)
        sb.grid(row=0, column=0, sticky="nsew"); sb.grid_rowconfigure(14, weight=1)
        ctk.CTkLabel(sb, text="🛡 РАДАР 7.0", font=("Segoe UI",22,"bold"), text_color=GOLD).grid(row=0, column=0, padx=20, pady=(20,2))
        self.status_lbl = ctk.CTkLabel(sb, text="● ОЖИДАНИЕ", font=("Segoe UI",12,"bold"), text_color=GRAY)
        self.status_lbl.grid(row=1, column=0, padx=20, pady=(0,12))
        ctk.CTkButton(sb, text="🚀 ЗАПУСТИТЬ ИГРУ", command=self._launch_game, fg_color="#22c55e", hover_color="#16a34a", text_color=BG, font=("Segoe UI",13,"bold"), height=42).grid(row=2, column=0, padx=15, pady=(0,15), sticky="ew")
        bf = ctk.CTkFrame(sb, fg_color="transparent"); bf.grid(row=3, column=0, padx=15, sticky="ew")
        ctk.CTkButton(bf, text="📂 Папка игры", command=self._pick_folder, fg_color=CARD, border_width=1, border_color=GOLD, text_color=GOLD, height=32).pack(fill="x", pady=2)
        ctk.CTkButton(bf, text="🔍 Поиск игрока", command=self._search_player, fg_color=CARD, border_width=1, border_color="#444", text_color=WHITE, height=32).pack(fill="x", pady=2)
        ctk.CTkButton(bf, text="🔑 API ключ Лесты", command=self._set_api_key, fg_color=CARD, border_width=1, border_color="#444", text_color=WHITE, height=32).pack(fill="x", pady=2)
        ctk.CTkButton(bf, text="📊 Экспорт CSV", command=self._export_csv, fg_color=CARD, border_width=1, border_color="#444", text_color=WHITE, height=32).pack(fill="x", pady=2)
        ctk.CTkButton(bf, text="🗑 Сброс базы", command=self._clear, fg_color="transparent", border_width=1, border_color="#333", text_color=GRAY, height=28).pack(fill="x", pady=10)
        
        # Кнопка быстрого перехода к Охоте
        ctk.CTkButton(bf, text="🎯 Охота на Стримера", command=lambda: self._tab('bounty'), fg_color=CARD, border_width=1, border_color="#f59e0b", text_color="#f59e0b", height=32).pack(fill="x", pady=5)
        
        self.stat_lbl = ctk.CTkLabel(sb, text="", font=("Segoe UI",12), text_color=WHITE, justify="left")
        self.stat_lbl.grid(row=5, column=0, padx=20, pady=0, sticky="w")
        self.log_box = ctk.CTkTextbox(sb, height=180, font=("Consolas",9), fg_color="#080b10", text_color="#5e6d82")
        self.log_box.grid(row=14, column=0, padx=10, pady=(5,12), sticky="nsew"); self.log_box.configure(state="disabled")
        # CONTENT
        c = ctk.CTkFrame(self, fg_color=BG, corner_radius=0); c.grid(row=0, column=1, sticky="nsew")
        c.grid_rowconfigure(2, weight=1); c.grid_columnconfigure(0, weight=1)
        tabs = ctk.CTkFrame(c, fg_color=BG, height=50); tabs.grid(row=0, column=0, sticky="ew", padx=20, pady=(18,0))
        self.tab_var = ctk.StringVar(value="battle")
        for val, txt in [("battle","⚔ Последний бой"),("history","📋 История"),("encounters","🔄 Частые"),("subs","🌟 Подписчики"),("favs","⭐ Избранные"),("all","📊 Все"),("bounty","🎯 Охота")]:
            btn = ctk.CTkButton(tabs, text=txt, width=110, height=34, corner_radius=8,
                fg_color=CARD if val!="battle" else GOLD, text_color=BG if val=="battle" else WHITE,
                command=lambda v=val: self._tab(v))
            btn.pack(side="left", padx=3); setattr(self, f"tb_{val}", btn)
        flt = ctk.CTkFrame(c, fg_color=CARD, height=45, corner_radius=8)
        flt.grid(row=1, column=0, sticky="ew", padx=22, pady=(12,0))
        self.sort_var = ctk.StringVar(value="По урону")
        ctk.CTkComboBox(flt, variable=self.sort_var, values=["По урону","По фрагам","По встречам","По WR"], width=125, command=lambda _: self._refresh()).pack(side="left", padx=10, pady=8)
        self.battle_var = ctk.StringVar(value="Последний")
        self.battle_cb = ctk.CTkComboBox(flt, variable=self.battle_var, values=["Последний"], width=140, command=lambda _: self._on_battle_select())
        self.battle_cb.pack(side="right", padx=10)
        self.scroll = ctk.CTkScrollableFrame(c, fg_color=BG, corner_radius=0); self.scroll.grid(row=2, column=0, sticky="nsew", padx=10, pady=10)
        self._refresh()

    def _tab(self, t):
        self.tab_var.set(t)
        self._bounty_live = (t == 'bounty')
        for v in ("battle","history","encounters","subs","favs","all","bounty"):
            b = getattr(self, f"tb_{v}", None)
            if b: b.configure(fg_color=GOLD if v==t else CARD, text_color=BG if v==t else WHITE)
        self._refresh(force=True)

    def _refresh(self, force=False):
        tab = self.tab_var.get()
        # Быстрый хеш: если данные не изменились — не перерисовываем (анти-мерцание)
        cv = self.current_view
        h = f"{tab}|{len(self.battle_list)}|{cv.get('battle_number','') if cv else ''}|{len(self.db.get('players',{}))}|{len(self.wr_cache)}"
        if not force and h == self._last_refresh_hash:
            return
        self._last_refresh_hash = h
        for w in self.scroll.winfo_children(): w.destroy()
        self.stat_lbl.configure(text=f"🎮 Боёв: {len(self.battle_list)}\n👤 Игроков: {len(self.db.get('players',{}))}\n⭐ Избранных: {len(self.db.get('favorites',[]))}")
        self._update_battle_selector()
        if tab == "battle": self._render_battle()
        elif tab == "history": self._render_history()
        elif tab == "encounters": self._render_encounters()
        elif tab == "subs": self._render_players("subs")
        elif tab == "favs": self._render_players("favs")
        elif tab == "all": self._render_players("all")
        elif tab == "bounty": self._render_bounty()

    # ──── BATTLE VIEW ────
    def _render_battle(self):
        b = self.current_view
        if not b: self._empty("📡 Жду данных от мода...\n\nСыграй бой → вернись в ангар"); return
        allies = b.get("allies",[]); enemies = b.get("enemies",[])
        a_dmg = sum(p.get("damage",0) for p in allies); e_dmg = sum(p.get("damage",0) for p in enemies)
        # WR
        a_wrs = [self.wr_cache.get(str(p.get("account_id",""))  ,{}).get("wr",0) for p in allies]
        e_wrs = [self.wr_cache.get(str(p.get("account_id",""))  ,{}).get("wr",0) for p in enemies]
        a_wrs_valid = [w for w in a_wrs if w > 0]; e_wrs_valid = [w for w in e_wrs if w > 0]
        avg_a_wr = round(sum(a_wrs_valid)/len(a_wrs_valid), 1) if a_wrs_valid else 0
        avg_e_wr = round(sum(e_wrs_valid)/len(e_wrs_valid), 1) if e_wrs_valid else 0
        # Winner calculation
        win_lbl = ""
        win_clr = GRAY
        if "winner" in b:
            if b["winner"] == "ally": win_lbl = "🏆 ПОБЕДА СОЮЗНИКОВ"; win_clr = ALLY_CLR
            elif b["winner"] == "enemy": win_lbl = "💀 ПОБЕДА ПРОТИВНИКОВ"; win_clr = ENM_CLR
            else: win_lbl = "НИЧЬЯ"; win_clr = GRAY
        
        # Summary bar
        hdr = ctk.CTkFrame(self.scroll, fg_color=CARD2, corner_radius=10, height=72); hdr.pack(fill="x", pady=(0,10)); hdr.pack_propagate(False)
        b_info = ctk.CTkFrame(hdr, fg_color="transparent")
        b_info.pack(side="left", padx=15)
        ctk.CTkLabel(b_info, text=f"🛡 БОЙ #{b.get('battle_number','?')}", font=("Segoe UI",18,"bold"), text_color=GOLD).pack()
        if win_lbl:
            ctk.CTkLabel(b_info, text=win_lbl, font=("Segoe UI",11,"bold"), text_color=win_clr).pack(pady=(2,0))
            
        f1 = ctk.CTkFrame(hdr, fg_color="transparent"); f1.pack(side="left", padx=20)
        ctk.CTkLabel(f1, text="🟢 СОЮЗНИКИ", font=("Segoe UI",10,"bold"), text_color=ALLY_CLR).pack()
        ctk.CTkLabel(f1, text=f"💥 {a_dmg:,}", font=("Segoe UI",12,"bold"), text_color=WHITE).pack()
        if avg_a_wr > 0: ctk.CTkLabel(f1, text=f"WR {avg_a_wr}%", font=("Segoe UI",11,"bold"), text_color=wr_color(avg_a_wr)).pack()
        ctk.CTkLabel(hdr, text="VS", font=("Segoe UI",16,"bold"), text_color=GRAY).pack(side="left", padx=10)
        f2 = ctk.CTkFrame(hdr, fg_color="transparent"); f2.pack(side="left", padx=20)
        ctk.CTkLabel(f2, text="🔴 ПРОТИВНИКИ", font=("Segoe UI",10,"bold"), text_color=ENM_CLR).pack()
        ctk.CTkLabel(f2, text=f"💥 {e_dmg:,}", font=("Segoe UI",12,"bold"), text_color=WHITE).pack()
        if avg_e_wr > 0: ctk.CTkLabel(f2, text=f"WR {avg_e_wr}%", font=("Segoe UI",11,"bold"), text_color=wr_color(avg_e_wr)).pack()
        # WR comparison
        if avg_a_wr > 0 and avg_e_wr > 0:
            diff = round(avg_a_wr - avg_e_wr, 1)
            txt = f"WR перевес: +{diff}% союзники" if diff > 0 else f"WR перевес: {diff}% враги" if diff < 0 else "WR равен"
            clr = ALLY_CLR if diff > 0 else ENM_CLR if diff < 0 else GRAY
            ctk.CTkLabel(hdr, text=txt, font=("Segoe UI",11,"bold"), text_color=clr).pack(side="right", padx=15)
        # Columns
        cols = ctk.CTkFrame(self.scroll, fg_color="transparent"); cols.pack(fill="x")
        cols.grid_columnconfigure(0, weight=1); cols.grid_columnconfigure(1, weight=1)
        sk = "kills" if self.sort_var.get()=="По фрагам" else "damage"
        for side_idx, (label, players, col) in enumerate([("ally", allies, 0), ("enemy", enemies, 1)]):
            f = ctk.CTkFrame(cols, fg_color="transparent"); f.grid(row=0, column=col, sticky="nsew", padx=4)
            clr = ALLY_CLR if label=="ally" else ENM_CLR
            ctk.CTkLabel(f, text=f"{'🟢 СОЮЗНИКИ' if label=='ally' else '🔴 ПРОТИВНИКИ'} ({len(players)})", font=("Segoe UI",12,"bold"), text_color=clr).pack(pady=5)
            for i, p in enumerate(sorted(players, key=lambda x: x.get(sk,0), reverse=True)):
                self._battle_row(f, p, i, label=="ally")

    def _battle_row(self, parent, p, idx, is_ally):
        nick = p.get("nick","?"); aid = str(p.get("account_id",""))
        is_sub = nick in self.sub_nicks
        is_fav = self.db.get("players", {}).get(nick, {}).get("is_fav", False)
        wr_info = self.wr_cache.get(aid, {})
        wr = wr_info.get("wr", 0)
        enc = len(self.db.get("players",{}).get(nick,{}).get("matches",[]))
        bg = CARD_A if is_ally else CARD_E
        if is_sub: bg = "#2b2b11"
        row = ctk.CTkFrame(parent, fg_color=bg, corner_radius=6, height=48); row.pack(fill="x", pady=2); row.pack_propagate(False)
        # Click to see match history
        row.bind("<Button-1>", lambda e, n=nick: self._show_player_popup(n))
        if is_fav: ctk.CTkLabel(row, text="⭐", font=("Segoe UI",11), text_color=STAR_ON).pack(side="left", padx=(8,0))
        ctk.CTkLabel(row, text=nick, font=("Segoe UI",12,"bold"), text_color=GOLD if is_sub else WHITE, cursor="hand2").pack(side="left", padx=8)
        if is_sub:
            ctk.CTkLabel(row, text="SUB", font=("Segoe UI",9,"bold"), text_color=GOLD, fg_color="#2b2611", corner_radius=4, padx=4).pack(side="left", padx=3)
        if enc > 1:
            ctk.CTkLabel(row, text=f"×{enc}", font=("Segoe UI",10,"bold"), text_color=ORANGE).pack(side="left", padx=4)
        # Right side: damage, kills, WR, tank
        ctk.CTkLabel(row, text=f"{p.get('damage',0):,}", font=("Segoe UI",13,"bold"), text_color=GREEN if p.get("damage",0)>0 else GRAY).pack(side="right", padx=10)
        ctk.CTkLabel(row, text=f"☠{p.get('kills',0)}", font=("Segoe UI",11), text_color=RED if p.get("kills",0)>0 else GRAY).pack(side="right", padx=4)
        if wr > 0:
            ctk.CTkLabel(row, text=f"{wr}%", font=("Segoe UI",11,"bold"), text_color=wr_color(wr)).pack(side="right", padx=6)
        ctk.CTkLabel(row, text=p.get("tank","?"), font=("Segoe UI",10), text_color="#6b7a8d").pack(side="right", padx=6)

    # ──── ENCOUNTERS ────
    def _render_encounters(self):
        db = self.db.get("players", {})
        rows = []
        for nick, info in db.items():
            m = info.get("matches", [])
            if len(m) < 2: continue
            td = sum(x.get("dmg",0) for x in m); tk = sum(x.get("kills",0) for x in m)
            rows.append({"nick": nick, "count": len(m), "total_dmg": td, "total_kills": tk, "is_sub": info.get("is_sub",False), "tank": m[-1].get("tank","?")})
        rows.sort(key=lambda x: x["count"], reverse=True)
        if not rows: self._empty("🔄 Пока нет повторных встреч\n\nСыграй побольше боёв!"); return
        ctk.CTkLabel(self.scroll, text=f"Игроки, с которыми играл 2+ раз ({len(rows)})", font=("Segoe UI",14,"bold"), text_color=GOLD).pack(pady=(0,10))
        for r in rows[:100]:
            row = ctk.CTkFrame(self.scroll, fg_color="#1e2636" if r["is_sub"] else CARD, corner_radius=8, height=50); row.pack(fill="x", pady=2); row.pack_propagate(False)
            row.bind("<Button-1>", lambda e, n=r["nick"]: self._show_player_popup(n))
            ctk.CTkLabel(row, text=f"×{r['count']}", font=("Segoe UI",16,"bold"), text_color=ORANGE, width=50).pack(side="left", padx=12)
            ctk.CTkLabel(row, text=r["nick"], font=("Segoe UI",14,"bold"), text_color=GOLD if r["is_sub"] else WHITE, cursor="hand2").pack(side="left", padx=8)
            if r["is_sub"]: ctk.CTkLabel(row, text="SUB", font=("Segoe UI",9,"bold"), text_color=GOLD, fg_color="#2b2611", corner_radius=4, padx=4).pack(side="left", padx=5)
            ctk.CTkLabel(row, text=f"УРОН: {r['total_dmg']:,}", font=("Segoe UI",13,"bold"), text_color=GREEN).pack(side="right", padx=12)
            ctk.CTkLabel(row, text=f"☠ {r['total_kills']}", text_color=RED).pack(side="right", padx=8)

    # ──── HISTORY ────
    def _render_history(self):
        if not self.battle_list: self._empty("📋 Нет боёв"); return
        
        groups = {}
        for b in reversed(self.battle_list):
            day = b.get("date","").split(" ")[0] if " " in b.get("date","") else b.get("date","")
            if day not in groups: groups[day] = []
            groups[day].append(b)

        for day, battles in groups.items():
            lbl = ctk.CTkLabel(self.scroll, text=f"📅 {day}", font=("Segoe UI",15,"bold"), text_color=GOLD)
            lbl.pack(anchor="w", padx=10, pady=(15, 5))
            for b in battles:
                row = ctk.CTkFrame(self.scroll, fg_color=CARD, corner_radius=8, height=52); row.pack(fill="x", pady=2); row.pack_propagate(False)
                
                win_text = ""
                win_clr = GRAY
                if b.get("winner") == "ally": win_text = "🏆 ПОБЕДА"; win_clr = ALLY_CLR
                elif b.get("winner") == "enemy": win_text = "💀 ПОРАЖЕНИЕ"; win_clr = ENM_CLR

                ctk.CTkLabel(row, text=f"#{b.get('battle_number')}", width=40, font=("Segoe UI",14,"bold"), text_color=GOLD).pack(side="left", padx=15)
                ctk.CTkLabel(row, text=b.get("date","").split(" ")[-1], font=("Segoe UI",12), text_color=GRAY).pack(side="left", padx=5)
                
                if win_text: ctk.CTkLabel(row, text=win_text, width=100, font=("Segoe UI",11,"bold"), text_color=win_clr).pack(side="left", padx=10)
                
                ctk.CTkLabel(row, text=f"🟢 {sum(p.get('damage',0) for p in b.get('allies',[])):,}", text_color=ALLY_CLR, font=("Segoe UI",12,"bold")).pack(side="left", padx=15)
                ctk.CTkLabel(row, text=f"🔴 {sum(p.get('damage',0) for p in b.get('enemies',[])):,}", text_color=ENM_CLR, font=("Segoe UI",12,"bold")).pack(side="left", padx=10)
                ctk.CTkButton(row, text="Открыть", width=80, height=28, command=lambda b_=b: self._view_battle(b_)).pack(side="right", padx=15)

    # ──── PLAYERS LIST ────
    def _render_players(self, tab):
        db = self.db.get("players",{}); rows = []
        for n, i in db.items():
            if tab=="subs" and not i.get("is_sub"): continue
            if tab=="favs" and not i.get("is_fav"): continue
            m = i.get("matches",[]); 
            if not m: continue
            td = sum(x.get("dmg",0) for x in m); tk = sum(x.get("kills",0) for x in m)
            rows.append({"nick":n,"is_sub":i.get("is_sub",False),"total_dmg":td,"total_kills":tk,"count":len(m),"tank":m[-1].get("tank","?"),"matches":m})
        sk = self.sort_var.get()
        k = "total_kills" if sk=="По фрагам" else "count" if sk=="По встречам" else "total_dmg"
        rows.sort(key=lambda x: x[k], reverse=True)
        if not rows: self._empty("Нет данных"); return
        for r in rows[:200]:
            row = ctk.CTkFrame(self.scroll, fg_color="#1e2636" if r["is_sub"] else CARD, corner_radius=8, height=50)
            row.pack(fill="x", pady=2); row.pack_propagate(False)
            row.bind("<Button-1>", lambda e, n=r["nick"]: self._show_player_popup(n))
            ctk.CTkLabel(row, text=r["nick"], font=("Segoe UI",14,"bold"), text_color=GOLD if r["is_sub"] else WHITE, cursor="hand2").pack(side="left", padx=15)
            if r["is_sub"]: ctk.CTkLabel(row, text="SUB", font=("Segoe UI",9,"bold"), text_color=GOLD, fg_color="#2b2611", corner_radius=4, padx=4).pack(side="left", padx=5)
            ctk.CTkLabel(row, text=f"🛡 {r['tank']}", font=("Segoe UI",11), text_color="#6b7a8d").pack(side="left", padx=10)
            ctk.CTkLabel(row, text=f"УРОН: {r['total_dmg']:,}", font=("Segoe UI",13,"bold"), text_color=GREEN).pack(side="right", padx=12)
            ctk.CTkLabel(row, text=f"☠ {r['total_kills']}", text_color=RED).pack(side="right", padx=8)
            if r["count"] > 1: ctk.CTkLabel(row, text=f"×{r['count']}", font=("Segoe UI",11,"bold"), text_color=ORANGE).pack(side="right", padx=5)

    def _render_bounty(self):
        """Полная панель управления Охотой на Стримера"""
        s = self.scroll
        data = _bounty_read()
        status = data.get('status', 'stopped')
        is_active = status == 'active'

        # ── ЗАГОЛОВОК ──
        hdr = ctk.CTkFrame(s, fg_color="#1a0f00", corner_radius=12, border_width=1, border_color="#f59e0b")
        hdr.pack(fill="x", pady=(0, 10))
        top = ctk.CTkFrame(hdr, fg_color="transparent"); top.pack(fill="x", padx=16, pady=12)
        ctk.CTkLabel(top, text="🎯 ОХОТА НА СТРИМЕРА", font=("Segoe UI", 20, "bold"), text_color="#f59e0b").pack(side="left")
        st_color = GREEN if is_active else RED
        st_text = "● АКТИВНА" if is_active else "● ОСТАНОВЛЕНА"
        ctk.CTkLabel(top, text=st_text, font=("Segoe UI", 13, "bold"), text_color=st_color).pack(side="right")

        # ── КНОПКИ УПРАВЛЕНИЯ ──
        ctrl = ctk.CTkFrame(s, fg_color=CARD2, corner_radius=10); ctrl.pack(fill="x", pady=(0, 8))
        ctk.CTkLabel(ctrl, text="УПРАВЛЕНИЕ СЕССИЕЙ", font=("Segoe UI", 10, "bold"), text_color=GRAY).pack(pady=(10,6))
        brow = ctk.CTkFrame(ctrl, fg_color="transparent"); brow.pack(fill="x", padx=12, pady=(0,10))
        ctk.CTkButton(brow, text="▶ ЗАПУСТИТЬ", fg_color="#15803d" if not is_active else CARD,
            hover_color="#166534", text_color=WHITE, font=("Segoe UI",12,"bold"), height=38,
            state="normal" if not is_active else "disabled",
            command=self._bounty_start).pack(side="left", expand=True, fill="x", padx=3)
        ctk.CTkButton(brow, text="⏹ ОСТАНОВИТЬ", fg_color=RED if is_active else CARD,
            hover_color="#b91c1c", text_color=WHITE, font=("Segoe UI",12,"bold"), height=38,
            state="normal" if is_active else "disabled",
            command=self._bounty_stop).pack(side="left", expand=True, fill="x", padx=3)
        ctk.CTkButton(brow, text="🔄 СБРОСИТЬ", fg_color="transparent",
            border_width=1, border_color="#f59e0b", text_color="#f59e0b",
            font=("Segoe UI",12,"bold"), height=38, command=self._bounty_reset).pack(side="left", expand=True, fill="x", padx=3)

        # ── СТАТИСТИКА ТЕКУЩЕЙ СЕССИИ ──
        total_dmg = data.get('total_damage_received', 0)
        total_gold = data.get('total_gold_given', 0)
        attackers = data.get('attackers', {})
        n_attackers = len(attackers)
        session_start = data.get('session_start', '—')

        stats = ctk.CTkFrame(s, fg_color=CARD, corner_radius=10); stats.pack(fill="x", pady=(0,8))
        ctk.CTkLabel(stats, text="ТЕКУЩАЯ СЕССИЯ", font=("Segoe UI",10,"bold"), text_color=GRAY).pack(pady=(10,6))
        srow = ctk.CTkFrame(stats, fg_color="transparent"); srow.pack(fill="x", padx=12, pady=(0,10))
        for lbl, val, clr in [("💥 УРОН", f"{total_dmg:,}", RED), ("💰 ЗОЛОТО", f"{total_gold:,}", GOLD), ("👥 ОХОТНИКОВ", str(n_attackers), BLUE)]:
            cell = ctk.CTkFrame(srow, fg_color=BG, corner_radius=8); cell.pack(side="left", expand=True, fill="x", padx=3)
            ctk.CTkLabel(cell, text=lbl, font=("Segoe UI",9), text_color=GRAY).pack(pady=(8,2))
            ctk.CTkLabel(cell, text=val, font=("Segoe UI",16,"bold"), text_color=clr).pack(pady=(0,8))
        if session_start:
            ctk.CTkLabel(stats, text=f"Начало сессии: {session_start}", font=("Segoe UI",9), text_color=GRAY).pack(pady=(0,6))

        # ── ТОП ОХОТНИКОВ ──
        if attackers:
            top5 = sorted(attackers.items(), key=lambda x: (x[1]['damage'] if isinstance(x[1],dict) else x[1]), reverse=True)[:5]
            tf = ctk.CTkFrame(s, fg_color=CARD2, corner_radius=10); tf.pack(fill="x", pady=(0,8))
            ctk.CTkLabel(tf, text="ТОП ОХОТНИКОВ", font=("Segoe UI",10,"bold"), text_color=GRAY).pack(pady=(10,5))
            for i, (name, info) in enumerate(top5):
                dmg = info['damage'] if isinstance(info,dict) else info
                tank = info.get('tank','—') if isinstance(info,dict) else '—'
                rw = ctk.CTkFrame(tf, fg_color=BG, corner_radius=8); rw.pack(fill="x", padx=12, pady=2)
                ctk.CTkLabel(rw, text=f"#{i+1}", font=("Segoe UI",11,"bold"), text_color=GOLD, width=28).pack(side="left", padx=8, pady=6)
                ctk.CTkLabel(rw, text=name, font=("Segoe UI",12,"bold"), text_color=WHITE).pack(side="left")
                ctk.CTkLabel(rw, text=f"🪖 {tank}", font=("Segoe UI",10), text_color=GRAY).pack(side="left", padx=8)
                ctk.CTkLabel(rw, text=f"{dmg:,}", font=("Segoe UI",13,"bold"), text_color=RED).pack(side="right", padx=12)
            ctk.CTkFrame(tf, fg_color="transparent", height=6).pack()

        # ── ССЫЛКИ НА OBS ВИДЖЕТЫ ──
        wf = ctk.CTkFrame(s, fg_color=CARD, corner_radius=10); wf.pack(fill="x", pady=(0,8))
        ctk.CTkLabel(wf, text="OBS ВИДЖЕТЫ", font=("Segoe UI",10,"bold"), text_color=GRAY).pack(pady=(10,6))
        base_local = "file:///d:/mir-tankov-bot/site/obs"
        for label, fname, extra in [
            ("🎯 Трекер Охоты (основной)", "bounty-tracker.html", "?theme=1"),
            ("👥 Подписчики в бою", "subs-in-battle.html", ""),
        ]:
            url = base_local + "/" + fname + extra
            wr = ctk.CTkFrame(wf, fg_color=BG, corner_radius=8); wr.pack(fill="x", padx=12, pady=3)
            ctk.CTkLabel(wr, text=label, font=("Segoe UI",10), text_color=WHITE).pack(side="left", padx=10, pady=8)
            def _copy(u=url):
                self.clipboard_clear(); self.clipboard_append(u)
                self._log(f"✅ Скопировано!")
            ctk.CTkButton(wr, text="📋 Копировать", width=110, height=26, fg_color=CARD2,
                text_color=BLUE, font=("Segoe UI",9), command=_copy).pack(side="right", padx=8, pady=6)
        ctk.CTkLabel(wf, text="⚠ В OBS включи 'Allow access to local files'", font=("Segoe UI",9,"bold"), text_color=ORANGE).pack(pady=(0,8))

        # Авто-обновление каждые 3 сек
        self.after(3000, self._bounty_live_tick)

                # ── ИСТОРИЯ ОХОТ ──
        history = []
        if os.path.exists(BOUNTY_HISTORY):
            try:
                with open(BOUNTY_HISTORY, 'r', encoding='utf-8') as f:
                    history = json.load(f)
            except: pass

        hf = ctk.CTkFrame(s, fg_color=CARD2, corner_radius=10); hf.pack(fill="x", pady=(0,8))
        ctk.CTkLabel(hf, text=f"ИСТОРИЯ ОХОТ ({len(history)} сессий)", font=("Segoe UI",10,"bold"), text_color=GRAY).pack(pady=(10,5))

        if not history:
            ctk.CTkLabel(hf, text="Нет завершённых охот", font=("Segoe UI",11), text_color=GRAY).pack(pady=15)
        else:
            for i, sess in enumerate(history[:20]):
                sf = ctk.CTkFrame(hf, fg_color=BG, corner_radius=8); sf.pack(fill="x", padx=12, pady=3)
                left = ctk.CTkFrame(sf, fg_color="transparent"); left.pack(side="left", padx=10, pady=8)
                ctk.CTkLabel(left, text=f"🎯 Охота #{len(history)-i}", font=("Segoe UI",11,"bold"), text_color="#f59e0b").pack(anchor="w")
                ctk.CTkLabel(left, text=f"{sess.get('session_start','?')} → {sess.get('session_end','?')}", font=("Segoe UI",8), text_color=GRAY).pack(anchor="w")
                n_atk = len(sess.get('attackers', {}))
                ctk.CTkLabel(left, text=f"👥 {n_atk} охотник{'а' if 2<=n_atk<=4 else 'ов' if n_atk>=5 else ''}", font=("Segoe UI",9), text_color=BLUE).pack(anchor="w")
                right = ctk.CTkFrame(sf, fg_color="transparent"); right.pack(side="right", padx=12, pady=8)
                ctk.CTkLabel(right, text=f"💥 {sess.get('total_damage',0):,}", font=("Segoe UI",13,"bold"), text_color=RED).pack(anchor="e")
                ctk.CTkLabel(right, text=f"💰 {sess.get('total_gold',0):,}", font=("Segoe UI",11,"bold"), text_color=GOLD).pack(anchor="e")
        ctk.CTkFrame(hf, fg_color="transparent", height=8).pack()

    def _bounty_start(self):
        d = _bounty_read(); d['status'] = 'active'
        if not d.get('session_start'): d['session_start'] = time.strftime("%Y-%m-%d %H:%M:%S")
        _bounty_write(d); self._log("▶ Охота ЗАПУЩЕНА"); self._refresh()

    def _bounty_stop(self):
        d = _bounty_read(); _bounty_save_history(d)
        d['status'] = 'stopped'; d['session_end'] = time.strftime("%Y-%m-%d %H:%M:%S")
        _bounty_write(d); self._log("⏹ Охота ОСТАНОВЛЕНА"); self._refresh()

    def _bounty_reset(self):
        if not messagebox.askyesno("Сброс охоты", "Сбросить текущую сессию?\nДанные сохранятся в историю."): return
        d = _bounty_read(); _bounty_save_history(d)
        _bounty_write({'status':'stopped','session_start':'','total_damage_received':0,
            'total_gold_given':0,'gold_rate':1,'attackers':{},'recent_hits':[],'participants_count':0,'last_update':''})
        self._log("🔄 Охота СБРОШЕНА"); self._refresh()

    def _open_bounty_popup(self):
        self._tab('bounty')

    def _bounty_live_tick(self):
        """Авто-обновление Охоты — только если файл данных РЕАЛЬНО изменился"""
        if self._bounty_live and self.tab_var.get() == 'bounty':
            try:
                if os.path.exists(BOUNTY_JSON):
                    mt = os.path.getmtime(BOUNTY_JSON)
                    if mt != self._last_bounty_mtime:
                        self._last_bounty_mtime = mt
                        self._refresh(force=True)
            except: pass
        self.after(3000, self._bounty_live_tick)


    def _empty(self, t):
        ctk.CTkLabel(self.scroll, text=t, font=("Segoe UI",14), text_color=GRAY, justify="center").pack(pady=80)

    def _log(self, t):
        self.log_box.configure(state="normal"); self.log_box.insert("end", f"[{time.strftime('%H:%M:%S')}] {t}\n"); self.log_box.see("end"); self.log_box.configure(state="disabled")

    def _view_battle(self, b): self.current_view = b; self._tab("battle")
    def _update_battle_selector(self):
        v = ["Последний"] + [f"Бой #{b.get('battle_number')}" for b in reversed(self.battle_list)]
        self.battle_cb.configure(values=v)
    def _on_battle_select(self):
        cur = self.battle_var.get()
        if cur == "Последний":
            if self.battle_list: self.current_view = self.battle_list[-1]
        else:
            try:
                n = int(cur.split("#")[-1])
                for b in self.battle_list:
                    if b.get("battle_number") == n: self.current_view = b; break
            except: pass
        self._tab("battle")

    def _show_player_popup(self, nick):
        info = self.db.get("players",{}).get(nick, {})
        m = info.get("matches", [])
        if not m: return
        td = sum(x.get("dmg",0) for x in m); tk = sum(x.get("kills",0) for x in m)
        MatchPopup(self, nick, m, td, tk)

    def _search_player(self):
        dlg = ctk.CTkInputDialog(text="Введи ник (или часть):", title="🔍 Поиск игрока")
        query = dlg.get_input()
        if not query: return
        db = self.db.get("players", {})
        found = [(n, info) for n, info in db.items() if query.lower() in n.lower()]
        if not found:
            messagebox.showinfo("Поиск", f"Игрок '{query}' не найден в базе"); return
        if len(found) == 1:
            self._show_player_popup(found[0][0])
        else:
            txt = "\n".join([f"{n} ({len(i.get('matches',[]))} боёв)" for n, i in found[:30]])
            messagebox.showinfo(f"Найдено ({len(found)})", txt)

    def _set_api_key(self):
        dlg = ctk.CTkInputDialog(text="Вставь application_id от Lesta:\n(получить на developers.lesta.ru)", title="🔑 API Ключ")
        key = dlg.get_input()
        if key and len(key) > 5:
            self.cfg["lesta_app_id"] = key.strip()
            save_json(CFG_FILE, self.cfg)
            self._log(f"✅ API ключ сохранён")
            messagebox.showinfo("API", "Ключ сохранён! WR подтянется в следующем бою.")

    def _export_csv(self):
        path = filedialog.asksaveasfilename(defaultextension=".csv", filetypes=[("CSV","*.csv")])
        if not path: return
        try:
            with open(path, "w", encoding="utf-8-sig") as f:
                f.write("Ник;Подписчик;Боёв вместе;Σ Урон;Σ Фраги;Последний танк\n")
                for nick, info in self.db.get("players",{}).items():
                    m = info.get("matches",[])
                    sub = "Да" if info.get("is_sub") else "Нет"
                    f.write(f"{nick};{sub};{len(m)};{sum(x.get('dmg',0) for x in m)};{sum(x.get('kills',0) for x in m)};{m[-1].get('tank','?') if m else '?'}\n")
            messagebox.showinfo("Экспорт", f"Сохранено: {path}"); self._log(f"📊 CSV: {path}")
        except Exception as e:
            messagebox.showerror("Ошибка", str(e))

    def _launch_game(self):
        gd = self.cfg.get("game_dir")
        if not gd: messagebox.showerror("Ошибка", "Сначала выбери папку игры!"); return
        for exe in ["win64\\wot.exe","wot.exe","LestaLauncher.exe"]:
            p = os.path.join(gd, exe)
            if os.path.exists(p): os.startfile(p); self._log(f"🚀 {exe}"); return
        messagebox.showerror("Ошибка", "Не нашел exe игры!")

    def _pick_folder(self):
        d = filedialog.askdirectory()
        if d: self.cfg["game_dir"] = d; save_json(CFG_FILE, self.cfg); self._start_monitor()

    def _clear(self):
        if messagebox.askyesno("Очистка", "Удалить ВСЮ историю?"):
            self.db = {"players":{},"favorites":[],"battles":[]}; self.battle_list=[]; self.current_view=None
            save_json(DATA_FILE, self.db); self._refresh()

    # ──── MONITOR ────
    def _start_monitor(self):
        gd = self.cfg.get("game_dir")
        if not gd or not os.path.exists(gd):
            for p in [r"D:\Танки\World_of_Tanks_RU", r"D:\Games\Lesta\Мир танков"]:
                if os.path.exists(p): gd = p; self.cfg["game_dir"] = p; save_json(CFG_FILE, self.cfg); break
        if not gd: self.status_lbl.configure(text="● ВЫБЕРИ ПАПКУ", text_color=RED); return
        self.status_lbl.configure(text="● МОД АКТИВЕН", text_color=GREEN)
        rp = os.path.join(gd, "radar_results.json")
        self._log(f"📡 Слежу: {rp}")
        threading.Thread(target=self._poll, args=(rp,), daemon=True).start()

    def _poll(self, rp):
        lt = 0
        while self.is_monitoring:
            try:
                if os.path.exists(rp):
                    mt = os.path.getmtime(rp)
                    if mt > lt:
                        mj = load_json(rp)
                        if mj.get("players") or mj.get("allies"):
                            self.after(0, self._on_data, mj)
                            lt = mt
            except: pass
            time.sleep(2)

    def _on_data(self, mj):
        allies = mj.get("allies",[]); enemies = mj.get("enemies",[])
        all_p = mj.get("players", allies + enemies)
        bn = mj.get("battle_number", len(self.battle_list)+1)
        date = time.strftime("%d.%m.%Y %H:%M")
        # API: subscriber check
        nicks = [p["nick"] for p in all_p if p.get("nick")]
        res = api_check(nicks, self.cfg.get("api_url", API_URL))
        self.sub_nicks = set(v.get("wot_nickname","") for v in res.values())
        # API: Lesta win rates
        app_id = self.cfg.get("lesta_app_id") or DEFAULT_APP_ID
        if app_id:
            aids = [p.get("account_id") for p in all_p if p.get("account_id") and str(p.get("account_id")) not in self.wr_cache]
            if aids:
                self._log(f"🔎 Загружаю WR для {len(aids)} игроков...")
                threading.Thread(target=self._fetch_wr, args=(aids, app_id, bn), daemon=True).start()
        # Build battle record
        akills = sum(p.get("kills",0) for p in allies)
        ekills = sum(p.get("kills",0) for p in enemies)
        admg = sum(p.get("damage",0) for p in allies)
        edmg = sum(p.get("damage",0) for p in enemies)
        winner = None
        if akills >= 15 or (akills > ekills + 3): winner = "ally"
        elif ekills >= 15 or (ekills > akills + 3): winner = "enemy"
        elif admg > edmg * 1.2: winner = "ally"
        elif edmg > admg * 1.2: winner = "enemy"
        
        battle = {"battle_number": bn, "date": date, "allies": allies, "enemies": enemies, "winner": winner}
        self.current_view = battle
        has_dmg = any(p.get("damage",0) > 0 for p in all_p)
        if has_dmg:
            if not any(b["battle_number"] == bn for b in self.battle_list):
                self.battle_list.append(battle)
            for p in all_p:
                nk = p.get("nick","?"); is_s = nk in self.sub_nicks
                if nk not in self.db["players"]: self.db["players"][nk] = {"is_sub": is_s, "matches": []}
                self.db["players"][nk]["is_sub"] = is_s
                m = self.db["players"][nk]["matches"]
                if not m or m[-1].get("battle") != bn:
                    m.append({"battle": bn, "date": date, "tank": p.get("tank","?"), "dmg": p.get("damage",0), "kills": p.get("kills",0)})
            save_json(DATA_FILE, self.db)
            self._log(f"✅ Бой #{bn}: {len(allies)}A vs {len(enemies)}E")
        else:
            self._log(f"⏳ Бой #{bn}: ожидание...")
        self._refresh()

    def _fetch_wr(self, aids, app_id, bn):
        try:
            stats = lesta_fetch_stats(aids, app_id)
            self.wr_cache.update(stats)
            self.after(0, self._refresh)
            self.after(0, self._log, f"📊 WR загружен для {len(stats)} игроков")
        except: pass


# ============================================================
# LOCAL BOUNTY API SERVER (port 8091)
# ============================================================
from http.server import HTTPServer, BaseHTTPRequestHandler

BOUNTY_JSON = os.path.join(ROOT, "site", "obs", "bounty_session.json")
BOUNTY_HISTORY = os.path.join(ROOT, "site", "obs", "bounty_history.json")

def _bounty_read():
    try:
        if os.path.exists(BOUNTY_JSON):
            with open(BOUNTY_JSON, "r", encoding="utf-8") as f:
                return json.load(f)
    except: pass
    return {'status': 'stopped', 'total_damage_received': 0, 'total_gold_given': 0,
            'gold_rate': 1, 'attackers': {}, 'recent_hits': [], 'session_start': '', 'last_update': ''}

def _bounty_write(data):
    data['last_update'] = time.strftime("%Y-%m-%d %H:%M:%S")
    with open(BOUNTY_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def _bounty_save_history(d):
    if not d.get('session_start') or not d.get('total_damage_received'):
        return
    try:
        history = []
        if os.path.exists(BOUNTY_HISTORY):
            with open(BOUNTY_HISTORY, "r", encoding="utf-8") as f:
                history = json.load(f)
        session = {
            'session_start': d.get('session_start', ''),
            'session_end': time.strftime("%Y-%m-%d %H:%M:%S"),
            'total_damage': d.get('total_damage_received', 0),
            'total_gold': d.get('total_gold_given', 0),
            'gold_rate': d.get('gold_rate', 1),
            'attackers': d.get('attackers', {})
        }
        history.insert(0, session)
        history = history[:200]
        with open(BOUNTY_HISTORY, "w", encoding="utf-8") as f:
            json.dump(history, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[BountyLocalAPI] History save error: {e}")


class BountyHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Тихий лог

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _json_response(self, data, code=200):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self._cors()
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/api/bounty/session'):
            self._json_response(_bounty_read())
        elif self.path.startswith('/api/bounty/history'):
            try:
                h = []
                if os.path.exists(BOUNTY_HISTORY):
                    with open(BOUNTY_HISTORY, 'r', encoding='utf-8') as f:
                        h = json.load(f)
                self._json_response({'sessions': h})
            except:
                self._json_response({'sessions': []})
        elif self.path.startswith('/api/overlay/battle'):
            overlay_path = os.path.join(ROOT, 'site', 'obs', 'radar_results_overlay.json')
            try:
                if os.path.exists(overlay_path):
                    with open(overlay_path, 'r', encoding='utf-8') as f:
                        self._json_response(json.load(f))
                else:
                    self._json_response({'battle_number': 0, 'status': 'waiting', 'allies': [], 'enemies': []})
            except:
                self._json_response({'battle_number': 0, 'status': 'error', 'allies': [], 'enemies': []})
        elif self.path.startswith('/obs/'):
            fname = self.path.split('?')[0].replace('/obs/', '')
            fpath = os.path.join(ROOT, 'site', 'obs', fname)
            if os.path.exists(fpath) and fname.endswith('.html'):
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self._cors()
                self.end_headers()
                with open(fpath, 'rb') as f:
                    self.wfile.write(f.read())
            else:
                self._json_response({'error': 'not found'}, 404)
        else:
            self._json_response({'error': 'not found'}, 404)

    def do_POST(self):
        if self.path.startswith('/api/bounty/start'):
            d = _bounty_read()
            d['status'] = 'active'
            if not d.get('session_start'):
                d['session_start'] = time.strftime("%Y-%m-%d %H:%M:%S")
            _bounty_write(d)
            print("[BountyLocalAPI] ▶ Охота ЗАПУЩЕНА")
            self._json_response({'success': True, 'status': 'active'})

        elif self.path.startswith('/api/bounty/stop'):
            d = _bounty_read()
            _bounty_save_history(d)
            d['status'] = 'stopped'
            d['session_end'] = time.strftime("%Y-%m-%d %H:%M:%S")
            _bounty_write(d)
            print("[BountyLocalAPI] ⏹ Охота ОСТАНОВЛЕНА")
            self._json_response({'success': True, 'status': 'stopped'})

        elif self.path.startswith('/api/bounty/reset'):
            d = _bounty_read()
            _bounty_save_history(d)
            new_data = {
                'status': 'stopped',
                'session_start': '',
                'total_damage_received': 0, 'total_gold_given': 0, 'gold_rate': 1,
                'attackers': {}, 'recent_hits': [], 'participants_count': 0,
                'last_update': time.strftime("%Y-%m-%d %H:%M:%S")
            }
            _bounty_write(new_data)
            print("[BountyLocalAPI] 🔄 Охота СБРОШЕНА")
            self._json_response({'success': True, 'status': 'reset'})

        else:
            self._json_response({'error': 'not found'}, 404)


def _start_bounty_server():
    try:
        server = HTTPServer(('0.0.0.0', 8091), BountyHandler)
        print("[BountyLocalAPI] 🟢 Локальный сервер запущен на порту 8091")
        server.serve_forever()
    except Exception as e:
        print(f"[BountyLocalAPI] Ошибка запуска: {e}")


if __name__ == "__main__":
    # Запускаем локальный API для bounty в фоне
    bounty_thread = threading.Thread(target=_start_bounty_server, daemon=True)
    bounty_thread.start()
    RadarApp().mainloop()

