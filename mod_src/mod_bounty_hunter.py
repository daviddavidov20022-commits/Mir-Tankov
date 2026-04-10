# -*- coding: utf-8 -*-
"""
mod_bounty_hunter — Трекер урона от охотников
Перехватывает урон по танку стримера, записывает в JSON.
Python 2.7! (BigWorld)
"""
import json
import os
import traceback
import BigWorld
from PlayerEvents import g_playerEvents

# Пишем в папку OBS-виджета
LOG_FILE = r'D:\mir-tankov-bot\site\obs\bounty_session.json'
DEBUG_FILE = os.path.join(os.getcwd(), 'bounty_debug.txt')

_arena_data = {}       # vehicle_id -> {nick, tank, team, account_id}
_player_team = 0
_player_vehicle_id = 0
_capture_retries = 0

# Данные сессии
_session = {
    'session_start': '',
    'total_damage_received': 0,
    'total_gold_given': 0,
    'gold_rate': 1,
    'attackers': {},
    'recent_hits': [],
    'participants_count': 0,
    'last_update': ''
}


def _dbg(msg):
    try:
        with open(DEBUG_FILE, 'a') as f:
            f.write(str(msg) + '\n')
    except:
        pass


def _load_session():
    """Загружает сессию из JSON (для синхронизации с вебом)"""
    global _session
    try:
        if os.path.exists(LOG_FILE):
            with open(LOG_FILE, 'r') as f:
                data = json.load(f)
            # Обновляем _session из файла
            _session.update(data)
            _dbg('session loaded from file')
    except:
        _dbg('LOAD ERROR:\n' + traceback.format_exc())
    return _session


def _save_session():
    import datetime
    _session['last_update'] = str(datetime.datetime.now())
    try:
        with open(LOG_FILE, 'w') as f:
            json.dump(_session, f, indent=2, ensure_ascii=False)
        _dbg('session saved OK')
    except:
        _dbg('SAVE ERROR:\n' + traceback.format_exc())


def _on_avatar_ready():
    global _capture_retries
    _capture_retries = 0
    _dbg('=== BountyHunter: onAvatarBecomePlayer ===')
    # Сбросим данные арены для нового боя
    global _arena_data, _player_team, _player_vehicle_id
    _arena_data = {}
    _player_team = 0
    _player_vehicle_id = 0
    BigWorld.callback(2.0, _capture_arena)


def _capture_arena():
    global _arena_data, _player_team, _player_vehicle_id, _capture_retries
    _capture_retries += 1
    _dbg('capture attempt #' + str(_capture_retries))

    try:
        player = BigWorld.player()
        if player is None:
            _dbg('player is None')
            if _capture_retries < 15:
                BigWorld.callback(3.0, _capture_arena)
            return

        _player_team = getattr(player, 'team', 0)
        _player_vehicle_id = getattr(player, 'playerVehicleID', 0)

        arena = getattr(player, 'arena', None)
        if arena is None:
            _dbg('arena is None')
            if _capture_retries < 15:
                BigWorld.callback(3.0, _capture_arena)
            return

        vehicles = getattr(arena, 'vehicles', {})
        vcount = len(vehicles) if vehicles else 0
        _dbg('team=' + str(_player_team) + ' vehicles=' + str(vcount) + ' myVehID=' + str(_player_vehicle_id))

        if vcount == 0 or _player_team == 0:
            if _capture_retries < 15:
                BigWorld.callback(3.0, _capture_arena)
            return

        # Захватили арену!
        _arena_data = {}
        for v_id, v_info in vehicles.items():
            name = v_info.get('name', 'Unknown')
            team = v_info.get('team', 0)
            acc_id = str(v_info.get('accountDBID', 0))
            _arena_data[v_id] = {
                'nick': name,
                'team': team,
                'account_id': acc_id
            }

        _dbg('captured ' + str(len(_arena_data)) + ' vehicles')

        # Загружаем сессию из файла (мог измениться через веб-API)
        _load_session()

        # Инициируем сессию если пустая
        import datetime
        if not _session['session_start']:
            _session['session_start'] = str(datetime.datetime.now())
            _save_session()

        # Начинаем мониторить урон
        _start_health_monitoring()

    except:
        _dbg('capture ERROR:\n' + traceback.format_exc())
        if _capture_retries < 15:
            BigWorld.callback(3.0, _capture_arena)


