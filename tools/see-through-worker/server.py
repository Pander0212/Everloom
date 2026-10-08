#!/usr/bin/env python3
"""
The See-through worker's HTTP API (docs/puppets.md › The layering worker). Standard library only.

Every request needs the header `x-token: $WORKER_TOKEN`.

    GET  /health               {ready, busy, stage, images, done, error, uptime}
    PUT  /images/<name>.png    store an input image
    POST /run                  layer every stored image (one See-through run over the folder)
    POST /reset                forget earlier inputs and results (not while running)
    GET  /log                  the last lines of the setup and run logs
    GET  /result.zip           everything See-through wrote (PSD, layer PNGs, depth, masks), plus
                               <name>/layers.json and <name>/layers/*.png (the PSD's layers)

A watchdog ends the pod by itself after IDLE_SECONDS without a request (and not busy) or
MAX_SECONDS in total, through `runpodctl remove pod $RUNPOD_POD_ID` (RunPod gives each pod a key
scoped to itself), so a forgotten worker can't keep billing even if the controller dies.
"""
import io
import json
import os
import re
import subprocess
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ.get('WORKER_TOKEN', '')
WORK = os.environ.get('WORK_DIR', '/work')
REPO = os.environ.get('SEE_THROUGH_DIR', '/opt/see-through')
IDLE = int(os.environ.get('IDLE_SECONDS', '600'))
MAX = int(os.environ.get('MAX_SECONDS', '3600'))
EXTRA = os.environ.get('SEE_THROUGH_ARGS', '').split()
START = time.time()
state = {'busy': False, 'stage': 'setting up', 'done': [], 'error': None, 'last': time.time()}
os.makedirs(f'{WORK}/in', exist_ok=True)
os.makedirs(f'{WORK}/out', exist_ok=True)


def ready():
    return os.path.exists(f'{WORK}/READY')


def end_pod(why):
    with open(f'{WORK}/run.log', 'a') as f:
        f.write(f'\n[watchdog] ending the pod: {why}\n')
    pod = os.environ.get('RUNPOD_POD_ID')
    if pod:
        subprocess.call(['runpodctl', 'remove', 'pod', pod])
    os._exit(0)


def watchdog():
    while True:
        time.sleep(15)
        now = time.time()
        if now - START > MAX:
            end_pod(f'past the time limit ({MAX} s)')
        # Setup counts as busy: idle starts once it's ready and nothing is running.
        if ready() and not state['busy'] and now - state['last'] > IDLE:
            end_pod(f'idle for {IDLE} s')


def export_layers():
    """
    Next to each <name>.psd: <name>/layers/NN.png (each layer, cropped) and <name>/layers.json
    ({width, height, layers: [{name, file, left, top, width, height}]}, back to front), so a client
    can read the result without parsing PSD files.
    """
    try:
        from psd_tools import PSDImage
    except Exception as e:  # report, never crash the API
        state['error'] = f'layer export unavailable: {e}'[:300]
        return
    for f in sorted(os.listdir(f'{WORK}/out')):
        if not f.endswith('.psd') or f.endswith('_depth.psd'):
            continue
        name = f[:-4]
        d = f'{WORK}/out/{name}/layers'
        os.makedirs(d, exist_ok=True)
        psd = PSDImage.open(f'{WORK}/out/{f}')
        rows = []
        for i, layer in enumerate(psd):
            im = layer.topil()
            if im is None:
                continue
            fn = f'{i:02d}.png'
            im.convert('RGBA').save(f'{d}/{fn}')
            rows.append({'name': layer.name, 'file': f'layers/{fn}', 'left': layer.left, 'top': layer.top, 'width': im.width, 'height': im.height})
        with open(f'{WORK}/out/{name}/layers.json', 'w') as out:
            json.dump({'width': psd.width, 'height': psd.height, 'layers': rows}, out)


