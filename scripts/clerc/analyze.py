"""Analiza el respaldo de CLERC y produce un manifiesto JSON para el importador.

Uso: python -I analyze.py <raiz_respaldo> <salida.json>
Solo lee el respaldo; no modifica nada en él.
"""
import hashlib
import json
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xlsx import excel_date, read_workbook  # noqa: E402

BACKUP = sys.argv[1]
OUT = sys.argv[2]
MAIN = os.path.join(BACKUP, 'Red.Notaria Dropbox', 'Isabel Reyes', 'CLERC')
COPY = os.path.join(BACKUP, 'Copias encontradas en Documentos-Escritorio-Descargas', 'Isabel Reyes', 'CLERC')
IGNORED_NAMES = {'desktop.ini', 'thumbs.db', '.ds_store'}
# Carpetas internas del despacho que NO se importan (llaves FIEL, SAT, IMSS, cotizaciones bancarias, litigios propios).
EXCLUDED_TOP = {'DOCUMENTOS CLERC'}
JUNK_EXTENSIONS = {'.tmp', '.crdownload', '.pst', '.url'}
CONTAINERS = {'CANCELADOS': 'CANCELLED', 'CANCELADO': 'CANCELLED', 'CONCLUSIONES': 'CONCLUDED'}


def strip_accents(text):
    return ''.join(c for c in unicodedata.normalize('NFD', text) if unicodedata.category(c) != 'Mn')


def norm_key(text):
    text = strip_accents(text or '').upper()
    text = re.sub(r'[^A-Z0-9 ]+', ' ', text)
    return re.sub(r'\s+', ' ', text).strip()


def long_path(path):
    """Windows limita las rutas a 260 caracteres salvo con el prefijo \\\\?\\."""
    if os.name == 'nt' and not path.startswith('\\\\?\\'):
        return '\\\\?\\' + os.path.abspath(path)
    return path


