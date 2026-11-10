#!/usr/bin/env python3
"""Organiza las fuentes de Saul y Alex sin modificar originales ni la aplicación.

Requiere una revisión por documento, ligada al SHA-256 del original. En macOS,
textutil extrae el texto para consulta; los .doc se conservan byte por byte.
"""

import argparse
import csv
import hashlib
import json
import re
import shutil
import subprocess
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import quote


TIPOS = {
    "contrato_arrendamiento": ("01-contratos/arrendamiento", "Contrato de arrendamiento"),
    "contrato_promesa_compraventa": ("01-contratos/promesa-compraventa", "Contrato de promesa de compraventa"),
    "convenio_arrendamiento": ("02-convenios/arrendamiento", "Convenio de arrendamiento"),
    "convenio_promesa_compraventa": ("02-convenios/promesa-compraventa", "Convenio de promesa de compraventa"),
    "convenio_divorcio": ("02-convenios/divorcio", "Convenio de divorcio"),
    "convenio_franquicia": ("02-convenios/franquicia", "Convenio de franquicia"),
    "convenio_reconocimiento_adeudo": ("02-convenios/reconocimiento-adeudo", "Convenio de reconocimiento de adeudo"),
    "convenio_otro": ("02-convenios/otros", "Otro convenio"),
    "caratula": ("03-caratulas", "Carátula"),
    "solicitud_viabilidad_acuerdo": ("04-solicitud-viabilidad-acuerdo", "Solicitud, viabilidad y acuerdo"),
    "oficio_ija": ("05-oficios/ija", "Oficio al IJA"),
    "oficio_ija_exencion_pago": ("05-oficios/ija-exencion-pago", "Oficio de exención de pago al IJA"),
    "oficio_procuraduria_social": ("05-oficios/procuraduria-social", "Oficio a Procuraduría Social"),
    "acuerdo_cancelacion_archivo": ("06-cancelacion-y-archivo", "Acuerdo de cancelación y archivo"),
    "aviso_privacidad": ("07-recursos-institucionales/aviso-privacidad", "Aviso de privacidad"),
    "recurso_institucional": ("07-recursos-institucionales/otros", "Recurso institucional"),
}
USOS = {"plantilla_base", "modelo_personalizado", "caso_referencia", "recurso_institucional"}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def slug(value):
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", value).strip("-") or "documento"


