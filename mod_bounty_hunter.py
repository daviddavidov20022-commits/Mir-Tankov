# -*- coding: utf-8 -*-
"""
mod_bounty_hunter — Трекер получения урона от охотников
Записывает, кто и сколько урона нанес стримеру.
"""
import BigWorld
import json
import os
import datetime
from Avatar import PlayerAvatar

LOG_FILE = os.path.join(BigWorld.wd, 'bounty_session.json')

bounty_data = {
    'session_start': '',
    'total_damage_received': 0,
    'total_gold_given': 0,
    'gold_rate': 1, # 1 урона = 1 золото
    'attackers': {}, # name -> total_damage
    'recent_hits': [], # Список последних 5 попаданий
    'last_update': ''
}

def save_session():
    bounty_data['last_update'] = str(datetime.datetime.now())
    try:
        with open(LOG_FILE, 'w') as f:
            json.dump(bounty_data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print("[BountyHunter] Save error: %s" % str(e))

def reset_session():
    bounty_data['session_start'] = str(datetime.datetime.now())
    bounty_data['total_damage_received'] = 0
    bounty_data['total_gold_given'] = 0
    bounty_data['attackers'] = {}
    bounty_data['recent_hits'] = []
    save_session()

# ============================================
# HOOKS — перехват изменения ХП танка
# ============================================
old_onHealthChanged = PlayerAvatar.onHealthChanged

def new_onHealthChanged(self, newHealth, attackerID, attackReasonID):
    global bounty_data
    
    # Пытаемся получить старое ХП, чтобы вычислить урон
    old_health = getattr(self, '_BH_lastHealth', self.health)
    damage = old_health - newHealth
    self._BH_lastHealth = newHealth

    if damage > 0 and attackerID != 0 and attackerID != getattr(self, 'playerVehicleID', 0):
        try:
            arena = getattr(self, 'arena', None)
            if arena:
                vehicles = arena.vehicles
                if attackerID in vehicles:
                    attacker_name = str(vehicles[attackerID].get('name', 'Unknown'))
                    
                    # Инициализируем сессию если нужно
                    if not bounty_data['session_start']:
                        bounty_data['session_start'] = str(datetime.datetime.now())
                    
                    if attacker_name not in bounty_data['attackers']:
                        bounty_data['attackers'][attacker_name] = 0
                        
                    bounty_data['attackers'][attacker_name] += int(damage)
                    bounty_data['total_damage_received'] += int(damage)
                    
                    gold_earned = int(damage * bounty_data['gold_rate'])
                    bounty_data['total_gold_given'] += gold_earned
                    
                    # Добавляем в историю (оставляем только 5 последних)
                    hit = {
                        'name': attacker_name,
                        'damage': int(damage),
                        'gold': gold_earned,
                        'time': str(datetime.datetime.now())
                    }
                    bounty_data['recent_hits'].insert(0, hit)
                    bounty_data['recent_hits'] = bounty_data['recent_hits'][:5]
                    
                    save_session()
        except Exception as e:
            print("[BountyHunter] Error tracking damage: %s" % str(e))

    old_onHealthChanged(self, newHealth, attackerID, attackReasonID)

# Устанавливаем хук
PlayerAvatar.onHealthChanged = new_onHealthChanged

print("[BountyHunter] Mod loaded! Tracking incoming damage.")
