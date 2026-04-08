import glob
import re
import os
import shutil

css_patch = """
/* ==========================================
   DESKTOP RESPONSIVE OVERHAUL
   ========================================== */
.desktop-sidebar {
    display: none;
}

@media (min-width: 900px) {
    body {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
    }
    
    .desktop-sidebar {
        display: flex !important;
        flex-direction: column;
        position: fixed;
        left: 0;
        top: 0;
        bottom: 0;
        width: 260px;
        background: linear-gradient(180deg, #111820 0%, #0a0e14 100%);
        border-right: 1px solid rgba(200, 170, 110, 0.15);
        padding: 24px 16px;
        overflow-y: auto;
        z-index: 1000;
        box-shadow: 4px 0 24px rgba(0,0,0,0.4);
    }
    
    .desktop-sidebar__brand {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 40px;
        color: #C8AA6E;
        text-decoration: none;
    }
    .desktop-sidebar__brand svg {
        width: 36px;
        height: 36px;
    }
    .desktop-sidebar__brand-text {
        font-family: 'Russo One', sans-serif;
        font-size: 1.1rem;
        line-height: 1.1;
    }
    .desktop-sidebar__brand-sub {
        font-family: 'Inter', sans-serif;
        font-size: 0.65rem;
        color: #9AA4B5;
        font-weight: 600;
        letter-spacing: 1px;
    }
    
    .desktop-sidebar__section {
        margin-bottom: 24px;
    }
    .desktop-sidebar__label {
        font-size: 0.65rem;
        color: #5A6577;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: 8px;
        font-weight: 700;
        padding-left: 12px;
    }
    .desktop-sidebar__link {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        color: #E8E6E3;
        text-decoration: none;
        border-radius: 8px;
        font-size: 0.85rem;
        font-weight: 500;
        transition: all 0.2s ease;
    }
    .desktop-sidebar__link:hover {
        background: rgba(200, 170, 110, 0.1);
        color: #C8AA6E;
    }
    .desktop-sidebar__icon {
        font-size: 1.2rem;
        width: 24px;
        text-align: center;
    }
    
    .top-navbar {
        width: calc(100% - 260px) !important;
        left: 260px !important;
    }
    main, .main-content, .hero, .landing-section, .twitch-player-section, .daily-reward-section, .quick-actions, .site-footer {
        width: calc(100% - 260px) !important;
        margin-left: 260px !important;
        max-width: 1200px !important;
    }
    .hero__content {
        padding-top: 40px !important;
    }
    
    .bottom-nav {
        display: none !important;
    }
    
    .games-grid, .features-grid, .platforms-grid {
        grid-template-columns: repeat(3, 1fr) !important;
    }
    
    .menu-list {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
    }
}
"""

