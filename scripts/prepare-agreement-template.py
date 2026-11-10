#!/usr/bin/env python3

from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile

from docx import Document
from docx.oxml.ns import qn


TOKEN_LOCATORS = {
    (4, 1): "AGREEMENT_NUMBER",
    (7, 1): "HEARING_TIME",
    (7, 3): "HEARING_DAY",
    (7, 5): "HEARING_MONTH",
    (7, 11): "CASE_FILE_NUMBER",
    (7, 15): "AGREEMENT_NUMBER",
    (9, 2): "REQUESTING_HONORIFIC",
    (9, 4): "REQUESTING_NAME",
    (10, 2): "COMPLEMENTARY_HONORIFIC",
    (10, 4): "COMPLEMENTARY_NAME",
    (11, 2): "GUARANTOR_HONORIFIC",
    (11, 4): "GUARANTOR_NAME",
    (17, 1): "LEASE_EXECUTION_DAY_MONTH",
    (17, 7): "PROPERTY_ADDRESS",
    (17, 9): "LEASE_DURATION",
    (17, 11): "LEASE_START_DATE",
    (17, 14): "LEASE_END_DATE",
    (21, 4): "REQUESTING_HONORIFIC_NO_ARTICLE",
    (21, 6): "REQUESTING_NAME",
    (23, 2): "REQUESTING_CAPABLE_ADJECTIVE",
    (25, 2): "REQUESTING_ORIGIN_ADJECTIVE",
    (25, 4): "REQUESTING_BIRTH_CITY",
    (25, 6): "REQUESTING_BIRTH_STATE",
    (25, 8): "REQUESTING_MARITAL_STATUS",
    (25, 10): "REQUESTING_OCCUPATION",
    (25, 12): "REQUESTING_ADDRESS",
    (25, 14): "REQUESTING_TAX_ID",
    (25, 16): "REQUESTING_PRONOUN",
    (25, 18): "REQUESTING_IDENTIFICATION",
    (27, 2): "REQUESTING_OWNER_ADJECTIVE",
    (27, 4): "PROPERTY_OWNERSHIP_EVIDENCE",
    (31, 4): "COMPLEMENTARY_HONORIFIC_NO_ARTICLE",
    (31, 6): "COMPLEMENTARY_NAME",
    (33, 2): "COMPLEMENTARY_CAPABLE_ADJECTIVE",
    (35, 2): "COMPLEMENTARY_ORIGIN_ADJECTIVE",
    (35, 4): "COMPLEMENTARY_BIRTH_CITY",
    (35, 6): "COMPLEMENTARY_BIRTH_STATE",
    (35, 8): "COMPLEMENTARY_MARITAL_STATUS",
    (35, 10): "COMPLEMENTARY_OCCUPATION",
    (35, 12): "COMPLEMENTARY_ADDRESS",
    (35, 14): "COMPLEMENTARY_TAX_ID",
    (35, 16): "COMPLEMENTARY_PRONOUN",
    (35, 18): "COMPLEMENTARY_IDENTIFICATION",
    (43, 4): "GUARANTOR_NAME",
    (47, 2): "GUARANTOR_CAPABLE_ADJECTIVE",
    (49, 2): "GUARANTOR_ORIGIN_ADJECTIVE",
    (49, 4): "GUARANTOR_BIRTH_CITY",
    (49, 6): "GUARANTOR_BIRTH_STATE",
    (49, 8): "GUARANTOR_MARITAL_STATUS",
    (49, 10): "GUARANTOR_OCCUPATION",
    (49, 12): "GUARANTOR_ADDRESS",
    (49, 14): "GUARANTOR_TAX_ID",
    (49, 16): "GUARANTOR_PRONOUN",
    (49, 18): "GUARANTOR_IDENTIFICATION",
    (51, 2): "GUARANTEE_PROPERTY_ADDRESS",
    (51, 4): "GUARANTEE_OWNERSHIP_EVIDENCE",
    (73, 11): "RENT_AMOUNT",
    (73, 15): "PAYMENT_METHOD",
    (90, 4): "LEASE_END_DATE",
    (148, 1): "REQUESTING_NAME",
    (148, 3): "COMPLEMENTARY_NAME",
    (155, 0): "GUARANTOR_NAME",
}


