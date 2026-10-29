#!/usr/bin/env python3
"""Rikishi portraits from the JSA's own profile photos
(https://www.sumo.or.jp/EnSumoDataRikishi), the one source for the site's art.

    python3 tools/jsa-portrait.py Tanji Ryuho                # make them and report; the site is untouched
    python3 tools/jsa-portrait.py Tanji Ryuho --write        # and put them on the site
    python3 tools/jsa-portrait.py Tokifudo=3927 --write      # Name=JSA profile id, if sumo-api lacks it

Each man's profile id comes from sumo-api (nskId), and the profile page must
name him before its photo is used. The photo is cut out with macOS Vision's
subject mask (tools/jsa-mask.m, built with clang on each run). The mask's soft
edge still holds the wall behind him, a pale halo on the site's dark grounds,
so each edge pixel's alpha is checked against its colour and the wall is taken
back out of it. Files, keyed by the shikona exactly as the pages spell it:

  images/jpg/<Name>.png       the photo as the JSA serves it (an older .jpg/.webp goes)
  images/svg/<Name>.png       the cutout, full frame
  images/rikishi/<Name>.webp  the cutout trimmed to the figure, 420px tall: what the pages load

and on the pages:
  fantasy.html RK, keepers-mock-draft.html PHOTOS: the portrait's path, where it was empty;
  dohyo.html RIKISHI: his height, shadow and hand numbers, re-measured, if he is in the simulator;
  analysis.html PHOTOS: the card photo (the photo at 150 wide, its top 194 rows), full-body only.

The JSA shoots a new sekitori in his kesho-mawashi some weeks after promotion;
until then his profile has a headshot. A headshot does on the cards, but it
stands as a giant face in the home page's banzuke art, so keep it out of that
art (gg-banzuke.js RIK) until the full-body photo is up, then run this again.
Its copyright line is printed across his chest and stays. The analysis page
keeps its own link to the JSA photo for him, which follows the reshoot by
itself. In a full-body photo the copyright line is on the floor and goes with
the background; both PNGs carry the credit in their metadata either way.

WebP comes from headless Chrome (nothing else on a stock Mac writes it).
Needs macOS 14+, python3 and clang (Xcode Command Line Tools), and Google Chrome.
"""
import argparse, base64, html, json, os, re, shutil, struct, subprocess, sys, tempfile, urllib.parse, urllib.request, zlib
from collections import deque

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSA = 'https://www.sumo.or.jp'
CHROME = os.environ.get('CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
DARK = (24, 22, 34)                      # the site's darkest ground, for the previews


def fetch(url):
    r = subprocess.run(['curl', '-sS', '--fail', '--retry', '3', '--max-time', '40', url], capture_output=True)
    if r.returncode:
        raise RuntimeError(f'could not fetch {url}: {r.stderr.decode().strip()}')
    return r.stdout


# ---- PNG, 8-bit and non-interlaced: all that sips writes --------------------------------

def png_read(path):
    """-> (w, h, rows): one bytearray of RGBA per row, whatever the file's channels."""
    b = open(path, 'rb').read()
    i, idat = 8, b''
    while i < len(b):
        ln, = struct.unpack('>I', b[i:i + 4]); typ = b[i + 4:i + 8]; data = b[i + 8:i + 8 + ln]
        if typ == b'IHDR':
            w, h, depth, ct, _, _, interlace = struct.unpack('>IIBBBBB', data)
            if depth != 8 or interlace:
                raise RuntimeError(f'{path}: only 8-bit, non-interlaced PNGs')
        elif typ == b'IDAT':
            idat += data
        i += 12 + ln
    ch = {0: 1, 2: 3, 4: 2, 6: 4}[ct]
    raw, stride = zlib.decompress(idat), w * ch
    rows, prev, p = [], bytearray(stride), 0
    for _ in range(h):
        f, line = raw[p], bytearray(raw[p + 1:p + 1 + stride]); p += 1 + stride
        for x in range(stride):
            a = line[x - ch] if x >= ch else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + prev[x]) & 255
            elif f == 3: line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
            elif f == 4:
                up, c = prev[x], prev[x - ch] if x >= ch else 0
                pa, pb, pc = abs(up - c), abs(a - c), abs(a + up - 2 * c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else up if pb <= pc else c)) & 255
        rows.append(line); prev = line
    pad = {4: lambda l, x: l[x * 4:x * 4 + 4], 3: lambda l, x: l[x * 3:x * 3 + 3] + b'\xff',
           2: lambda l, x: bytes([l[x * 2]] * 3 + [l[x * 2 + 1]]), 1: lambda l, x: bytes([l[x]] * 3 + [255])}[ch]
    return w, h, [bytearray(b''.join(pad(l, x) for x in range(w))) for l in rows]


