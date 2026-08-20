"""Pair every checkbox glyph in the blank TDS with the label text that follows it."""
import fitz, re, json, sys

def glyph_labels(path="assets/ca-tds-blank.pdf"):
    doc = fitz.open(path)
    out = []
    for pno, page in enumerate(doc):
        for blk in page.get_text("rawdict")["blocks"]:
            for ln in blk.get("lines", []):
                chars = [c for sp in ln["spans"] for c in sp["chars"]]
                chars.sort(key=lambda c: c["bbox"][0])
                marks = [i for i, c in enumerate(chars) if c["c"] in "□☐"]
                for j, i in enumerate(marks):
                    stop = marks[j + 1] if j + 1 < len(marks) else len(chars)
                    label = "".join(c["c"] for c in chars[i + 1 : stop])
                    label = re.sub(r"[.…_]{2,}", " ", label)
                    label = re.sub(r"\s+", " ", label).strip(" .:_")
                    b = chars[i]["bbox"]
                    out.append({
                        "page": pno,
                        "x0": round(b[0], 2), "y0": round(b[1], 2),
                        "x1": round(b[2], 2), "y1": round(b[3], 2),
                        "label": label,
                    })
    return out

if __name__ == "__main__":
    boxes = glyph_labels()
    if "--json" in sys.argv:
        print(json.dumps(boxes, indent=1))
    else:
        for b in boxes:
            print(f'p{b["page"]} x={b["x0"]:6.1f} y={b["y0"]:6.1f}  {b["label"][:70]!r}')