def _start_health_monitoring():
    """Хукаем Vehicle.onHealthChanged на каждой машинке"""
    _dbg('Starting health monitoring...')
    try:
        from Vehicle import Vehicle
        if not hasattr(Vehicle, '_BH_orig_onHealthChanged'):
            Vehicle._BH_orig_onHealthChanged = Vehicle.onHealthChanged
            Vehicle.onHealthChanged = _hooked_onHealthChanged
            _dbg('Vehicle.onHealthChanged HOOKED OK')
        else:
            _dbg('Already hooked')
    except:
        _dbg('HOOK ERROR:\n' + traceback.format_exc())


def _hooked_onHealthChanged(self, newHealth, oldHealth, attackerID, attackReasonID):
    """Перехватчик изменения ХП на Vehicle"""
    try:
        # Вызываем оригинал
        self._BH_orig_onHealthChanged(newHealth, oldHealth, attackerID, attackReasonID)
    except:
        pass

    try:
        # Нас интересует только урон по НАШЕМУ танку
        if not _player_vehicle_id:
            return
        if self.id != _player_vehicle_id:
            return

        # Проверяем статус сессии из файла
        _load_session()
        if _session.get('status') == 'stopped':
            return

        damage = oldHealth - newHealth
        if damage <= 0:
            return
        if attackerID == 0 or attackerID == _player_vehicle_id:
            return  # самоурон или неизвестный

        attacker = _arena_data.get(attackerID, {})
        attacker_name = attacker.get('nick', 'Unknown_' + str(attackerID))
        attacker_team = attacker.get('team', 0)

        # Урон только от противников
        if attacker_team == _player_team and _player_team != 0:
            return

        # Получаем танк атакующего из арены
        attacker_tank = 'Unknown'
        try:
            player = BigWorld.player()
            if player and hasattr(player, 'arena') and player.arena:
                veh_info = player.arena.vehicles.get(attackerID, {})
                v_type = veh_info.get('vehicleType', None)
                if v_type is not None:
                    try:
                        attacker_tank = v_type.type.shortUserString
                    except:
                        try:
                            attacker_tank = str(v_type.name).split(':')[-1]
                        except:
                            pass
        except:
            pass

        _dbg('HIT! ' + attacker_name + ' (' + attacker_tank + ') -> ' + str(damage) + ' dmg')

        # Обновляем статистику (объектный формат)
        if attacker_name not in _session['attackers']:
            _session['attackers'][attacker_name] = {'damage': 0, 'tank': attacker_tank}
        
        att = _session['attackers'][attacker_name]
        if isinstance(att, dict):
            att['damage'] += int(damage)
            if att.get('tank', 'Unknown') == 'Unknown' and attacker_tank != 'Unknown':
                att['tank'] = attacker_tank
        else:
            # Миграция со старого формата (число)
            _session['attackers'][attacker_name] = {'damage': int(att) + int(damage), 'tank': attacker_tank}
        
        _session['total_damage_received'] += int(damage)

        gold = int(damage * _session['gold_rate'])
        _session['total_gold_given'] += gold

        import datetime
        hit = {
            'name': attacker_name,
            'tank': attacker_tank,
            'damage': int(damage),
            'gold': gold,
            'time': str(datetime.datetime.now())
        }
        _session['recent_hits'].insert(0, hit)
        _session['recent_hits'] = _session['recent_hits'][:5]

        _save_session()

    except:
        _dbg('HIT ERROR:\n' + traceback.format_exc())


# Регистрируем хук на вход в бой
g_playerEvents.onAvatarBecomePlayer += _on_avatar_ready

_dbg('=== BountyHunter v1.0 LOADED ===')
print '[BountyHunter] v1.0 loaded'
