# SPDX-License-Identifier: MIT
"""Background half of the add-on's export (export_core.export_copy): opens the saved copy, selects
what the add-on had selected, and runs the shared export. Writes result.json next to job.json."""
import json
import os
import sys
import traceback

import bpy

here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
import export_core  # noqa: E402

job_path = sys.argv[sys.argv.index("--") + 1]
with open(job_path, encoding="utf-8") as f:
    job = json.load(f)
out = {"ok": False}
try:
    bpy.ops.wm.open_mainfile(filepath=job["blend"], load_ui=False, use_scripts=False)
    names = job.get("selection")
    if names:
        for o in bpy.context.view_layer.objects:
            o.hide_select = False
            o.select_set(o.name in names)
    out = {"ok": True, "result": export_core.export_model(job["output"], animations=job.get("animations", False), selection=bool(names), extras=job.get("extras", False))}
except Exception as e:  # noqa: BLE001
    out = {"ok": False, "error": str(e)[:500], "trace": traceback.format_exc()[-2000:]}
with open(os.path.join(os.path.dirname(job_path), "result.json"), "w", encoding="utf-8") as f:
    json.dump(out, f)
sys.stdout.flush()
os._exit(0 if out["ok"] else 3)