def dump(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def link(path):
    return quote(str(path), safe="/-_.")


def safe_text(value):
    return str(value).replace("|", "\\|").replace("\n", " ")


def source_paths(root):
    return sorted(
        p for name in ("Saul", "Alex") for p in (root / name).rglob("*")
        if p.is_file() and p.name not in {".DS_Store", "Thumbs.db", "AGENTS.md"}
    )


def verify(root, output):
    catalog = json.loads((output / "catalogo.json").read_text(encoding="utf-8"))
    errors = []
    docs = catalog["documentos"]
    for field in ("id", "ruta_original", "ruta_organizada", "ruta_texto"):
        if len({d[field] for d in docs}) != len(docs):
            errors.append({"error": "identificadores_o_rutas_repetidos", "campo": field})
    expected = {d["ruta_original"] for d in docs}
    actual = {p.relative_to(root).as_posix() for p in source_paths(root)}
    if expected != actual:
        errors.append({"inventario_originales": {"sin_catalogar": sorted(actual - expected), "no_encontrados": sorted(expected - actual)}})
    for d in docs:
        for key, base in (("ruta_original", root), ("ruta_organizada", output)):
            p = base / d[key]
            if not p.is_file() or sha(p.read_bytes()) != d["sha256"]:
                errors.append({"id": d["id"], "error": "hash_o_archivo", "ruta": d[key]})
        p = output / d["ruta_texto"]
        if not p.is_file() or sha(p.read_bytes()) != d["sha256_texto"]:
            errors.append({"id": d["id"], "error": "texto_modificado_o_ausente"})
        if not d["revision"]["tipo_documental"] or not d["revision"]["materia"]:
            errors.append({"id": d["id"], "error": "clasificacion_incompleta"})
        if d["revision"].get("sha256_revisado") != d["sha256"]:
            errors.append({"id": d["id"], "error": "revision_no_corresponde_al_original"})
    listed = {d["ruta_organizada"] for d in docs}
    copied = {p.relative_to(output).as_posix() for p in (output / "por-tipo").rglob("*") if p.is_file()}
    if copied != listed:
        errors.append({"copias": {"sobrantes": sorted(copied - listed), "faltantes": sorted(listed - copied)}})
    result = {"correcto": not errors, "originales_comprobados": len(actual), "copias_comprobadas": len(docs),
              "textos_comprobados": len(docs), "errores": errors}
    dump(output / "control-calidad.json", result)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if errors:
        raise SystemExit(1)


def build(root, output, review_path):
    review_file = json.loads(review_path.read_text(encoding="utf-8"))
    reviews = {r["id"]: r for r in review_file["documentos"]}
    if len(reviews) != len(review_file["documentos"]):
        raise SystemExit("La revisión contiene identificadores repetidos")
    paths = source_paths(root)
    pending = []
    for p in paths:
        rel = p.relative_to(root).as_posix()
        ident = p.relative_to(root).parts[0].lower() + "-" + sha(rel.encode())[:12]
        review = reviews.get(ident)
        if not review or review.get("sha256_revisado") != sha(p.read_bytes()):
            pending.append(rel)
        elif review["tipo_documental"] not in TIPOS or review["uso_propuesto"] not in USOS:
            raise SystemExit(f"Clasificación no reconocida: {ident}")
    if pending:
        raise SystemExit("Falta revisión vigente para: " + json.dumps(pending, ensure_ascii=False))
    if len(paths) != len(reviews):
        raise SystemExit("La revisión contiene documentos que ya no están en las fuentes")

    docs, packages = [], {}
    binary, normalized = defaultdict(list), defaultdict(list)
    for p in paths:
        rel = p.relative_to(root).as_posix()
        source = p.relative_to(root).parts[0]
        ident = source.lower() + "-" + sha(rel.encode())[:12]
        review = reviews[ident]
        data = p.read_bytes()
        if p.suffix.lower() != ".doc" or not data.startswith(bytes.fromhex("d0cf11e0a1b11ae1")):
            raise SystemExit(f"Formato inesperado: {rel}")
        extracted = subprocess.run(["/usr/bin/textutil", "-convert", "txt", "-stdout", str(p)], capture_output=True, check=True)
        text = extracted.stdout.decode("utf-8")
        if not text.strip():
            raise SystemExit(f"Texto vacío: {rel}")
        # Los documentos sueltos no se agrupan con otros documentos de la raíz.
        package_source = p.parent.relative_to(root).as_posix() if len(p.relative_to(root).parts) > 2 else rel
        package_id = source.lower() + "-paquete-" + sha(package_source.encode())[:10]
        context = p.parent.relative_to(root / source).as_posix()
        context = slug(context) if context != "." else "documentos-independientes"
        folder, label = TIPOS[review["tipo_documental"]]
        dest = Path("por-tipo") / folder / source / context / (slug(p.stem) + "__" + ident + ".doc")
        target = output / dest
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and target.read_bytes() != data:
            raise SystemExit(f"La copia existente cambió; se conserva para revisión: {target}")
        if not target.exists():
            shutil.copy2(p, target)
        text_path = Path("analisis/textos") / source / (ident + ".txt")
        (output / text_path).parent.mkdir(parents=True, exist_ok=True)
        (output / text_path).write_bytes(extracted.stdout)
        text_hash = sha(re.sub(r"\s+", " ", text).strip().encode())
        binary[sha(data)].append(ident)
        normalized[text_hash].append(ident)
        template = review["uso_propuesto"] in {"plantilla_base", "modelo_personalizado"}
        doc = {
            "id": ident, "procedencia": source, "ruta_original": rel, "nombre_original": p.name,
            "ruta_organizada": dest.as_posix(), "ruta_texto": text_path.as_posix(), "paquete_id": package_id,
            "formato": {"extension": ".doc", "mime": "application/msword", "firma": "OLE Compound File / Word binario"},
            "bytes": len(data), "sha256": sha(data), "sha256_texto": sha(extracted.stdout),
            "sha256_texto_espacios_normalizados": text_hash, "caracteres_texto": len(text),
            "marcadores_subrayado": len(re.findall(r"_{3,}", text)),
            "caracteres_reemplazo": text.count("\ufffd"),
            "tipo_etiqueta": label, "revision": review,
            "duplicado_exacto_de": None, "texto_equivalente_a": None,
            "destino_propuesto": {
                "modalidad": "candidato_catalogo_plantillas" if template else "referencia_documental",
                "matterKind_existente_relacionado": "LEASE" if review["tipo_documental"] == "contrato_arrendamiento" else (
                    "MEDIATION_AGREEMENT" if review["tipo_documental"] == "convenio_arrendamiento" else None),
                "documentType_archivo_referencia": "OTHER", "requiere_asignar_expediente": True,
                "plantilla_generable_actualmente": False, "importacion_automatica_habilitada": False,
                "estado": "pendiente_revision_y_preparacion", "matterId": None, "templateId": None,
            },
        }
        docs.append(doc)
        package = packages.setdefault(package_id, {"id": package_id, "procedencia": source,
            "agrupacion_original": package_source, "criterio": "carpeta_original" if package_source != rel else "documento_independiente",
            "documentos": [], "tipos_presentes": [], "materias_detectadas": [], "observaciones": []})
        package["documentos"].append(ident)
        package["tipos_presentes"].append(review["tipo_documental"])
        package["materias_detectadas"].append(review["materia"])

    by_id = {d["id"]: d for d in docs}
    duplicates = {"criterio_exacto": "SHA-256 de todos los bytes del original",
        "criterio_texto": "Texto extraído con espacios consecutivos normalizados; no compara formato ni imágenes",
        "exactos": [], "texto_equivalente": []}
    for key, groups, field in (("exactos", binary, "duplicado_exacto_de"), ("texto_equivalente", normalized, "texto_equivalente_a")):
        for digest, ids in groups.items():
            if len(ids) < 2:
                continue
            duplicates[key].append({"sha256": digest, "referencia": ids[0], "documentos": ids,
                "rutas_originales": [by_id[i]["ruta_original"] for i in ids]})
            for ident in ids[1:]:
                by_id[ident][field] = ids[0]
    for package in packages.values():
        package["tipos_presentes"] = sorted(set(package["tipos_presentes"]))
        package["materias_detectadas"] = sorted(set(package["materias_detectadas"]))
        if len(package["materias_detectadas"]) > 1:
            package["observaciones"].append("Hay materias distintas o mixtas en los documentos de esta carpeta; revisar su correspondencia antes de asociarlos a un expediente.")
        types = set(package["tipos_presentes"])
        if "solicitud_viabilidad_acuerdo" in types:
            for expected, explanation in (("oficio_procuraduria_social", "No hay oficio a Procuraduría Social en esta carpeta de origen; confirmar si corresponde."),
                                           ("caratula", "No hay carátula en esta carpeta de origen; confirmar si corresponde.")):
                if expected not in types:
                    package["observaciones"].append(explanation)
        package["observaciones"].append("Agrupación documental de origen; no acredita que exista un expediente real ni que esté completo.")

    summary = {"archivos": len(docs), "por_procedencia": dict(Counter(d["procedencia"] for d in docs)),
        "bytes_originales": sum(d["bytes"] for d in docs), "contenido_binario_unico": len(binary),
        "copias_exactas_adicionales": len(docs) - len(binary), "grupos_duplicados_exactos": len(duplicates["exactos"]),
        "textos_normalizados_unicos": len(normalized), "paquetes_documentales": len(packages),
        "por_tipo": dict(sorted(Counter(d["revision"]["tipo_documental"] for d in docs).items())),
        "por_uso_propuesto": dict(sorted(Counter(d["revision"]["uso_propuesto"] for d in docs).items())),
        "extracciones_texto_correctas": len(docs), "fuentes_modificadas": 0}
    dump(output / "catalogo.json", {"version_esquema": 1, "fecha_revision": review_file["fecha_revision"],
        "alcance": "Organización y análisis; sin importación, parametrización ni modificación de fuentes",
        "resumen": summary, "documentos": docs})
    dump(output / "duplicados.json", duplicates)
    dump(output / "paquetes.json", {"paquetes": list(packages.values())})
    with (output / "catalogo.csv").open("w", newline="", encoding="utf-8-sig") as handle:
        fields = ["id", "procedencia", "tipo_documental", "materia", "uso_propuesto", "variante", "paquete_id", "ruta_original", "ruta_organizada", "sha256", "duplicado_exacto_de", "observaciones", "bloqueos_integracion"]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for doc in docs:
            row = {k: doc.get(k, doc["revision"].get(k, "")) for k in fields}
            row = {k: " | ".join(str(x) for x in v) if isinstance(v, list) else v for k, v in row.items()}
            # Evita fórmulas al abrir campos provenientes de documentos en Excel.
            row = {k: "'" + v if isinstance(v, str) and v.startswith(("=", "+", "-", "@")) else v for k, v in row.items()}
            writer.writerow(row)
    lines = ["# Índice de documentos de Saul y Alex", "", "Cada enlace abre una copia íntegra. El paquete conserva la relación con la carpeta de origen.", ""]
    for package in packages.values():
        lines.extend(["## " + package["agrupacion_original"], "", f"Paquete `{package['id']}`.", "", "| Documento | Tipo por contenido | Uso propuesto | Copia idéntica de |", "| --- | --- | --- | --- |"])
        for ident in package["documentos"]:
            doc = by_id[ident]
            lines.append(f"| [{safe_text(doc['nombre_original'])}]({link(doc['ruta_organizada'])}) | {doc['tipo_etiqueta']} | {doc['revision']['uso_propuesto']} | {doc['duplicado_exacto_de'] or '—'} |")
        lines.extend(["", *["- " + note for note in package["observaciones"]], ""])
    (output / "INDICE.md").write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    verify(root, output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raiz", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--salida", type=Path, default=Path("documentos-organizados/saul-alex"))
    parser.add_argument("--revisiones", type=Path)
    parser.add_argument("--verificar", action="store_true")
    args = parser.parse_args()
    root = args.raiz.resolve()
    output = (args.salida if args.salida.is_absolute() else root / args.salida).resolve()
    if any(output.is_relative_to(root / name) or (root / name).is_relative_to(output) for name in ("Saul", "Alex")):
        raise SystemExit("La salida debe estar separada de las carpetas fuente")
    if args.verificar:
        verify(root, output)
    else:
        review_path = args.revisiones or output / "analisis/revision-por-documento.json"
        build(root, output, review_path)


if __name__ == "__main__":
    main()
