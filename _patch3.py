import re

with open('site/js/arena.js', 'r', encoding='utf-8') as f:
    text = f.read()

old_block1 = '''        const adminBadge = u.is_super_admin
            ? '<span style="color:#C8AA6E;font-weight:700">👑 Гл. Админ</span>'
            : (u.is_admin
                ? '<span style="color:#4ade80">🛡 Админ</span>'
                : '');

        const toggleBtn = u.is_super_admin ? '' : `
            <button onclick="toggleAdmin(${u.telegram_id})" 
                style="padding:5px 10px;border-radius:6px;font-size:0.6rem;cursor:pointer;
                border:1px solid ${u.is_admin ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'};
                background:${u.is_admin ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)'};
                color:${u.is_admin ? '#ef4444' : '#4ade80'}">
                ${u.is_admin ? '❌ Снять' : '✅ Дать админку'}
            </button>`;

        const giftBtn = `
            <button onclick="openGiftModal(${u.telegram_id}, '${(u.wot_nickname || u.first_name || '').replace(/'/g, "\\\\\\'")}')" 
                style="padding:5px 10px;border-radius:6px;font-size:0.6rem;cursor:pointer;margin-top:4px;
                border:1px solid rgba(200,170,110,0.3);background:rgba(200,170,110,0.08);color:#C8AA6E">
                🎁 Подарить 🧀
            </button>`;

        return `
            <div class="duel-card" style="margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;align-items:flex-start">
                    <div style="flex:1;min-width:0">
                        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                            <span style="font-family:'Russo One',sans-serif;font-size:0.8rem;color:#E8E6E3">
                                ${u.wot_nickname || u.first_name || 'Без имени'}
                            </span>
                            ${adminBadge}
                        </div>
                        <div style="font-size:0.6rem;color:#5A6577;margin-top:3px">
                            TG: ${u.username ? '@' + u.username : '—'} · ID: ${u.telegram_id}
                        </div>
                        <div style="font-size:0.6rem;color:#5A6577;margin-top:2px">
                            🎮 ${u.wot_nickname || '—'} · 🧀 ${u.cheese.toLocaleString('ru')} · ${subInfo} ${method}
                        </div>
                    </div>
                    <div style="flex-shrink:0;margin-left:8px;display:flex;flex-direction:column;align-items:flex-end">
                        ${toggleBtn}
                        ${giftBtn}
                    </div>
                </div>
            </div>`;'''

new_block1 = '''        const adminBadge = u.is_super_admin
            ? '<span style="color:#C8AA6E;font-weight:700">👑 Гл. Админ</span>'
            : (u.is_admin
                ? '<span style="color:#4ade80">🛡 Админ</span>'
                : '');

        const blockedBadge = u.is_blocked
            ? '<span style="color:#ef4444;font-weight:700;margin-left:6px">🚫 Заблокирован</span>'
            : '';

        let fnNameInput = u.wot_nickname || u.first_name || '';
        if (typeof fnNameInput !== 'string') fnNameInput = String(fnNameInput);
        const safeName = fnNameInput.replace(/'/g, "\\\\\'").replace(/"/g, "&quot;");

        const toggleBtn = u.is_super_admin ? '' : `
            <button onclick="toggleAdmin(${u.telegram_id})" 
                style="padding:5px 10px;border-radius:6px;font-size:0.6rem;cursor:pointer;
                border:1px solid ${u.is_admin ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'};
                background:${u.is_admin ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)'};
                color:${u.is_admin ? '#ef4444' : '#4ade80'}">
                ${u.is_admin ? '❌ Снять' : '✅ Дать админку'}
            </button>`;

        const deleteBtn = u.is_super_admin ? '' : `
            <button onclick="adminDeleteUser(${u.telegram_id}, '${safeName}')" 
                style="padding:5px 10px;border-radius:6px;font-size:0.6rem;cursor:pointer;
                border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.08);color:#ef4444">
                🗑 Удалить
            </button>`;

        const blockBtn = u.is_super_admin ? '' : `
            <button onclick="adminBlockUser(${u.telegram_id}, '${safeName}', ${!u.is_blocked})" 
                style="padding:5px 10px;border-radius:6px;font-size:0.6rem;cursor:pointer;
                border:1px solid rgba(245,158,11,0.3);background:rgba(245,158,11,0.08);color:#f59e0b">
                ${u.is_blocked ? '✅ Разблокировать' : '🚫 Заблокировать'}
            </button>`;

        const giftBtn = `
            <button onclick="openGiftModal(${u.telegram_id}, '${safeName}')" 
                style="padding:5px 10px;border-radius:6px;font-size:0.6rem;cursor:pointer;
                border:1px solid rgba(200,170,110,0.3);background:rgba(200,170,110,0.08);color:#C8AA6E">
                🎁 Подарить 🧀
            </button>`;

        return `
            <div class="duel-card" style="margin-bottom:8px; ${u.is_blocked ? 'opacity:0.6;border:1px solid rgba(239,68,68,0.3);' : ''}">
                <div style="display:flex;justify-content:space-between;align-items:flex-start">
                    <div style="flex:1;min-width:0">
                        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                            <span style="font-family:'Russo One',sans-serif;font-size:0.8rem;color:#E8E6E3">
                                ${u.wot_nickname || u.first_name || 'Без имени'}
                            </span>
                            ${adminBadge} ${blockedBadge}
                        </div>
                        <div style="font-size:0.6rem;color:#5A6577;margin-top:3px">
                            TG: ${u.username ? '@' + u.username : '—'} · ID: ${u.telegram_id}
                        </div>
                        <div style="font-size:0.6rem;color:#5A6577;margin-top:2px">
                            🎮 ${u.wot_nickname || '—'} · 🧀 ${u.cheese.toLocaleString('ru')} · ${subInfo} ${method}
                        </div>
                    </div>
                    <div style="flex-shrink:0;margin-left:8px;display:flex;flex-direction:column;align-items:flex-end">
                        <div style="display:flex; gap:4px; margin-bottom:4px; justify-content:flex-end; width:100%;">
                            ${toggleBtn}
                            ${giftBtn}
                        </div>
                        <div style="display:flex; gap:4px; justify-content:flex-end; width:100%;">
                            ${blockBtn}
                            ${deleteBtn}
                        </div>
                    </div>
                </div>
            </div>`;'''

