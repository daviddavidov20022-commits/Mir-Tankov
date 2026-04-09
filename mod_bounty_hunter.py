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

LOG_FILE = r'D:\mir-tankov-bot\site\obs\bounty_session.json'

def get_session():
    try:
        if os.path.exists(LOG_FILE):
            with open(LOG_FILE, 'r') as f:
                return json.load(f)
    except:
        pass
    return {
        'status': 'stopped',
        'session_start': '',
        'total_damage_received': 0,
        'total_gold_given': 0,
        'gold_rate': 1,
        'attackers': {},
        'recent_hits': [],
        'last_update': ''
    }

def save_session(data):
    data['last_update'] = str(datetime.datetime.now())
    try:
        with open(LOG_FILE, 'w') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print("[BountyHunter] Save error: %s" % str(e))

# ============================================
# HOOKS — перехват изменения ХП танка
# ============================================
old_onHealthChanged = PlayerAvatar.onHealthChanged

def new_onHealthChanged(self, newHealth, attackerID, attackReasonID):
    # Пытаемся получить старое ХП, чтобы вычислить урон
    old_health = getattr(self, '_BH_lastHealth', self.health)
    damage = old_health - newHealth
    self._BH_lastHealth = newHealth

    if damage > 0 and attackerID != 0 and attackerID != getattr(self, 'playerVehicleID', 0):
        try:
            bounty_data = get_session()
            if bounty_data.get('status') == 'stopped':
                # Охота остановлена
                pass
            else:
                arena = getattr(self, 'arena', None)
                if arena:
                    vehicles = arena.vehicles
                    if attackerID in vehicles:
                        attacker_name = str(vehicles[attackerID].get('name', 'Unknown'))
                        
                        # Инициализируем сессию если нужно
                        if not bounty_data.get('session_start'):
                            bounty_data['session_start'] = str(datetime.datetime.now())
                        if 'attackers' not in bounty_data:
                            bounty_data['attackers'] = {}
                        if 'recent_hits' not in bounty_data:
                            bounty_data['recent_hits'] = []
                        if 'total_damage_received' not in bounty_data:
                            bounty_data['total_damage_received'] = 0
                        if 'total_gold_given' not in bounty_data:
                            bounty_data['total_gold_given'] = 0
                            
                        if attacker_name not in bounty_data['attackers']:
                            bounty_data['attackers'][attacker_name] = {'damage': 0, 'tank': vehicles[attackerID].get('vehicleType', {}).get('name', 'Unknown')}
                            
                        if isinstance(bounty_data['attackers'][attacker_name], dict):
                            bounty_data['attackers'][attacker_name]['damage'] += int(damage)
                        else:
                            # Migrate old data
                            old_dmg = bounty_data['attackers'][attacker_name]
                            bounty_data['attackers'][attacker_name] = {'damage': old_dmg + int(damage), 'tank': 'Unknown'}
                            
                        bounty_data['total_damage_received'] += int(damage)
                        
                        gold_rate = bounty_data.get('gold_rate', 1)
                        gold_earned = int(damage * gold_rate)
                        bounty_data['total_gold_given'] += gold_earned
                        
                        # Добавляем в историю (оставляем только 5 последних)
                        hit = {
                            'name': attacker_name,
                            'tank': bounty_data['attackers'][attacker_name].get('tank', 'Unknown'),
                            'damage': int(damage),
                            'gold': gold_earned,
                            'time': str(datetime.datetime.now())
                        }
                        bounty_data['recent_hits'].insert(0, hit)
                        bounty_data['recent_hits'] = bounty_data['recent_hits'][:5]
                        
                        save_session(bounty_data)
        except Exception as e:
            print("[BountyHunter] Error tracking damage: %s" % str(e))

    old_onHealthChanged(self, newHealth, attackerID, attackReasonID)

# Устанавливаем хук
PlayerAvatar.onHealthChanged = new_onHealthChanged

print("[BountyHunter] Mod loaded! Tracking incoming damage.")
