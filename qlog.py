import os
log = r'D:\Танки\World_of_Tanks_RU\python.log'
lines = open(log, 'r', errors='ignore').readlines()
for l in lines:
    if 'radar' in l.lower() or 'RadarHelper' in l:
        print(l.rstrip())
