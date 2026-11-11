"""Lector mínimo de .xlsx con la librería estándar (sin dependencias)."""
import re
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta

M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
NS = {'m': M}


def col_index(ref):
    letters = re.match(r'[A-Z]+', ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n - 1


def _text(node):
    return ''.join(t.text or '' for t in node.iter('{%s}t' % M))


def read_workbook(path):
    """Devuelve {nombre_hoja: [[valor, ...], ...]} con valores como texto."""
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        shared = [_text(si) for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS)]
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    targets = {r.get('Id'): r.get('Target') for r in rels}
    out = {}
    for sheet in wb.find('m:sheets', NS):
        target = targets[sheet.get('{%s}id' % R)].lstrip('/')
        if not target.startswith('xl/'):
            target = 'xl/' + target
        root = ET.fromstring(z.read(target))
        rows = []
        for row in root.find('m:sheetData', NS).findall('m:row', NS):
            values = {}
            for c in row.findall('m:c', NS):
                v = c.find('m:v', NS)
                if v is None:
                    inline = c.find('m:is', NS)
                    text = _text(inline) if inline is not None else None
                else:
                    text = shared[int(v.text)] if c.get('t') == 's' else v.text
                if text is not None and text.strip() != '':
                    values[col_index(c.get('r'))] = text.strip()
            if values:
                width = max(values) + 1
                rows.append([values.get(i) for i in range(width)])
            else:
                rows.append([])
        out[sheet.get('name')] = rows
    return out


def excel_date(value):
    """Convierte un número serial de Excel a fecha ISO; None si no aplica."""
    try:
        serial = float(value)
    except (TypeError, ValueError):
        return None
    if not 20000 < serial < 80000:
        return None
    return (datetime(1899, 12, 30) + timedelta(days=serial)).date().isoformat()