def run_batch():
    state['busy'] = True
    state['error'] = None
    state['stage'] = 'layering'
    try:
        names = sorted(n for n in os.listdir(f'{WORK}/in') if n.endswith('.png'))
        with open(f'{WORK}/run.log', 'a') as log:
            log.write(f'\n[run] {len(names)} image(s): {names}\n')
            log.flush()
            code = subprocess.call(['python', 'inference/scripts/inference_psd.py', '--srcp', f'{WORK}/in', '--save_dir', f'{WORK}/out', '--save_to_psd', '--disable_progressbar', *EXTRA], cwd=REPO, stdout=log, stderr=subprocess.STDOUT)
        if code != 0:
            state['error'] = f'See-through exited with {code} (see /log)'
        export_layers()
        state['done'] = sorted(d for d in os.listdir(f'{WORK}/out') if os.path.isdir(f'{WORK}/out/{d}'))
    except Exception as e:  # report, never crash the API
        state['error'] = str(e)[:300]
    finally:
        state['busy'] = False
        state['stage'] = 'idle'
        state['last'] = time.time()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype='application/json'):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header('content-type', ctype)
        self.send_header('content-length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def authed(self):
        if not TOKEN or self.headers.get('x-token') != TOKEN:
            self.send(401, {'error': 'unauthorized'})
            return False
        state['last'] = time.time()
        return True

    def do_GET(self):
        if not self.authed():
            return
        if self.path == '/health':
            stage = state['stage'] if ready() else (open(f'{WORK}/STAGE').read().strip() if os.path.exists(f'{WORK}/STAGE') else 'setting up')
            return self.send(200, {'ready': ready(), 'busy': state['busy'], 'stage': stage, 'images': sorted(os.listdir(f'{WORK}/in')), 'done': state['done'], 'error': state['error'], 'uptime': int(time.time() - START)})
        if self.path == '/log':
            out = b''
            for f in ('setup.log', 'run.log'):
                p = f'{WORK}/{f}'
                if os.path.exists(p):
                    out += f'==> {f}\n'.encode() + open(p, 'rb').read()[-6000:] + b'\n'
            return self.send(200, out, 'text/plain')
        if self.path == '/result.zip':
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
                for root, _, files in os.walk(f'{WORK}/out'):
                    for f in files:
                        p = os.path.join(root, f)
                        z.write(p, os.path.relpath(p, f'{WORK}/out'))
            return self.send(200, buf.getvalue(), 'application/zip')
        self.send(404, {'error': 'not found'})

    def do_PUT(self):
        if not self.authed():
            return
        m = re.fullmatch(r'/images/([A-Za-z0-9_.-]{1,80}\.png)', self.path)
        if not m:
            return self.send(400, {'error': 'PUT /images/<name>.png'})
        n = int(self.headers.get('content-length', '0'))
        if n <= 0 or n > 40_000_000:
            return self.send(413, {'error': 'image too large'})
        with open(f'{WORK}/in/{m.group(1)}', 'wb') as f:
            f.write(self.rfile.read(n))
        self.send(200, {'stored': m.group(1)})

    def do_POST(self):
        if not self.authed():
            return
        if self.path == '/reset':
            # Clears earlier inputs and results, so the next run layers only what comes next.
            if state['busy']:
                return self.send(409, {'error': 'busy'})
            import shutil
            for d in ('in', 'out'):
                shutil.rmtree(f'{WORK}/{d}', ignore_errors=True)
                os.makedirs(f'{WORK}/{d}', exist_ok=True)
            state['done'] = []
            state['error'] = None
            return self.send(200, {'reset': True})
        if self.path == '/run':
            if not ready():
                return self.send(409, {'error': 'still setting up'})
            if state['busy']:
                return self.send(409, {'error': 'already running'})
            threading.Thread(target=run_batch, daemon=True).start()
            return self.send(202, {'started': True})
        self.send(404, {'error': 'not found'})


if __name__ == '__main__':
    threading.Thread(target=watchdog, daemon=True).start()
    ThreadingHTTPServer(('0.0.0.0', int(os.environ.get('PORT', '8000'))), Handler).serve_forever()
