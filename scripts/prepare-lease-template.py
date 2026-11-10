#!/usr/bin/env python3

from pathlib import Path
import sys

from docx import Document
from docx.oxml.ns import qn


YELLOW_TOKENS = [
    "LANDLORD_NAME",
    "TENANT_NAME",
    "GUARANTOR_NAME",
    "PROPERTY_ADDRESS",
    "RENT_AMOUNT",
    "PAYMENT_METHOD",
    "START_DATE",
    "END_DATE",
    "TOTAL_INITIAL_PAYMENT",
    "PREPAID_RENT_AMOUNT",
    "DEPOSIT_AMOUNT",
    "GUARANTOR_NAME",
    "GUARANTEE_PROPERTY_ADDRESS",
    "GUARANTEE_OWNERSHIP_EVIDENCE",
    "LANDLORD_NAME",
    "TENANT_NAME",
    "GUARANTOR_NAME",
    "EXECUTION_DATE",
    "LANDLORD_NAME",
    "TENANT_NAME",
    "GUARANTOR_NAME",
]


GREEN_LOCATORS = {
    (0, 3): "LANDLORD_HONORIFIC",
    (0, 8): "LANDLORD_RELATIVE_ARTICLE",
    (0, 10): "LANDLORD_ROLE",
    (0, 12): "TENANT_HONORIFIC",
    (0, 16): "TENANT_RELATIVE_ARTICLE",
    (0, 18): "TENANT_ROLE",
    (0, 20): "GUARANTOR_HONORIFIC",
    (4, 2): "LANDLORD_ROLE",
    (4, 4): "TENANT_ROLE",
    (8, 2): "PROPERTY_USE",
    (8, 4): "TENANT_ROLE",
    (8, 6): "LANDLORD_OWNER_ADJECTIVE",
    (14, 2): "PROPERTY_USE",
    (24, 1): "LANDLORD_ROLE",
    (24, 4): "LANDLORD_ROLE",
    (26, 1): "TENANT_ROLE",
    (28, 2): "LANDLORD_ROLE",
    (30, 2): "TENANT_ROLE",
    (32, 2): "TENANT_ROLE",
    (32, 4): "LANDLORD_ROLE",
    (36, 2): "TENANT_ROLE",
    (36, 4): "TENANT_ROLE",
    (38, 0): "TENANT_ROLE",
    (40, 0): "TENANT_ROLE",
    (46, 2): "TENANT_ONLY_ADJECTIVE_UPPER",
    (46, 4): "TENANT_CITED_ADJECTIVE",
    (46, 6): "TENANT_REQUIRED_ADJECTIVE",
    (54, 2): "TENANT_ROLE",
    (54, 4): "LANDLORD_ROLE",
    (78, 0): "LANDLORD_ROLE",
    (81, 0): "TENANT_ROLE",
    (84, 0): "GUARANTOR_ROLE_WITH_COLON",
    (91, 1): "LANDLORD_ROLE_WITH_COLON",
    (91, 3): "TENANT_ROLE_WITH_COLON",
    (97, 0): "GUARANTOR_ROLE_WITH_COLON",
}

ROLE_REPLACEMENTS = (
    ("La Arrendadora", "[[LANDLORD_ROLE]]"),
    ("El Arrendador", "[[LANDLORD_ROLE]]"),
    ("La Arrendataria", "[[TENANT_ROLE]]"),
    ("El Arrendatario", "[[TENANT_ROLE]]"),
    ("La Obligada Solidaria", "[[GUARANTOR_ROLE]]"),
    ("El Obligado Solidario", "[[GUARANTOR_ROLE]]"),
    ("Obligado Solidario", "[[GUARANTOR_ROLE_NO_ARTICLE]]"),
)


def remove_paragraph(paragraph):
    element = paragraph._element
    element.getparent().remove(element)


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Uso: prepare-lease-template.py referencia.docx salida.docx")

    source = Path(sys.argv[1]).resolve()
    destination = Path(sys.argv[2]).resolve()
    if source == destination:
        raise SystemExit("La salida debe ser distinta de la referencia")

    document = Document(source)
    yellow_index = 0

    for paragraph_index, paragraph in enumerate(document.paragraphs):
        for run_index, run in enumerate(paragraph.runs):
            locator = (paragraph_index, run_index)
            if locator in GREEN_LOCATORS:
                run.text = f"[[{GREEN_LOCATORS[locator]}]]"
            if run.text == "_______________" and run.font.highlight_color is not None:
                if yellow_index >= len(YELLOW_TOKENS):
                    raise RuntimeError("La referencia contiene más espacios amarillos que el contrato")
                run.text = f"[[{YELLOW_TOKENS[yellow_index]}]]"
                yellow_index += 1
            for source_text, marker in ROLE_REPLACEMENTS:
                run.text = run.text.replace(source_text, marker)
            run.text = run.text.replace("está enterada", "está [[TENANT_AWARE_ADJECTIVE]]")
            run.text = run.text.replace("está enterado", "está [[TENANT_AWARE_ADJECTIVE]]")
            run.font.highlight_color = None

    if yellow_index != len(YELLOW_TOKENS):
        raise RuntimeError(
            f"Se esperaban {len(YELLOW_TOKENS)} espacios amarillos y se encontraron {yellow_index}"
        )

    # Algunas versiones antiguas de Word guardan el resaltado como formato predeterminado
    # del párrafo, aunque el texto visible esté en otro run.
    for highlight in list(document.element.body.iter(qn("w:highlight"))):
        highlight.getparent().remove(highlight)

    # Elimina separadores vacíos del bloque de firmas que enviaban una sola firma a una sexta página.
    for paragraph_index in (99, 98, 93, 92):
        paragraph = document.paragraphs[paragraph_index]
        if paragraph.text:
            raise RuntimeError(f"El párrafo {paragraph_index} dejó de estar vacío")
        remove_paragraph(paragraph)

    document.core_properties.title = "Contrato de arrendamiento v1"
    document.core_properties.author = "Tabelio"
    document.core_properties.last_modified_by = "Tabelio"

    destination.parent.mkdir(parents=True, exist_ok=True)
    document.save(destination)
    print(f"Plantilla preparada: {destination}")


if __name__ == "__main__":
    main()
