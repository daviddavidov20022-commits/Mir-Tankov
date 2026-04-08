import glob, re

# Step 1: Remove all injected <aside class="desktop-sidebar">...</aside> from HTML files
files = glob.glob('webapp/*.html')
for f in files:
    with open(f, 'r', encoding='utf-8') as fh:
        content = fh.read()
    
    # Remove the sidebar block
    content = re.sub(
        r'\n<!-- DESKTOP SIDEBAR OVERLAY -->.*?</aside>\n',
        '',
        content,
        flags=re.DOTALL
    )
    
    # Remove the admin script block we injected
    content = re.sub(
        r'\n<script>\s*if \(typeof siteAuth.*?</script>\n',
        '\n',
        content,
        flags=re.DOTALL
    )
    
    with open(f, 'w', encoding='utf-8') as fh:
        fh.write(content)
    print(f"Cleaned: {f}")

# Step 2: Remove the broken CSS block from style.css
with open('webapp/css/style.css', 'r', encoding='utf-8') as f:
    css = f.read()

# Remove everything from the DESKTOP RESPONSIVE OVERHAUL comment to the end
css = re.sub(
    r'/\* =+\s*\n\s*DESKTOP RESPONSIVE OVERHAUL.*',
    '',
    css,
    flags=re.DOTALL
)

# Add PROPER responsive CSS — just widen and adapt, no sidebar
proper_css = """
/* ==========================================
   DESKTOP ADAPTIVE — Wide Screen
   ========================================== */
@media (min-width: 900px) {
    /* Widen content area */
    .header-content,
    .stats-bar,
    .main-content {
        max-width: 900px;
    }

    /* Game cards 3 columns */
    .games-grid {
        grid-template-columns: repeat(3, 1fr) !important;
    }

    /* Full-width cards stay full */
    .game-card--cheese,
    .game-card--stats {
        grid-column: 1 / -1;
    }

    /* Menu list 2 columns */
    .menu-list {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
    }

    /* Wider landing sections */
    .hero,
    .landing-section,
    .sub-cta-section,
    .site-footer {
        max-width: 100%;
    }

    .hero__content,
    .landing-section .features-grid,
    .platforms-grid {
        max-width: 1000px;
        margin: 0 auto;
    }

    .features-grid {
        grid-template-columns: repeat(3, 1fr) !important;
    }

    .platforms-grid {
        grid-template-columns: repeat(4, 1fr) !important;
    }

    /* Quick actions wider */
    .quick-actions {
        max-width: 900px !important;
    }
    .quick-actions-grid {
        grid-template-columns: repeat(3, 1fr);
    }

    /* Daily reward wider */
    .daily-reward-section {
        max-width: 900px !important;
    }

    /* Twitch player wider */
    .twitch-player-section {
        max-width: 900px !important;
    }

    /* Stat items bigger */
    .stat-value {
        font-size: 1.3rem;
    }
    .stat-label {
        font-size: 0.7rem;
    }

    /* Hero section bigger text */
    .hero__name {
        font-size: 3.5rem;
    }
    .hero__tagline {
        font-size: 1.3rem;
    }

    /* Bigger game cards */
    .game-card {
        min-height: 220px;
        padding: 20px;
    }
    .game-card__title {
        font-size: 0.95rem;
    }
    .game-card__desc {
        font-size: 0.78rem;
    }

    /* Top navbar wider */
    .navbar-inner {
        max-width: 1100px;
    }

    /* Sub CTA wider */
    .sub-cta-inner {
        max-width: 1000px;
        margin: 0 auto;
    }

    /* Footer wider */
    .footer-inner {
        max-width: 1000px;
        margin: 0 auto;
    }

    /* Join card wider */
    #joinSection > div > div {
        max-width: 500px;
    }
}

@media (min-width: 1200px) {
    .header-content,
    .stats-bar,
    .main-content {
        max-width: 1100px;
    }

    .games-grid {
        grid-template-columns: repeat(4, 1fr) !important;
    }

    .quick-actions {
        max-width: 1100px !important;
    }
    .quick-actions-grid {
        grid-template-columns: repeat(4, 1fr);
    }

    .features-grid {
        grid-template-columns: repeat(4, 1fr) !important;
    }
}
"""

css = css.rstrip() + "\n" + proper_css

with open('webapp/css/style.css', 'w', encoding='utf-8') as f:
    f.write(css)

print("CSS fixed with proper responsive rules.")
print("ALL DONE — no sidebar, just clean wide layout.")