text = text.replace(old_block1, new_block1)

# Appending functions adminDeleteUser and adminBlockUser at the very bottom
functions_block = r'''
async function adminDeleteUser(targetId, name) {
    if(!confirm(`Вы уверены, что хотите УДАЛИТЬ пользователя ${name}? Он сможет заново зарегистрироваться.`)) return;
    
    try {
        const resp = await fetch(`${BOT_API_URL}/api/admin/delete-user`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ admin_telegram_id: myTelegramId, target_telegram_id: targetId })
        });
        const d = await resp.json();
        if(d.error) return alert(d.error);
        alert(d.message || "Удалено");
        loadAdminUsers();
    } catch(e) {
        alert("Ошибка сети");
    }
}

async function adminBlockUser(targetId, name, doBlock) {
    const actionName = doBlock ? 'ЗАБЛОКИРОВАТЬ' : 'РАЗБЛОКИРОВАТЬ';
    if(!confirm(`Вы уверены, что хотите ${actionName} пользователя ${name}?`)) return;

    let reason = "Нарушение правил";
    if (doBlock) {
        reason = prompt("Причина блокировки:", "Нарушение правил");
        if (reason === null) return;
    }

    try {
        const resp = await fetch(`${BOT_API_URL}/api/admin/block-user`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                admin_telegram_id: myTelegramId, 
                target_telegram_id: targetId,
                action: doBlock ? 'block' : 'unblock',
                reason: reason || "Нарушение правил"
            })
        });
        const d = await resp.json();
        if(d.error) return alert(d.error);
        alert(d.message || "Успешно");
        loadAdminUsers();
    } catch(e) {
        alert("Ошибка сети");
    }
}
'''
if "async function adminDeleteUser" not in text:
    text += functions_block

# Fix CONDITION_LABELS as requested before!
old_labels = '''const CONDITION_LABELS = {
    'total_damage': '⚡ Урон',
    'total_frags': '💀 Фраги',
    'total_spotted': '👁 Засвет',
    'total_blocked': '🛡 Заблокировано',
    'total_xp': '⭐ Опыт'
};

const COND_DISPLAY = {
    total_damage: 'Средний урон',
    total_frags: 'Средние фраги',
    total_spotted: 'Средний засвет',
    total_blocked: 'Средний блок',
    total_xp: 'Средний опыт'
};'''
new_labels = '''const CONDITION_LABELS = {
    'total_damage': '⚡ Суммарка',
    'total_frags': '💀 Фраги',
    'total_spotted': '👁 Помощь в ун.',
    'total_blocked': '🛡 Заблокировано',
    'total_xp': '⭐ Опыт'
};

const COND_DISPLAY = {
    total_damage: 'Суммарка',
    total_frags: 'Средние фраги',
    total_spotted: 'Помощь в ун.',
    total_blocked: 'Суммарный блок',
    total_xp: 'Средний опыт'
};'''

text = text.replace(old_labels, new_labels)

# Also fix td spotting logic
text = text.replace("<td>${p[vStatus.condition] || 0}</td>", "<td>${p[vStatus.condition==='total_spotted'?'spotting':vStatus.condition] || 0}</td>")

with open('site/js/arena.js', 'w', encoding='utf-8') as f:
    f.write(text)

import shutil
shutil.copy2('site/js/arena.js', 'webapp/js/arena.js')
print("Patch successful.")