sidebar_html = """
<!-- DESKTOP SIDEBAR OVERLAY -->
<aside class="desktop-sidebar">
    <a href="index.html" class="desktop-sidebar__brand">
        <svg viewBox="0 0 44 44" fill="none">
            <rect x="4" y="26" width="36" height="12" rx="3" fill="#C8AA6E"/>
            <rect x="11" y="17" width="22" height="13" rx="2" fill="#A08750"/>
            <rect x="23" y="11" width="16" height="9" rx="2" fill="#8B7040"/>
            <circle cx="10" cy="42" r="5" fill="#2a2a2a" stroke="#C8AA6E" stroke-width="2"/>
            <circle cx="22" cy="42" r="5" fill="#2a2a2a" stroke="#C8AA6E" stroke-width="2"/>
            <circle cx="34" cy="42" r="5" fill="#2a2a2a" stroke="#C8AA6E" stroke-width="2"/>
        </svg>
        <div>
            <div class="desktop-sidebar__brand-text">МИР ТАНКОВ</div>
            <div class="desktop-sidebar__brand-sub">КЛУБ ISERVERI</div>
        </div>
    </a>
    
    <div class="desktop-sidebar__section">
        <div class="desktop-sidebar__label">Навигация</div>
        <a href="index.html" class="desktop-sidebar__link" onclick="if(typeof openGame !== 'undefined'){event.preventDefault(); openGame('index.html');}"><span class="desktop-sidebar__icon">🏠</span> Главная</a>
        <a href="profile.html" class="desktop-sidebar__link" onclick="if(typeof openGame !== 'undefined'){event.preventDefault(); openGame('profile.html');}"><span class="desktop-sidebar__icon">👤</span> Профиль</a>
        <a href="stats.html" class="desktop-sidebar__link" onclick="if(typeof openGame !== 'undefined'){event.preventDefault(); openGame('stats.html');}"><span class="desktop-sidebar__icon">📊</span> Статика WN8</a>
        <a href="player.html" class="desktop-sidebar__link" onclick="if(typeof openGame !== 'undefined'){event.preventDefault(); openGame('player.html');}"><span class="desktop-sidebar__icon">🎙️</span> Донат</a>
    </div>
    
    <div class="desktop-sidebar__section">
        <div class="desktop-sidebar__label">Мини-игры</div>
        <a href="arena.html" class="desktop-sidebar__link" onclick="if(typeof openGame !== 'undefined'){event.preventDefault(); openGame('arena.html');}"><span class="desktop-sidebar__icon">⚔️</span> Арена 1vs1</a>
        <a href="wheel.html" class="desktop-sidebar__link" onclick="if(typeof openGame !== 'undefined'){event.preventDefault(); openGame('wheel.html');}"><span class="desktop-sidebar__icon">🎰</span> Колесо Фортуны</a>
        <a href="quiz.html" class="desktop-sidebar__link" onclick="if(typeof openGame !== 'undefined'){event.preventDefault(); openGame('quiz.html');}"><span class="desktop-sidebar__icon">🎯</span> Викторина</a>
        <a href="teams.html" class="desktop-sidebar__link" onclick="if(typeof openGame !== 'undefined'){event.preventDefault(); openGame('teams.html');}"><span class="desktop-sidebar__icon">🛡️</span> Команды</a>
        <a href="challenges.html" class="desktop-sidebar__link" onclick="if(typeof openGame !== 'undefined'){event.preventDefault(); openGame('challenges.html');}"><span class="desktop-sidebar__icon">🌍</span> Ивенты</a>
    </div>

    <div class="desktop-sidebar__section">
        <div class="desktop-sidebar__label">Аккаунт</div>
        <a href="top.html" class="desktop-sidebar__link" onclick="if(typeof openGame !== 'undefined'){event.preventDefault(); openGame('top.html');}"><span class="desktop-sidebar__icon">🏆</span> Рейтинги</a>
        <a href="admin.html" class="desktop-sidebar__link" id="ds_adminBtn" style="display:none;" onclick="if(typeof openGame !== 'undefined'){event.preventDefault(); openGame('admin.html');}"><span class="desktop-sidebar__icon">⚙️</span> Админка</a>
    </div>
</aside>
"""

# Patch CSS
with open('webapp/css/style.css', 'r', encoding='utf-8') as f:
    css = f.read()
if "DESKTOP RESPONSIVE OVERHAUL" not in css:
    with open('webapp/css/style.css', 'a', encoding='utf-8') as f:
        f.write(css_patch)
    print("CSS patched.")

# Copy teams and admin
if os.path.exists('website/teams.html'):
    with open('website/teams.html', 'r', encoding='utf-8') as f: content = f.read()
    content = content.replace('css/main.css', 'css/style.css')
    content = content.replace('js/auth.js', 'js/auth-interceptor.js')
    content = content.replace('auth.', 'siteAuth.')
    with open('webapp/teams.html', 'w', encoding='utf-8') as f: f.write(content)
if os.path.exists('website/admin.html'):
    with open('website/admin.html', 'r', encoding='utf-8') as f: content = f.read()
    content = content.replace('css/main.css', 'css/style.css')
    content = content.replace('js/auth.js', 'js/auth-interceptor.js')
    content = content.replace('auth.', 'siteAuth.')
    with open('webapp/admin.html', 'w', encoding='utf-8') as f: f.write(content)

# Patch HTML components
files = glob.glob('webapp/*.html')
for f in files:
    with open(f, 'r', encoding='utf-8') as file:
        content = file.read()
    
    if '<aside class="desktop-sidebar">' not in content:
        content = re.sub(r'(<body[^>]*>)', r'\g<1>\n' + sidebar_html + '\n', content, count=1)
        
        # Inject script to show admin button if admin
        admin_script = '''
<script>
    if (typeof siteAuth !== 'undefined' && siteAuth.isAdmin) {
        let btn = document.getElementById('ds_adminBtn');
        if(btn) btn.style.display = 'flex';
    }
</script>
'''
        content = content.replace('</body>', admin_script + '</body>')

        with open(f, 'w', encoding='utf-8') as file:
            file.write(content)
        print(f"Patched HTML: {f}")

print("All done.")