def png_write(path, w, h, rows, ch=4, text=None):
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    out = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, {3: 2, 4: 6}[ch], 0, 0, 0))
    for k, v in (text or {}).items():
        out += chunk(b'tEXt', k.encode('latin1') + b'\0' + v.encode('latin1', 'replace'))
    out += chunk(b'IDAT', zlib.compress(b''.join(b'\0' + bytes(r) for r in rows), 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(out)


def to_png(src, dst):
    r = subprocess.run(['sips', '-s', 'format', 'png', src, '--out', dst], capture_output=True, text=True)
    if r.returncode or not os.path.exists(dst):
        raise RuntimeError(f'sips could not read {src}')


def exif_copyright(jpg):
    """The photographer's credit from the JPEG's EXIF, or ''."""
    i = 2
    while i + 4 <= len(jpg) and jpg[i] == 0xFF:
        marker, ln = jpg[i + 1], struct.unpack('>H', jpg[i + 2:i + 4])[0]
        if marker == 0xE1 and jpg[i + 4:i + 10] == b'Exif\0\0':
            t = jpg[i + 10:i + 2 + ln]; e = '<' if t[:2] == b'II' else '>'
            ifd = struct.unpack(e + 'I', t[4:8])[0]
            for k in range(struct.unpack(e + 'H', t[ifd:ifd + 2])[0]):
                tag, typ, cnt, val = struct.unpack(e + 'HHII', t[ifd + 2 + 12 * k:ifd + 14 + 12 * k])
                if tag == 0x8298:
                    s = t[val:val + cnt] if cnt > 4 else t[ifd + 10 + 12 * k:ifd + 10 + 12 * k + cnt]
                    return ' '.join(s.replace(b'\0', b' ').decode('latin1').split())
            return ''
        i += 2 + ln
    return ''


# ---- the JSA's photo ----------------------------------------------------------------------

def jsa_id(name):
    data = json.loads(fetch('https://sumo-api.com/api/rikishis?shikonaEn=' + urllib.parse.quote(name)))
    recs = [r for r in data.get('records') or [] if r.get('nskId')]
    pick = [r for r in recs if not r.get('intai')] or recs
    if len(pick) != 1:
        raise RuntimeError(f'sumo-api has {len(pick)} JSA ids for {name}; give it as {name}=<profile id>')
    return pick[0]['nskId']


def jsa_photo(name, nsk, work):
    page = fetch(f'{JSA}/EnSumoDataRikishi/profile/{nsk}/').decode('utf-8', 'replace')
    title = re.search(r'<title>\s*([^<]*)', page)
    title = title.group(1).strip() if title else ''
    if name.lower() not in title.lower():           # a wrong id would put another man's face up
        raise RuntimeError(f'JSA profile {nsk} is "{title or "untitled"}", not {name}')
    m = re.search(r'/img/sumo_data/rikishi/270x474/(\d+)\.jpg', page)
    if not m:
        raise RuntimeError(f'JSA profile {nsk} has no photo')
    jpg = fetch(JSA + m.group(0))
    path = os.path.join(work, name + '.jpg')
    open(path, 'wb').write(jpg)
    return path, m.group(1), jpg


def build_mask_tool(work):
    exe = os.path.join(work, 'jsa-mask')
    fw = [a for f in ('Foundation', 'Vision', 'CoreVideo', 'ImageIO', 'CoreGraphics') for a in ('-framework', f)]
    r = subprocess.run(['clang', '-fobjc-arc', '-O2', '-mmacosx-version-min=14.0', *fw,
                        os.path.join(ROOT, 'tools', 'jsa-mask.m'), '-o', exe], capture_output=True, text=True)
    if r.returncode:
        sys.exit('could not build tools/jsa-mask.m:\n' + r.stderr)
    return exe


def subject_mask(exe, photo, w, h, work, name):
    raw = os.path.join(work, name + '.mask')
    r = subprocess.run([exe, photo, raw], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f'Vision found no subject in {name}\'s photo: {r.stderr.strip()}')
    mw, mh, _ = map(int, r.stdout.split())
    if (mw, mh) != (w, h):
        raise RuntimeError(f'the mask is {mw}x{mh} but the photo {w}x{h}')
    return open(raw, 'rb').read()


def refine(rows, m, w, h):
    """Photo rows + Vision's mask -> RGBA cutout rows. For each soft pixel, B is the clean
    background nearby and O the solid subject nearby: the pixel's own colour says how much
    of it is subject (its projection from B toward O), which may only lower the mask's
    alpha, never raise it. Then the background comes back out: F = (C - (1-a)B) / a."""
    A = [[m[y * w + x] for x in range(w)] for y in range(h)]
    C = [[tuple(rows[y][x * 4:x * 4 + 3]) for x in range(w)] for y in range(h)]

    def distance_from(pred, cap):
        D, q = [[cap] * w for _ in range(h)], deque()
        for y in range(h):
            for x in range(w):
                if pred(A[y][x]):
                    D[y][x] = 0; q.append((x, y))
        while q:
            x, y = q.popleft(); d = D[y][x] + 1
            if d >= cap:
                continue
            for ny in (y - 1, y, y + 1):
                for nx in (x - 1, x, x + 1):
                    if 0 <= nx < w and 0 <= ny < h and D[ny][nx] > d:
                        D[ny][nx] = d; q.append((nx, ny))
        return D

    inside, outside = distance_from(lambda a: a < 255, 6), distance_from(lambda a: a > 0, 6)

    def mean_near(x, y, ok, radii):
        for r in radii:
            n, s = 0, [0, 0, 0]
            for ny in range(max(0, y - r), min(h, y + r + 1)):
                for nx in range(max(0, x - r), min(w, x + r + 1)):
                    if ok(nx, ny):
                        c = C[ny][nx]; s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; n += 1
            if n >= 4:
                return (s[0] / n, s[1] / n, s[2] / n)
        return None

    clean_bg, solid = (lambda x, y: outside[y][x] >= 3), (lambda x, y: inside[y][x] >= 3)
    out = [bytearray(r) for r in rows]
    for y in range(h):
        for x in range(w):
            a = A[y][x] / 255
            if a <= 0:
                out[y][x * 4:x * 4 + 4] = b'\0\0\0\0'; continue
            if a >= 1:
                out[y][x * 4 + 3] = 255; continue
            c, B, O = C[y][x], mean_near(x, y, clean_bg, (5, 8, 12)), mean_near(x, y, solid, (4, 7, 10))
            if B and O:
                d = [O[i] - B[i] for i in range(3)]
                dd = sum(v * v for v in d)
                if dd > 35 * 35:                    # subject and wall differ enough to tell apart
                    a = min(a, max(0.0, min(1.0, sum((c[i] - B[i]) * d[i] for i in range(3)) / dd)))
            if a < 0.02:
                out[y][x * 4:x * 4 + 4] = b'\0\0\0\0'; continue
            f = [(c[i] - (1 - a) * B[i]) / a if B else c[i] for i in range(3)]
            if O and a < 0.35:                      # thin coverage: lean on the solid colour nearby
                t = a / 0.35
                f = [t * f[i] + (1 - t) * O[i] for i in range(3)]
            out[y][x * 4:x * 4 + 4] = bytes([max(0, min(255, round(v))) for v in f] + [round(a * 255)])
    return out


# ---- WebP, through headless Chrome --------------------------------------------------------

def strip_icc(b):
    """Chrome tags its WebP with an sRGB profile; the site's files carry none."""
    chunks, i = [], 12
    while i + 8 <= len(b):
        n = struct.unpack('<I', b[i + 4:i + 8])[0]; chunks.append((b[i:i + 4], b[i + 8:i + 8 + n])); i += 8 + n + (n & 1)
    chunks = [(t, d) for t, d in chunks if t != b'ICCP']
    if any(t == b'ALPH' for t, _ in chunks):
        chunks = [(t, bytes([d[0] & 0xDF]) + d[1:] if t == b'VP8X' else d) for t, d in chunks]
    else:
        chunks = [(t, d) for t, d in chunks if t != b'VP8X']
    body = b'WEBP' + b''.join(t + struct.pack('<I', len(d)) + d + (b'\0' if len(d) & 1 else b'') for t, d in chunks)
    return b'RIFF' + struct.pack('<I', len(body)) + body


def chrome_webp(jobs, work):
    """jobs: [(key, png, canvas (w, h), source rect (x, y, w, h), drawn size (w, h), quality, alpha)]"""
    imgs, draws = [], []
    for k, (key, png, (cw, ch), (sx, sy, sw, sh), (dw, dh), q, alpha) in enumerate(jobs):
        imgs.append(f'<img id="i{k}" src="data:image/png;base64,{base64.b64encode(open(png, "rb").read()).decode()}">')
        draws.append(f"{{const c=document.createElement('canvas');c.width={cw};c.height={ch};"
                     f"const g=c.getContext('2d',{{alpha:{'true' if alpha else 'false'}}});"
                     f"g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';"
                     f"g.drawImage(document.getElementById('i{k}'),{sx},{sy},{sw},{sh},0,0,{dw},{dh});"
                     f"out[{json.dumps(key)}]=c.toDataURL('image/webp',{q});}}")
    page = os.path.join(work, 'encode.html')
    open(page, 'w').write('<!doctype html><meta charset="utf-8"><body>' + ''.join(imgs) + '<pre id="out"></pre><script>'
                          "addEventListener('load',()=>{const out={};try{" + ''.join(draws) + "}catch(e){out.error=String(e)}"
                          "document.getElementById('out').textContent=JSON.stringify(out)})</script>")
    r = subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
                        '--disable-extensions', '--user-data-dir=' + os.path.join(work, 'chrome'),
                        '--virtual-time-budget=10000', '--dump-dom', 'file://' + urllib.request.pathname2url(page)],
                       capture_output=True, timeout=180)
    m = re.search(rb'<pre id="out">(.*?)</pre>', r.stdout, re.S)
    out = json.loads(html.unescape(m.group(1).decode())) if m and m.group(1) else {'error': 'Chrome gave back no page'}
    if 'error' in out:
        raise RuntimeError('Chrome could not encode: ' + out['error'])
    return {k: strip_icc(base64.b64decode(v.split(',', 1)[1])) for k, v in out.items()}


