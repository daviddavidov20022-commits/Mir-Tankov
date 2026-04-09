# -*- coding: utf-8 -*-
"""
mod_container_tracker — Трекер открытия контейнеров
Перехватывает уведомления об открытии лутбоксов,
записывает результаты в container_results.json
"""
import BigWorld
import json
import os
import datetime
from gui import SystemMessages
from gui.shared.notifications import NotificationMVC
from gui.shared import g_eventBus, EVENT_BUS_SCOPE
from gui.shared.utils.requesters import REQ_CRITERIA

LOG_FILE = r'D:\mir-tankov-bot\site\obs\container_results.json'
SESSION_FILE = r'D:\mir-tankov-bot\site\obs\container_session.json'

# Текущая сессия
session_data = {
    'session_start': '',
    'total_opened': 0,
    'containers': {},
    'rewards': {
        'gold': 0,
        'credits': 0,
        'free_xp': 0,
        'premium_days': 0,
        'slots': 0
    },
    'items': {
        'boosters': 0,
        'crew_books': 0,
        'blueprints_national': 0,
        'blueprints_universal': 0,
        'blueprints_fragment': 0,
        'equipment_demount': 0,
        'customizations': 0
    },
    'vehicles': [],
    'last_update': ''
}


def show_msg(text):
    SystemMessages.pushMessage(text, type=SystemMessages.SM_TYPE.Information)


def save_session():
    """Сохраняет текущую сессию в JSON"""
    session_data['last_update'] = str(datetime.datetime.now())
    try:
        with open(SESSION_FILE, 'w') as f:
            json.dump(session_data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print("[ContainerTracker] Save error: %s" % str(e))


def format_number(n):
    """172400 -> 172.4k, 142500000 -> 142.5M"""
    if n >= 1000000:
        return "%.1fM" % (n / 1000000.0)
    elif n >= 1000:
        return "%.1fk" % (n / 1000.0)
    return str(n)


def process_lootbox_rewards(rewards, container_name='unknown'):
    """Обрабатывает награды из контейнера"""
    global session_data
    
    if not session_data['session_start']:
        session_data['session_start'] = str(datetime.datetime.now())
    
    session_data['total_opened'] += 1
    
    # Подсчёт типов контейнеров
    if container_name not in session_data['containers']:
        session_data['containers'][container_name] = 0
    session_data['containers'][container_name] += 1
    
    # Разбор наград
    if isinstance(rewards, dict):
        # Валюты
        session_data['rewards']['gold'] += rewards.get('gold', 0)
        session_data['rewards']['credits'] += rewards.get('credits', 0)
        session_data['rewards']['free_xp'] += rewards.get('freeXP', rewards.get('freeXp', 0))
        session_data['rewards']['premium_days'] += rewards.get('premium', 0)
        session_data['rewards']['slots'] += rewards.get('slots', 0)
        
        # Танки
        vehicles = rewards.get('vehicles', {})
        if vehicles:
            for v_cd in vehicles:
                session_data['vehicles'].append({
                    'compact_desc': v_cd,
                    'time': str(datetime.datetime.now())
                })
        
        # Предметы
        tokens = rewards.get('tokens', {})
        for token_name in tokens:
            tn = str(token_name).lower()
            if 'blueprint' in tn:
                if 'universal' in tn:
                    session_data['items']['blueprints_universal'] += 1
                elif 'national' in tn:
                    session_data['items']['blueprints_national'] += 1
                else:
                    session_data['items']['blueprints_fragment'] += 1
            elif 'booster' in tn or 'reserve' in tn:
                session_data['items']['boosters'] += 1
            elif 'crew' in tn or 'book' in tn:
                session_data['items']['crew_books'] += 1
            elif 'demount' in tn or 'dismantling' in tn:
                session_data['items']['equipment_demount'] += 1
            elif 'customization' in tn or 'style' in tn or 'camo' in tn:
                session_data['items']['customizations'] += 1
    
    save_session()
    
    # Уведомление
    gold_str = format_number(session_data['rewards']['gold'])
    credits_str = format_number(session_data['rewards']['credits'])
    xp_str = format_number(session_data['rewards']['free_xp'])
    show_msg(
        u"<font color='#FFC107'><b>📦 Контейнер #{num}:</b></font> "
        u"💰{gold} | 🪙{credits} | ⭐{xp}".format(
            num=session_data['total_opened'],
            gold=gold_str,
            credits=credits_str,
            xp=xp_str
        )
    )


def reset_session():
    """Сбрасывает сессию (вызвать перед началом нового открытия)"""
    global session_data
    session_data = {
        'session_start': str(datetime.datetime.now()),
        'total_opened': 0,
        'containers': {},
        'rewards': {'gold': 0, 'credits': 0, 'free_xp': 0, 'premium_days': 0, 'slots': 0},
        'items': {
            'boosters': 0, 'crew_books': 0,
            'blueprints_national': 0, 'blueprints_universal': 0,
            'blueprints_fragment': 0, 'equipment_demount': 0,
            'customizations': 0
        },
        'vehicles': [],
        'last_update': ''
    }
    save_session()
    show_msg(u"<font color='#4ade80'><b>📦 ContainerTracker:</b></font> Сессия сброшена! Готов к отслеживанию.")


def load_session():
    """Загружает предыдущую сессию если есть"""
    global session_data
    try:
        if os.path.exists(SESSION_FILE):
            with open(SESSION_FILE, 'r') as f:
                session_data = json.load(f)
    except:
        pass


# ============================================
# HOOKS — перехват открытия контейнеров
# ============================================
try:
    from gui.server_events import events_dispatcher
    from gui.shared.gui_items.processors import loot_boxes as lb_proc
    
    # Monkey-patch на открытие лутбоксов
    _original_open = lb_proc.LootBoxOpenProcessor._successHandler if hasattr(lb_proc, 'LootBoxOpenProcessor') else None
    
    if _original_open:
        def _patched_open(self, code, ctx=None):
            _original_open(self, code, ctx)
            try:
                rewards = ctx.get('bonus', {}) if ctx else {}
                container_name = getattr(self, '_lootBoxItem', {})
                if hasattr(container_name, 'getUserName'):
                    container_name = container_name.getUserName()
                else:
                    container_name = str(container_name)
                process_lootbox_rewards(rewards, container_name)
            except Exception as e:
                print("[ContainerTracker] Hook error: %s" % str(e))
        
        lb_proc.LootBoxOpenProcessor._successHandler = _patched_open
        print("[ContainerTracker] Lootbox hook installed successfully!")
    else:
        print("[ContainerTracker] Warning: LootBoxOpenProcessor not found, using fallback mode")
except Exception as e:
    print("[ContainerTracker] Hook setup error: %s" % str(e))
    print("[ContainerTracker] Will use manual/API mode instead")


# ============================================
# LOBBY READY
# ============================================
def on_lobby_ready(*args):
    try:
        if getattr(BigWorld, 'ct_shown', False):
            return
        load_session()
        if session_data['total_opened'] > 0:
            show_msg(
                u"<font color='#FFC107'><b>📦 ContainerTracker:</b></font> "
                u"Загружена сессия: %d контейнеров" % session_data['total_opened']
            )
        else:
            show_msg(u"<font color='#4ade80'><b>📦 ContainerTracker:</b></font> Активен и готов! ✅")
        BigWorld.ct_shown = True
    except:
        pass

BigWorld.callback(5.0, on_lobby_ready)

print("[ContainerTracker] Mod loaded. Session file: %s" % SESSION_FILE)
