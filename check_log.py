import os

game = r"D:\Танки\World_of_Tanks_RU"
log = os.path.join(game, "python.log")
if os.path.exists(log):
    lines = open(log, 'r', encoding='utf-8', errors='ignore').readlines()
    # Find radar-related errors
    for i, l in enumerate(lines):
        ll = l.lower()
        if 'radar' in ll or 'error' in ll or 'exception' in ll or 'import' in ll or 'traceback' in ll or 'not loaded' in ll:
            # Print context: 2 lines before and 5 after
            start = max(0, i-2)
            end = min(len(lines), i+6)
            for j in range(start, end):
                print(f"{j}: {lines[j].rstrip()}")
            print("---")
else:
    print("NO LOG")