def sha256_file(path):
    h = hashlib.sha256()
    with open(long_path(path), 'rb') as fh:
        for chunk in iter(lambda: fh.read(4 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def list_files(root):
    for current, dirs, files in os.walk(root):
        dirs.sort()
        for name in sorted(files):
            if name.lower() in IGNORED_NAMES or name.startswith('~$'):
                continue
            yield os.path.join(current, name)


# ---------------------------------------------------------------- inventario
def inventory(root, label):
    items = []
    total = 0
    for path in list_files(root):
        rel = os.path.relpath(path, root).replace('\\', '/')
        try:
            size = os.path.getsize(long_path(path))
            digest = sha256_file(path)
        except OSError as error:
            items.append({'root': label, 'rel': rel, 'error': str(error)})
            continue
        total += size
        items.append({'root': label, 'rel': rel, 'size': size, 'sha256': digest,
                      'ext': os.path.splitext(path)[1].lower(), 'mtime': int(os.path.getmtime(long_path(path)))})
        if len(items) % 1000 == 0:
            print(f'  {label}: {len(items)} archivos, {total / 1e9:.2f} GB', flush=True)
    return items


# ---------------------------------------------------------- carpetas de EXP
FOLDER_PATTERNS = [
    # 1019-2025 EXP 5976 CAVIACE | 1037-EXP 5990 | 1032 EXP 5967 | 836-20204 EXP 4676 | 188-2020 EXP 870-2020 X
    re.compile(r'^(?P<conv>\d{1,4})?\s*-?\s*(?P<cyear>\d{2,5})?\s*-?\s*EXP\.?\s*(?P<exp>\d{2,5})(?:\s*-\s*\d{4})?\s*(?P<label>.*)$', re.I),
    # 5840 GERARDO ESCOTO MEDIACION | 6612 CAVIACE
    re.compile(r'^(?P<exp>\d{3,5})\s+(?P<label>\D.*)$'),
    # 37-2018 GUDBERTO RODRIGUEZ CORREA Y ARTURO CASAS GODOY
    re.compile(r'^(?P<conv>\d{1,4})\s*-\s*(?P<cyear>\d{4})\s+(?P<label>\D.*)$'),
]


def parse_folder(name, year):
    for pattern in FOLDER_PATTERNS:
        m = pattern.match(name.strip())
        if not m:
            continue
        g = m.groupdict()
        conv = g.get('conv')
        agreement = None
        if conv:
            cyear = g.get('cyear')
            # Años mal capturados (20204, 20256, 224) se corrigen con el año de la carpeta contenedora.
            if not cyear or len(cyear) != 4:
                cyear = str(year) if year else None
            agreement = f'{int(conv)}/{cyear}' if cyear else None
        return {'exp': str(int(g['exp'])) if g.get('exp') else None, 'agreement': agreement,
                'label': (g.get('label') or '').strip(' -_') or None}
    return None


def scan_matter_folders(files):
    """Agrupa archivos de CONVENIOS*/TRANSACCIONES en carpetas de expediente."""
    folders = {}
    for item in files:
        if 'error' in item:
            continue
        parts = item['rel'].split('/')
        top = parts[0]
        if not (top.startswith('CONVENIOS') or top == 'TRANSACCIONES'):
            continue
        idx = 1
        year = None
        m = re.match(r'CONVENIOS (\d{4})$', top)
        if m:
            year = int(m.group(1))
        state = None
        # CONVENIOS 2015- 2022/CONVENIOS 2019/...
        if len(parts) > idx + 1 and re.match(r'CONVENIOS (\d{4})$', parts[idx]):
            year = int(parts[idx][-4:])
            idx += 1
        if top == 'TRANSACCIONES' and len(parts) > idx + 1 and re.match(r'\d{4}$', parts[idx]):
            year = int(parts[idx])
            idx += 1
        if len(parts) > idx + 1 and parts[idx].upper() in CONTAINERS:
            state = CONTAINERS[parts[idx].upper()]
            idx += 1
        if len(parts) <= idx + 1:
            # Archivo suelto en la carpeta del año: se agrupa como expediente "sueltos".
            folder_key = '/'.join(parts[:idx]) + '/(sueltos)'
            name = None
        else:
            folder_key = '/'.join(parts[:idx + 1])
            name = parts[idx]
        entry = folders.get(folder_key)
        if entry is None:
            parsed = parse_folder(name, year) if name else None
            entry = folders[folder_key] = {
                'path': folder_key, 'name': name, 'year': year, 'state': state,
                'kind': 'TRANSACTION' if top == 'TRANSACCIONES' else 'AGREEMENT',
                'parsed': parsed, 'files': []}
        entry['files'].append(item['rel'])
    return list(folders.values())


# ----------------------------------------------------------- registro maestro
def norm_agreement(value):
    if not value:
        return None
    m = re.match(r'^\s*0*(\d{1,4})\s*[-/]+\s*(\d{4})', value)
    return f'{int(m.group(1))}/{m.group(2)}' if m else None


def parse_hour(value):
    if not value:
        return None
    try:
        f = float(value)
        if 0 <= f < 1:
            minutes = round(f * 24 * 60)
            return f'{minutes // 60:02d}:{minutes % 60:02d}'
    except ValueError:
        pass
    m = re.match(r'^\s*(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(am|pm)?', value, re.I)
    if not m:
        return None
    hour, minute = int(m.group(1)), int(m.group(2))
    if m.group(3) and m.group(3).lower() == 'pm' and hour < 12:
        hour += 12
    return f'{hour:02d}:{minute:02d}' if hour < 24 and minute < 60 else None


HEADER_MAP = {
    'EXP': 'exp', 'S': 'exp', 'FECHA S': 'requestDate', 'FECHA SOLICITUD': 'requestDate',
    'CONVENIO': 'agreement', 'FECHA': 'agreementDate', 'FECHA CONVENIO': 'agreementDate', 'HORA': 'hour',
    'PROCESO': 'process', 'EXP IJA': 'ijaCaseFile', 'SANCION': 'sanction', 'FECHA DE SANCION': 'sanctionDate',
    'FECHA LLEGADA SANCION': 'sanctionArrivalDate', 'FECHA EN QUE LLEGO': 'sanctionArrivalDate',
    'COBRO': 'fee', 'MATERIA': 'matter', 'ACTO JURIDICO': 'legalAct', 'SOLICITO': 'requestedBy',
    'ELABORO': 'draftedBy', 'FIRMA': 'signedBy', 'P SOLICITANTE': 'requesting', 'SOLICITANTE': 'requesting',
    'COMPLEMENTARIA': 'complementary', 'COMPLEMENTARIA A': 'complementaryB', 'INMUEBLE': 'property',
    'DOMICLIO': 'property', 'DOMICILIO': 'property', 'VENCIMIENTO': 'expiry', 'POLIZA': 'policy',
    'COMENTARIO': 'comment',
}
DATE_FIELDS = {'requestDate', 'agreementDate', 'sanctionDate', 'sanctionArrivalDate', 'expiry'}


def read_register(control_dir):
    candidates = []
    for current, _, files in os.walk(control_dir):
        for name in files:
            if name.lower().endswith('.xlsx') and not name.startswith('~$') and 'caviace' not in name.lower():
                candidates.append(os.path.join(current, name))
    latest = max(candidates, key=os.path.getmtime)
    workbook = read_workbook(latest)
    rows = []
    for sheet, data in workbook.items():
        if not re.match(r'^\d{4}$', sheet):
            continue
        header = None
        for line, raw in enumerate(data, start=1):
            if not raw:
                continue
            if header is None:
                header = [HEADER_MAP.get(norm_key(h or '')) for h in raw]
                continue
            record = {'sheet': sheet, 'row': line}
            for i, value in enumerate(raw):
                field = header[i] if i < len(header) else None
                if field and value and field not in record:
                    record[field] = value
            for field in DATE_FIELDS:
                if field in record:
                    record[field + 'Raw'] = record[field]
                    record[field] = excel_date(record[field])
            if 'sanction' in record and excel_date(record['sanction']):
                record['sanctionDate'] = record.get('sanctionDate') or excel_date(record['sanction'])
                record['sanction'] = 'SANCIONADO'
            record['hour'] = parse_hour(record.get('hour'))
            record['agreementRaw'] = record.get('agreement')
            record['agreement'] = norm_agreement(record.get('agreement'))
            if record.get('exp'):
                m = re.match(r'^\s*(\d{1,5})(?:\.0)?\s*$', record['exp'])
                record['exp'] = str(int(m.group(1))) if m else None
            if not (record.get('exp') and len(record) > 6) and not record.get('agreement'):
                continue  # filas vacías o con sólo el número reservado
            rows.append(record)
    return latest, rows


def read_caviace(path):
    data = read_workbook(path)
    rows = []
    for raw in list(data.values())[0][1:]:
        if raw and raw[0]:
            rows.append({'agreement': norm_agreement(raw[0]), 'ijaCaseFile': raw[1] if len(raw) > 1 else None,
                         'sanction': raw[2] if len(raw) > 2 else None, 'cadastral': raw[3] if len(raw) > 3 else None,
                         'tenants': raw[4] if len(raw) > 4 else None, 'address': raw[5] if len(raw) > 5 else None})
    return rows


def main():
    print('Inventario de la carpeta principal...', flush=True)
    main_files = inventory(MAIN, 'main')
    print('Inventario de la copia encontrada...', flush=True)
    copy_files = inventory(COPY, 'copy') if os.path.isdir(COPY) else []
    main_hashes = {f['sha256'] for f in main_files if 'sha256' in f}
    main_paths = {f['rel'] for f in main_files}
    extra = [f for f in copy_files if 'sha256' in f and f['sha256'] not in main_hashes]
    print(f'Copia: {len(copy_files)} archivos, {len(extra)} con contenido que no está en la principal')
    for f in extra:
        f['rel_original'] = f['rel']
        if f['rel'] in main_paths:  # mismo nombre, otro contenido: se conserva como versión recuperada
            base, ext = os.path.splitext(f['rel'])
            f['rel'] = f'{base} (copia recuperada){ext}'
    files = main_files + extra
    for f in files:
        top = f['rel'].split('/')[0]
        name = f['rel'].split('/')[-1].lower()
        if top in EXCLUDED_TOP:
            f['excluded'] = 'carpeta interna del despacho'
        elif f.get('ext') in JUNK_EXTENSIONS or name.startswith('~wrl') or name == 'download.htm':
            f['excluded'] = 'archivo temporal o sin contenido útil'
        else:
            f['excluded'] = False
    included = [f for f in files if not f['excluded'] and 'sha256' in f]

    control_dir = os.path.join(MAIN, 'CONTROL')
    register_file, register = read_register(control_dir)
    caviace = read_caviace(os.path.join(control_dir, 'Registro Caviace.xlsx'))
    folders = scan_matter_folders(included)

    reg_by_exp = defaultdict(list)
    reg_by_agreement = defaultdict(list)
    for r in register:
        if r.get('exp'):
            reg_by_exp[r['exp']].append(r)
        if r.get('agreement'):
            reg_by_agreement[r['agreement']].append(r)
    matched = 0
    for folder in folders:
        p = folder['parsed'] or {}
        hit = None
        if p.get('exp') and p['exp'] in reg_by_exp:
            hit = 'exp'
        elif p.get('agreement') and p['agreement'] in reg_by_agreement:
            hit = 'agreement'
        folder['registerMatch'] = hit
        matched += bool(hit)

    stats = {
        'mainFiles': len(main_files), 'copyFiles': len(copy_files), 'copyExtraFiles': len(extra),
        'errors': [f for f in files if 'error' in f],
        'excludedFiles': sum(1 for f in files if f['excluded']),
        'includedFiles': len(included), 'includedBytes': sum(f['size'] for f in included),
        'uniqueContents': len({f['sha256'] for f in included}),
        'uniqueBytes': sum({f['sha256']: f['size'] for f in included}.values()),
        'registerFile': register_file, 'registerRows': len(register),
        'registerRowsPerSheet': Counter(r['sheet'] for r in register),
        'folders': len(folders), 'foldersMatchedToRegister': matched,
        'foldersUnparsed': [f['path'] for f in folders if not f['parsed']],
        'foldersUnmatched': [f['path'] for f in folders if f['parsed'] and not f['registerMatch']][:80],
        'duplicateExpInRegister': {k: len(v) for k, v in reg_by_exp.items() if len(v) > 1},
        'signedBy': Counter(norm_key(r.get('signedBy', '')) for r in register),
        'draftedBy': Counter(norm_key(r.get('draftedBy', '')) for r in register),
        'process': Counter(norm_key(r.get('process', '')) for r in register),
        'legalAct': Counter(norm_key(r.get('legalAct', '')) for r in register).most_common(25),
        'requestedBy': Counter(norm_key(r.get('requestedBy', '')) for r in register).most_common(60),
        'extensions': Counter(f['ext'] for f in included).most_common(),
        'generatedOn': date.today().isoformat(),
    }
    manifest = {'sources': {'main': MAIN, 'copy': COPY}, 'stats': stats, 'files': files,
                'register': register, 'caviace': caviace, 'folders': folders}
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
    printable = {k: v for k, v in stats.items() if k not in ('errors',)}
    printable['errors'] = len(stats['errors'])
    print(json.dumps(printable, ensure_ascii=False, indent=1, default=str))


if __name__ == '__main__':
    main()