# ---- the pages' tables ---------------------------------------------------------------------

def span_of(text, name):
    """[start, end) of the JSON value in `NAME = <JSON>`, bracket-matched as tools/check-banzuke.mjs does."""
    m = re.search(r'(?:const|let|var)\s+' + name + r'\s*=\s*', text)
    if not m:
        raise RuntimeError(f'{name} not found')
    i, depth, s = m.end(), 0, False
    while i < len(text):
        c = text[i]
        if s:
            if c == '\\': i += 1
            elif c == '"': s = False
        elif c == '"': s = True
        elif c in '{[': depth += 1
        elif c in '}]':
            depth -= 1
            if depth == 0:
                return m.end(), i + 1
        i += 1
    raise RuntimeError(f'{name} never closes')


def edit_entry(file, table, name, pattern, change):
    """Rewrite one man's entry in a page table, leaving every other byte alone.
    -> None if he has no entry, False if change() left it as it was, True if rewritten."""
    path = os.path.join(ROOT, file)
    text = open(path, encoding='utf-8').read()
    a, b = span_of(text, table)
    m = re.search('"' + re.escape(name) + '":' + pattern, text[a:b])
    if not m:
        return None
    old = json.loads(m.group(1))
    new = change(json.loads(m.group(1)))
    if new == old:
        return False
    s, e = a + m.start(1), a + m.end(1)
    open(path, 'w', encoding='utf-8').write(text[:s] + json.dumps(new, ensure_ascii=False, separators=(',', ':')) + text[e:])
    return True


