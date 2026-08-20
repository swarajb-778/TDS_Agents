"""
Produce the template base PDF.

The attached TDS is a paraphrased regeneration of the C.A.R. form, and its
header fields are literal "[City]" / "[County]" / "[Date]" tokens sitting inline
in a sentence rather than blank lines. A DocuSeal text field placed over one of
those renders on top of the placeholder and both become unreadable, so the
tokens are removed here. They exist to be replaced; this is that replacement.

    python3 scripts/prepare_pdf.py
"""
import fitz, re, sys

SRC = "assets/ca-tds-blank.pdf"
OUT = "assets/ca-tds-template.pdf"

doc = fitz.open(SRC)
removed = 0
for page in doc:
    for token in set(re.findall(r"\[[^\]\n]{1,40}\]", page.get_text())):
        for rect in page.search_for(token):
            # Nudge inward so we do not clip the neighbouring words.
            page.add_redact_annot(rect + (0.4, 0.4, -0.4, -0.4), fill=(1, 1, 1))
            removed += 1
    page.apply_redactions()

doc.save(OUT, garbage=3, deflate=True)
print(f"removed {removed} placeholder tokens -> {OUT}")

check = fitz.open(OUT)
left = [t for p in check for t in re.findall(r"\[[^\]\n]{1,40}\]", p.get_text())]
print("placeholders remaining:", left or "none")
if left:
    sys.exit(1)
