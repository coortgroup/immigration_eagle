"""Embed the transparent eagle logo in the interactive design preview."""
from pathlib import Path
import base64
import argparse
import json

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, default=root / "preview/immigration-eagle.html")
args = parser.parse_args()
source = (root / "prototype/immigration-eagle.html").read_text()
for token, filename in [("__PREPARATION_CSS__", "preparation-flow.css"), ("__QUALIFICATION_ENGINE__", "qualification-engine.js"), ("__PREPARATION_FLOW__", "preparation-flow.js")]:
    assert source.count(token) == 1
    source = source.replace(token, (root / "prototype" / filename).read_text())
logo = base64.b64encode((root / "assets/eagle-logo.png").read_bytes()).decode()
assert source.count("__EAGLE_IMAGE__") == 1
result = source.replace("__EAGLE_IMAGE__", "data:image/png;base64," + logo)
for token, filename in [("__FORM_CATALOG__", "forms-catalog.json"), ("__FORM_FINDER__", "form-finder.json"), ("__FORM_PRICING__", "form-pricing.json"), ("__ATTORNEY_PRICING__", "attorney-pricing.json"), ("__ELIGIBILITY_MAIN__", "eligibility-main.json"), ("__ELIGIBILITY_OTHER__", "eligibility-other.json"), ("__PREPARATION_FIELDS__", "preparation-fields.json")]:
    assert result.count(token) == 1
    data = json.loads((root / "data" / filename).read_text())
    result = result.replace(token, json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))
assert len(result.encode()) < 1_000_000
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(result)
print(args.output)