def set_card_photo(name, webp):
    path = os.path.join(ROOT, 'analysis.html')
    text = open(path, encoding='utf-8').read()
    a, b = span_of(text, 'PHOTOS')
    body, uri = text[a:b], '"data:image/webp;base64,' + base64.b64encode(webp).decode() + '"'
    m = re.search('"' + re.escape(name) + r'":("data:image/[a-z]+;base64,[A-Za-z0-9+/=]*")', body)
    if m:
        body = body[:m.start(1)] + uri + body[m.end(1):]
    else:
        body = body[:-1] + (',' if body.strip() != '{}' else '') + json.dumps(name) + ':' + uri + '}'
    open(path, 'w', encoding='utf-8').write(text[:a] + body + text[b:])


def simulator_numbers(png420, hy):
    """dohyo.html's placement numbers, measured the way the existing ones were (checked
    against 20 of them): hands = the widest the figure gets within 8% of hip height,
    shadow = the span of the bottom 10%."""
    w, h, rows = png_read(png420)

    def span(y0, y1, t):
        xs = [x for y in range(max(0, y0), min(h, y1)) for x in range(w) if rows[y][x * 4 + 3] > t]
        return min(xs), max(xs)
    yc, b = round((1 - hy) * h), round(0.08 * h)
    l, r = span(yc - b, yc + b + 1, 128)
    f0, f1 = span(h - round(0.1 * h), h, 32)
    return {'fx': round((f0 + f1 + 1) / 2 / w, 3), 'fw': round((f1 - f0 + 1) / w, 3),
            'hl': round(l / w, 3), 'hr': round((r + 1) / w, 3)}


