# -*- coding: utf-8 -*-
import json
import os
import traceback
import BigWorld
from PlayerEvents import g_playerEvents

LOG_FILE = os.path.join(os.getcwd(), 'radar_results.json')
COUNT_FILE = os.path.join(os.getcwd(), 'radar_battle_count.txt')
DEBUG_FILE = os.path.join(os.getcwd(), 'radar_debug.txt')

_arena_data = {}
_player_team = 0
_capture_retries = 0

def _dbg(msg):
    try:
        with open(DEBUG_FILE, 'a') as f:
            f.write(str(msg) + '\n')
    except:
        pass

def _load_count():
    try: return int(open(COUNT_FILE).read().strip())
    except: return 0

def _on_avatar_ready():
    global _capture_retries
    _capture_retries = 0
    _dbg('=== onAvatarBecomePlayer -> scheduling capture ===')
    BigWorld.callback(2.0, _capture_arena)

def _capture_arena():
    global _arena_data, _player_team, _capture_retries
    _capture_retries += 1
    _dbg('_capture_arena attempt #' + str(_capture_retries))
    try:
        player = BigWorld.player()
        if player is None:
            _dbg('player is None')
            if _capture_retries < 15:
                BigWorld.callback(3.0, _capture_arena)
            return
        _player_team = getattr(player, 'team', 0)
        arena = getattr(player, 'arena', None)
        if arena is None:
            _dbg('arena is None')
            if _capture_retries < 15:
                BigWorld.callback(3.0, _capture_arena)
            return
        vehicles = getattr(arena, 'vehicles', {})
        vcount = len(vehicles) if vehicles else 0
        _dbg('team=' + str(_player_team) + ' vehicles=' + str(vcount))
        if vcount == 0 or _player_team == 0:
            _dbg('not ready yet, retry in 3s...')
            if _capture_retries < 15:
                BigWorld.callback(3.0, _capture_arena)
            return
        # GOT DATA - capture it!
        _arena_data = {}
        count = 0
        for v_id, v_info in vehicles.items():
            name = v_info.get('name', 'Unknown')
            acc_id = str(v_info.get('accountDBID', 0))
            team = v_info.get('team', 0)
            side = 'ally' if team == _player_team else 'enemy'
            v_type = v_info.get('vehicleType', None)
            tank = 'Unknown'
            if v_type is not None:
                try: tank = v_type.type.shortUserString
                except:
                    try: tank = str(v_type.name).split(':')[-1]
                    except: pass
            entry = {'nick': name, 'tank': tank, 'side': side, 'account_id': acc_id}
            _arena_data[acc_id] = entry
            _arena_data[str(v_id)] = entry
            count += 1
        _dbg('SUCCESS! captured ' + str(count) + ' vehicles')
        if count > 0:
            sample = list(_arena_data.values())[0]
            _dbg('sample: ' + str(sample))
    except:
        _dbg('ERROR:\n' + traceback.format_exc())
        if _capture_retries < 15:
            BigWorld.callback(3.0, _capture_arena)

def _on_results(isPlayerVehicle, results):
    _dbg('=== _on_results ===')
    _dbg('arena_data keys: ' + str(len(_arena_data)))
    try:
        if not results:
            _dbg('no results'); return
        vehicles = results.get('vehicles', {})
        allies = []
        enemies = []
        matched = 0
        for v_id, v_stats in vehicles.items():
            stats = v_stats[0] if isinstance(v_stats, list) else v_stats
            acc_id = str(stats.get('accountDBID', v_id))
            dmg = int(stats.get('damageDealt', 0))
            kills = int(stats.get('kills', 0))
            info = _arena_data.get(acc_id, _arena_data.get(str(v_id), {}))
            if info:
                matched += 1
            nick = info.get('nick', acc_id)
            tank = info.get('tank', 'Unknown')
            side = info.get('side', 'enemy')
            entry = {'nick': nick, 'tank': tank, 'damage': dmg, 'kills': kills, 'account_id': acc_id}
            if side == 'ally':
                allies.append(entry)
            else:
                enemies.append(entry)
        _dbg('matched: ' + str(matched) + '/' + str(len(vehicles)))
        bc = _load_count() + 1
        try:
            with open(COUNT_FILE, 'w') as f: f.write(str(bc))
        except: pass
        allies.sort(key=lambda x: x['damage'], reverse=True)
        enemies.sort(key=lambda x: x['damage'], reverse=True)
        with open(LOG_FILE, 'w') as f:
            json.dump({
                'battle_number': bc,
                'allies': allies,
                'enemies': enemies,
                'players': allies + enemies
            }, f, indent=2)
        _dbg('SAVED #' + str(bc) + ': ' + str(len(allies)) + 'A/' + str(len(enemies)) + 'E')
    except:
        _dbg('ERROR:\n' + traceback.format_exc())

g_playerEvents.onAvatarBecomePlayer += _on_avatar_ready
g_playerEvents.onBattleResultsReceived += _on_results
_dbg('=== MOD v5.4 LOADED ===')
print '[RadarHelper] v5.4 loaded'
