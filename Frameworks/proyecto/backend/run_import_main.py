import os, sys, traceback, importlib
print('CWD:', os.getcwd())
print('PYTHONPATH sample:', sys.path[:3])
try:
    importlib.import_module('main')
    print('IMPORTED OK')
except Exception:
    traceback.print_exc()
