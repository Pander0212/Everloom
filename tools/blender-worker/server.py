"""
The converter on a rented CPU pod: receives .blend files, converts each with Everloom's own Blender
worker (apps/server/src/blender/worker.py, sent along), and serves the GLBs. Every request needs the
session's token. It stops the pod by itself when idle or past its time limit.
"""
import http.server, json, os, subprocess, threading, time

TOKEN = os.environ["WORKER_TOKEN"]
IDLE = int(os.environ.get("IDLE_SECONDS", "600"))
MAX = int(os.environ.get("MAX_SECONDS", "3600"))
DIR = os.environ.get("WORKER_DIR", "/opt/worker")
BLENDER = os.environ.get("BLENDER", f"{DIR}/blender-4.2.3-linux-x64/blender")
IN, OUT = f"{DIR}/in", f"{DIR}/out"
os.makedirs(IN, exist_ok=True)
os.makedirs(OUT, exist_ok=True)
state = {"busy": False, "done": [], "failed": {}, "log": ""}
t0 = last = time.time()


def watchdog():
    while True:
        time.sleep(15)
        if time.time() - last > IDLE or time.time() - t0 > MAX:
            os.system("runpodctl stop pod $RUNPOD_POD_ID || kill 1")


def convert():
    state["busy"] = True
    for name in sorted(os.listdir(IN)):
        if not name.endswith(".blend"):
            continue
        job = os.path.join(OUT, name + ".job")
        os.makedirs(job, exist_ok=True)
        os.replace(os.path.join(IN, name), os.path.join(job, "input.blend"))
        with open(os.path.join(job, "job.json"), "w") as f:
            json.dump({"op": "convert", "input": "input.blend", "output": "output.glb"}, f)
        r = subprocess.run([BLENDER, "--background", "--factory-startup", "--disable-autoexec", "--python", f"{DIR}/worker.py", "--", os.path.join(job, "job.json")], capture_output=True, text=True, timeout=900)
        state["log"] += f"== {name}\n{r.stdout[-4000:]}\n{r.stderr[-2000:]}\n"
        glb = os.path.join(job, "output.glb")
        if os.path.exists(glb):
            os.replace(glb, os.path.join(OUT, name[:-6] + ".glb"))
            state["done"].append(name[:-6])
        else:
            state["failed"][name] = r.stderr[-300:]
    state["busy"] = False


class H(http.server.BaseHTTPRequestHandler):
    def _ok(self):
        global last
        last = time.time()
        if self.headers.get("x-token") != TOKEN:
            self.send_response(403)
            self.end_headers()
            return False
        return True

    def _send(self, code, body, kind="application/json"):
        self.send_response(code)
        self.send_header("content-type", kind)
        self.end_headers()
        self.wfile.write(body if isinstance(body, bytes) else body.encode())

    def do_GET(self):
        if not self._ok():
            return
        if self.path == "/health":
            stage = open(f"{DIR}/stage").read().strip() if os.path.exists(f"{DIR}/stage") else "starting"
            return self._send(200, json.dumps({"stage": stage, "ready": stage == "ready", "busy": state["busy"], "done": state["done"], "failed": state["failed"]}))
        if self.path == "/log":
            return self._send(200, state["log"], "text/plain")
        if self.path.startswith("/result/"):
            name = os.path.basename(self.path[8:])
            p = os.path.join(OUT, name)
            if name.endswith(".glb") and os.path.exists(p):
                return self._send(200, open(p, "rb").read(), "model/gltf-binary")
        self._send(404, "{}")

    def do_PUT(self):
        if not self._ok():
            return
        name = os.path.basename(self.path)
        n = int(self.headers.get("content-length", "0"))
        if self.path.startswith("/files/") and name.endswith(".blend") and 0 < n < 600_000_000:
            with open(os.path.join(IN, name), "wb") as f:
                f.write(self.rfile.read(n))
            return self._send(200, "{}")
        if self.path == "/worker.py" and 0 < n < 2_000_000:
            with open(f"{DIR}/worker.py", "wb") as f:
                f.write(self.rfile.read(n))
            return self._send(200, "{}")
        self._send(400, "{}")

    def do_POST(self):
        if not self._ok():
            return
        if self.path == "/run" and not state["busy"]:
            threading.Thread(target=convert, daemon=True).start()
            return self._send(200, "{}")
        self._send(409, "{}")

    def log_message(self, *a):
        pass


threading.Thread(target=watchdog, daemon=True).start()
http.server.ThreadingHTTPServer(("0.0.0.0", 8000), H).serve_forever()
