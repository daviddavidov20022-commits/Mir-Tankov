import sqlite3

conn = sqlite3.connect("ecosystem.db")

# Add columns if missing
for col in ["from_last_stats TEXT", "to_last_stats TEXT", "battle_history TEXT DEFAULT '[]'"]:
    try:
        conn.execute(f"ALTER TABLE arena_challenges ADD COLUMN {col}")
        print(f"+ {col.split()[0]}")
    except:
        print(f"  {col.split()[0]} уже есть")

# Reset frozen end stats for active challenges (so they re-freeze correctly)
conn.execute("UPDATE arena_challenges SET from_end_stats = NULL, to_end_stats = NULL WHERE status = 'active'")
print("Сброшены замороженные данные для активных челленджей")

conn.commit()
conn.close()
print("Готово!")