# ---- one man ---------------------------------------------------------------------------------

def make(name, nsk, exe, work, write):
    nsk = nsk or jsa_id(name)
    jpg_path, pid, jpg = jsa_photo(name, nsk, work)
    who = exif_copyright(jpg)
    credit = {'Copyright': '(C) Nihon Sumo Kyokai (Japan Sumo Association)' + (f'; photo: {who}' if who else ''),
              'Source': f'{JSA}/EnSumoDataRikishi/profile/{nsk}/'}
    photo_png = os.path.join(work, name + '-photo.png')
    to_png(jpg_path, photo_png)
    w, h, photo = png_read(photo_png)
    cut = refine(photo, subject_mask(exe, jpg_path, w, h, work, name), w, h)

    ys = [y for y in range(h) if any(cut[y][x * 4 + 3] > 8 for x in range(w))]
    xs = [x for x in range(w) if any(cut[y][x * 4 + 3] > 8 for y in ys)]
    x0, y0, bw, bh = min(xs), min(ys), max(xs) + 1 - min(xs), max(ys) + 1 - min(ys)
    floor = sum(1 for x in range(x0, x0 + bw) if cut[y0 + bh - 1][x * 4 + 3] > 128) / bw
    kind = 'headshot' if floor > 0.5 else 'full-body'      # a headshot is cut off by the frame; feet aren't

    photo_out, cut_out = os.path.join(work, name + '-photo-out.png'), os.path.join(work, name + '-cutout.png')
    png_write(photo_out, w, h, [bytearray(b for x in range(w) for b in r[x * 4:x * 4 + 3]) for r in photo], ch=3, text=credit)
    png_write(cut_out, w, h, cut, text=credit)
    png_write(os.path.join(work, name + '-preview.png'), w, h,
              [bytearray(round(r[x * 4 + c] * r[x * 4 + 3] / 255 + DARK[c] * (1 - r[x * 4 + 3] / 255))
                         for x in range(w) for c in range(3)) for r in cut], ch=3)

    W = round(420 * bw / bh)
    jobs = [('portrait', cut_out, (W, 420), (x0, y0, bw, bh), (W, 420), 0.9, True)]
    if kind == 'full-body':
        jobs.append(('card', photo_out, (150, 194), (0, 0, w, h), (150, round(h * 150 / w)), 0.8, False))
    webp = chrome_webp(jobs, work)
    open(os.path.join(work, name + '.webp'), 'wb').write(webp['portrait'])
    to_png(os.path.join(work, name + '.webp'), os.path.join(work, name + '-420.png'))

    note = [f'JSA {nsk} (photo {pid}), {kind}, {W}x420, {len(webp["portrait"]) // 1024} KB']
    if not write:
        return note
    for ext in ('.jpg', '.jpeg', '.webp'):                 # an older copy of the photo
        old = os.path.join(ROOT, 'images', 'jpg', name + ext)
        if os.path.exists(old):
            os.remove(old); note.append(f'removed images/jpg/{name}{ext}')
    shutil.copyfile(photo_out, os.path.join(ROOT, 'images', 'jpg', name + '.png'))
    shutil.copyfile(cut_out, os.path.join(ROOT, 'images', 'svg', name + '.png'))
    open(os.path.join(ROOT, 'images', 'rikishi', name + '.webp'), 'wb').write(webp['portrait'])
    src = f'images/rikishi/{name}.webp'

    def give_src(e, key):
        if not e[key]:
            e[key] = src
        return e
    if edit_entry('fantasy.html', 'RK', name, r'(\{[^{}]*\})', lambda e: give_src(e, 'src')):
        note.append('fantasy card')
    if edit_entry('keepers-mock-draft.html', 'PHOTOS', name, r'(\[[^\[\]]*\])', lambda e: give_src(e, 3)):
        note.append('mock draft card')

    def remeasure(e):
        e.update(h=round(bh / h, 4), ar=round(bw / bh, 4), **simulator_numbers(os.path.join(work, name + '-420.png'), e.get('hy', 0.476)))
        return e
    if edit_entry('dohyo.html', 'RIKISHI', name, r'(\{[^{}]*\})', remeasure):
        note.append('simulator numbers')
    if kind == 'full-body':
        set_card_photo(name, webp['card']); note.append('analysis card')
    return note


def main():
    ap = argparse.ArgumentParser(description='Rikishi portraits from the JSA profile photos.')
    ap.add_argument('names', nargs='+', help='shikona as the site spells it, or Name=JSA profile id')
    ap.add_argument('--write', action='store_true', help='put the portraits on the site')
    ap.add_argument('--out', help='keep the work files (photo, cutout, previews) in this folder')
    args = ap.parse_args()
    work = args.out or tempfile.mkdtemp(prefix='jsa-portrait-')
    os.makedirs(work, exist_ok=True)
    exe, failed = build_mask_tool(work), 0
    for arg in args.names:
        name, _, nsk = arg.partition('=')
        try:
            print(f'{name:14} ' + ' · '.join(make(name, nsk, exe, work, args.write)))
        except RuntimeError as e:
            failed += 1
            print(f'{name:14} FAILED: {e}')
    print(('written. ' if args.write else 'nothing on the site changed (add --write). ') + f'Previews and work files: {work}')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
