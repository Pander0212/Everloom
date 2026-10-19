"""
Everloom's GPU worker on a rented RunPod pod (tools/gpu/run.mjs starts it).

It receives input files, runs one model's runner (tools/gpu/models/<model>/run.py, set up by that
model's setup.sh) over them, and serves the results. Every request needs the session's token.
It stops the pod by itself after IDLE_SECONDS without requests or MAX_SECONDS in all, so a lost
connection on our side can't leave a pod running; run.mjs also terminates it in a finally step.
"""
import http.server, json, os, subprocess, threading, time

TOKEN = os.environ["WORKER_TOKEN"]
IDLE = int(os.environ.get("IDLE_SECONDS", "600"))
MAX = int(os.environ.get("MAX_SECONDS", "3600"))
DIR = os.environ.get("WORKER_DIR", "/opt/worker")
IN, OUT = f"{DIR}/in", f"{DIR}/out"
os.makedirs(IN, exist_ok=True)
os.makedirs(OUT, exist_ok=True)
ALLOWED_IN = (".png", ".jpg", ".jpeg", ".webp", ".glb", ".json")
state = {"busy": False, "model": None, "log": ""}
t0 = last = time.time()


def stop_pod():
    os.system("runpodctl stop pod $RUNPOD_POD_ID >/dev/null 2>&1 || kill 1")


def watchdog():
    while True:
        time.sleep(15)
        idle = time.time() - last > IDLE and not state["busy"]
        if idle or time.time() - t0 > MAX:
            stop_pod()


def stages():
    """Per-model setup stage, written by setup.sh into stage.<model>."""
    out = {}
    for n in os.listdir(DIR):
        if n.startswith("stage."):
            out[n[6:]] = open(os.path.join(DIR, n)).read().strip()[-300:]
    return out


def run(model, opts):
    state["busy"], state["model"] = True, model
    try:
        env = dict(os.environ)
        env.pop("WORKER_TOKEN", None)
        r = subprocess.run([f"/opt/venvs/{model}/bin/python", f"{DIR}/models/{model}/run.py", IN, os.path.join(OUT, model), json.dumps(opts)], capture_output=True, text=True, timeout=MAX, env=env, cwd=f"{DIR}/models/{model}")
        state["log"] += f"== {model} (exit {r.returncode})\n{r.stdout[-20000:]}\n{r.stderr[-8000:]}\n"
    except Exception as e:  # noqa: BLE001
        state["log"] += f"== {model} failed: {e}\n"
    finally:
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
            return self._send(200, json.dumps({"stages": stages(), "busy": state["busy"], "model": state["model"], "uptime": int(time.time() - t0)}))
        if self.path == "/log":
            return self._send(200, state["log"][-200000:], "text/plain")
        if self.path.startswith("/setup-log/"):
            p = f"{DIR}/setup.{os.path.basename(self.path)}.log"
            return self._send(200, open(p).read()[-20000:] if os.path.exists(p) else "", "text/plain")
        if self.path.startswith("/ls/"):
            d = os.path.join(OUT, os.path.basename(self.path[4:]))
            return self._send(200, json.dumps(sorted(os.listdir(d)) if os.path.isdir(d) else []))
        if self.path.startswith("/result/"):
            model, _, name = self.path[8:].partition("/")
            p = os.path.join(OUT, os.path.basename(model), os.path.basename(name))
            if os.path.isfile(p):
                return self._send(200, open(p, "rb").read(), "application/octet-stream")
        self._send(404, "{}")

    def do_PUT(self):
        if not self._ok():
            return
        n = int(self.headers.get("content-length", "0"))
        name = os.path.basename(self.path)
        if self.path.startswith("/files/") and name.lower().endswith(ALLOWED_IN) and 0 < n < 200_000_000:
            with open(os.path.join(IN, name), "wb") as f:
                f.write(self.rfile.read(n))
            return self._send(200, "{}")
        self._send(400, "{}")

    def do_POST(self):
        if not self._ok():
            return
        if self.path.startswith("/run/") and not state["busy"]:
            model = os.path.basename(self.path[5:])
            n = int(self.headers.get("content-length", "0"))
            opts = json.loads(self.rfile.read(n) or b"{}") if n else {}
            if not os.path.exists(f"/opt/venvs/{model}/bin/python"):
                return self._send(409, json.dumps({"error": f"{model} is not set up"}))
            threading.Thread(target=run, args=(model, opts), daemon=True).start()
            return self._send(200, "{}")
        if self.path == "/stop":
            self._send(200, "{}")
            threading.Thread(target=stop_pod, daemon=True).start()
            return
        self._send(409, "{}")

    def log_message(self, *a):
        pass


threading.Thread(target=watchdog, daemon=True).start()
http.server.ThreadingHTTPServer(("0.0.0.0", 8000), H).serve_forever()
