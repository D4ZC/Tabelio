"""Extrae el texto de los formatos de CLERC (FORMATOS CONVENIOS) con LibreOffice.

Uso: python -I extract_texts.py <manifest.json> <carpeta_salida> [ruta_soffice]
Genera <sha256>.txt por cada documento Word para la biblioteca jurídica.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

manifest_path, out_dir = sys.argv[1], sys.argv[2]
soffice = sys.argv[3] if len(sys.argv) > 3 else r'C:\Program Files\LibreOffice\program\soffice.exe'
manifest = json.load(open(manifest_path, encoding='utf-8'))
main_root = manifest['sources']['main']
os.makedirs(out_dir, exist_ok=True)

pending = {}
for item in manifest['files']:
    if item.get('excluded') or 'sha256' not in item or not item['rel'].startswith('FORMATOS CONVENIOS/'):
        continue
    if item['ext'] not in ('.doc', '.docx', '.rtf', '.odt'):
        continue
    if os.path.exists(os.path.join(out_dir, item['sha256'] + '.txt')):
        continue
    pending[item['sha256']] = item

print(f'{len(pending)} documentos por convertir')
with tempfile.TemporaryDirectory() as staging:
    inputs = []
    for digest, item in pending.items():
        target = os.path.join(staging, digest + item['ext'])
        shutil.copyfile(os.path.join(main_root, item['rel']), target)
        inputs.append(target)
    for start in range(0, len(inputs), 40):
        batch = inputs[start:start + 40]
        subprocess.run([soffice, '--headless', '--convert-to', 'txt:Text (encoded):UTF8', '--outdir', out_dir, *batch],
                       check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=900)
        print(f'  {min(start + 40, len(inputs))}/{len(inputs)}', flush=True)
done = sum(1 for d in pending if os.path.exists(os.path.join(out_dir, d + '.txt')))
print(f'Convertidos: {done}/{len(pending)}')