def marker(token: str) -> str:
    return f"[[{token}]]"


def replace_required(run, old: str, new: str, locator: tuple[int, int]):
    if old not in run.text:
        raise RuntimeError(f"No se encontró {old!r} en el run {locator}")
    run.text = run.text.replace(old, new)


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Uso: prepare-agreement-template.py referencia.docx salida.docx")

    source = Path(sys.argv[1]).resolve()
    destination = Path(sys.argv[2]).resolve()
    if source == destination:
        raise SystemExit("La salida debe ser distinta de la referencia")

    document = Document(source)
    if len(document.paragraphs) != 167:
        raise RuntimeError("La referencia del convenio cambió de estructura")

    for locator, token in TOKEN_LOCATORS.items():
        paragraph_index, run_index = locator
        run = document.paragraphs[paragraph_index].runs[run_index]
        run.text = marker(token)

    document.paragraphs[2].runs[0].text = f"CENTRO PRIVADO NÚMERO {marker('CENTER_ACCREDITATION_DISPLAY')}."
    document.paragraphs[3].runs[0].text = f"CERTIFICACIÓN NÚMERO {marker('FACILITATOR_CERTIFICATION_DISPLAY')}  "

    paragraph = document.paragraphs[7]
    replace_required(
        paragraph.runs[6],
        "2026 dos mil veintiséis",
        marker("HEARING_YEAR_DISPLAY"),
        (7, 6),
    )
    paragraph.runs[7].text = marker("CENTER_NAME")
    replace_required(
        paragraph.runs[8],
        "100 cien",
        marker("CENTER_ACCREDITATION_DISPLAY"),
        (7, 8),
    )
    paragraph.runs[9].text = marker("FACILITATOR_NAME")
    replace_required(
        paragraph.runs[10],
        "244 doscientos cuarenta y cuatro",
        marker("FACILITATOR_CERTIFICATION_DISPLAY"),
        (7, 10),
    )

    replace_required(
        document.paragraphs[17].runs[2],
        "2026 dos mil veintiséis",
        marker("LEASE_EXECUTION_YEAR_DISPLAY"),
        (17, 2),
    )
    document.paragraphs[59].runs[2].text = f"{marker('FACILITATOR_NAME')}, "
    document.paragraphs[140].runs[1].text = (
        "Solicito que una vez que se haya validado el presente Convenio, se nos expidan "
        f"{marker('CERTIFIED_COPIES_DISPLAY')} juegos de copias certificadas de la Sanción del mismo."
    )
    document.paragraphs[162].runs[0].text = f"Licenciado {marker('FACILITATOR_NAME')}."
    document.paragraphs[164].runs[0].text = (
        f"Certificación {marker('FACILITATOR_CERTIFICATION_DISPLAY')}, "
        "Instituto de Justicia Alternativa (IJA)."
    )
    document.paragraphs[165].runs[0].text = (
        f"Centro Privado Número {marker('CENTER_ACCREDITATION_DISPLAY')} del Estado de Jalisco, "
        f"{marker('CENTER_NAME')}."
    )

    for highlight in list(document.element.body.iter(qn("w:highlight"))):
        highlight.getparent().remove(highlight)

    document.core_properties.title = "Convenio final de método alternativo v1"
    document.core_properties.author = "Tabelio"
    document.core_properties.last_modified_by = "Tabelio"

    destination.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix="agreement-template-") as temporary_directory:
        rewritten = Path(temporary_directory) / "rewritten.docx"
        document.save(rewritten)
        with ZipFile(source) as original_zip, ZipFile(rewritten) as rewritten_zip:
            replacements = {
                "word/document.xml": rewritten_zip.read("word/document.xml"),
                "docProps/core.xml": rewritten_zip.read("docProps/core.xml"),
            }
            with ZipFile(destination, "w", compression=ZIP_DEFLATED) as output_zip:
                for info in original_zip.infolist():
                    output_zip.writestr(info, replacements.get(info.filename, original_zip.read(info.filename)))
    print(f"Plantilla preparada: {destination}")


if __name__ == "__main__":
    main()
