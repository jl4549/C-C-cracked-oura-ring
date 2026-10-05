import os
import sys
import tempfile
from pathlib import Path

# Keep config/database files created at import time out of the real user data dir.
_tmp = tempfile.mkdtemp(prefix="cracked_oura_test_")
os.environ["APPDATA"] = _tmp
os.environ["HOME"] = _tmp

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
