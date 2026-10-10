#!/usr/bin/env python3
"""Inventory official USCIS PDF widgets; this is evidence, not a questionnaire.

Run with the bundled Python runtime (pdfplumber required). Downloads are public
blank forms only. No applicant data is read or transmitted. Field dispositions
are conservative review hints and must not be treated as legal/form coverage.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import urllib.request

import pdfplumber
from pdfminer.pdftypes import PDFStream, resolve1
from pdfminer.psparser import PSLiteral
from pdfminer.utils import decode_text

ROOT = Path(__file__).resolve().parents[1]


def string(value):
    value = resolve1(value)
    if isinstance(value, bytes):
        return decode_text(value).replace('\r', '\n')
    if isinstance(value, PSLiteral):
        return value.name
    return str(value) if value is not None else None


def inherited(data, key):
    while data:
        if key in data:
            return resolve1(data[key])
        data = resolve1(data.get('Parent', {}))
    return None


def qualified(data):
    result = []
    while data:
        if 'T' in data:
            result.append(string(data['T']))
        data = resolve1(data.get('Parent', {}))
    return '.'.join(reversed(result))


def disposition(field):
    label = field['label'] or ''
    name = field['shortName'] or ''
    if re.search(r'barcode', name + ' ' + label, re.I):
        return 'barcode', 'USCIS barcode: never collect or synthesize.'
    if re.search(r'print and sign|signature field|not be typewritten|do not sign|do not complete.*USCIS', label, re.I):
        return 'signature', 'Preserve blank for the named signer; never infer a signature.'
    if re.search(r'signature', name, re.I) and not re.search(r'date', name, re.I):
        return 'signature', 'Potential signature: manual confirmation required; do not populate.'
    if re.search(r'USCIS use only|for.*(?:USCIS|government).*use only|USCIS only', label, re.I):
        return 'government', 'Reserved for agency use.'
    if re.search(r'pre.?populate|auto.?populate|auto.?fill|automatically', label, re.I) and field['readOnly']:
        return 'derived', 'Possible repeated/copy field; explicitly map to an answer after review.'
    if not label:
        return 'review', 'Official tooltip is missing; inspect the visible page.'
    return 'review', 'Not reviewed: widget is not equivalent to one questionnaire question.'


def download(form, cache):
    path = cache / (form['id'].lower() + '.pdf')
    request = urllib.request.Request(form['pdfUrl'], headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            data = response.read()
            if not data.startswith(b'%PDF-'):
                raise ValueError('Official URL did not return a PDF')
            path.write_bytes(data)
            return form['id'], {'path': str(path), 'verifiedAt': datetime.now(timezone.utc).isoformat(), 'httpStatus': response.status, 'finalUrl': response.url}
    except Exception as error:
        candidates = [Path('/tmp') / f"eagle-{form['id'].lower()}.pdf", Path('/tmp') / f"eagle-other-{form['id'].lower()}.pdf"]
        fallback = next((p for p in candidates if p.is_file()), None)
        if fallback is None:
            raise
        return form['id'], {'path': str(fallback), 'verifiedAt': None, 'verificationError': str(error), 'cachedOnly': True}


def inspect(form, source):
    path = Path(source['path'])
    widgets = []
    page_texts = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            page_texts.append(page.extract_text() or '')
            for annotation in page.annots:
                data = annotation['data']
                if string(data.get('Subtype')) != 'Widget':
                    continue
                flags = int(inherited(data, 'Ff') or 0)
                appearance = resolve1(resolve1(data.get('AP', {})).get('N', {}))
                export_states = [string(key) for key in appearance if string(key) != 'Off'] if isinstance(appearance, dict) else []
                options = inherited(data, 'Opt')
                field = {
                    'id': qualified(data),
                    'name': qualified(data),
                    'shortName': string(data.get('T')),
                    'label': string(inherited(data, 'TU')),
                    'type': '/' + (string(inherited(data, 'FT')) or ''),
                    'page': page.page_number,
                    'rect': [round(float(value), 3) for value in data.get('Rect', [])],
                    'maxLength': inherited(data, 'MaxLen'),
                    'options': [([string(value) for value in option] if isinstance(option, list) else string(option)) for option in options] if options else [],
                    'exportStates': export_states,
                    'flags': flags,
                    'multiline': bool(flags & 4096),
                    'comb': bool(flags & 16777216),
                    'readOnly': bool(flags & 1),
                    'multiSelect': bool(flags & 2097152),
                }
                field['disposition'], field['reason'] = disposition(field)
                widgets.append(field)
        catalog = pdf.doc.catalog
        acroform = resolve1(catalog.get('AcroForm', {}))
        has_xfa = bool(acroform.get('XFA'))
        page_sizes = [[float(p.width), float(p.height)] for p in pdf.pages]
    editions = sorted(set(re.findall(r'Edition\s+(\d{2}/\d{2}/\d{2})', '\n'.join(page_texts))))
    if not editions:
        # G-1145 prints its edition in the footer without the word "Edition".
        editions = sorted(set(re.findall(r'Form\s+' + re.escape(form['id']) + r'\s+(\d{2}/\d{2}/\d{2})', '\n'.join(page_texts))))
    counts = {}
    for field in widgets:
        counts[field['disposition']] = counts.get(field['disposition'], 0) + 1
    return {
        'id': form['id'],
        'sourceUrl': form.get('sourceUrl'),
        'sourcePdfUrl': form['pdfUrl'],
        'instructionsUrl': form.get('instructionsUrl'),
        'sourceVerification': {key: value for key, value in source.items() if key != 'path'},
        'originalSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'edition': editions[0] if len(editions) == 1 else editions,
        'pageCount': len(page_sizes),
        'pageSizes': page_sizes,
        'hasXfa': has_xfa,
        'widgetCount': len(widgets),
        'uniqueFieldNameCount': len({f['name'] for f in widgets}),
        'tooltipCount': sum(bool(f['label']) for f in widgets),
        'dispositionCounts': counts,
        'coverageStatus': 'unreviewed-widget-inventory',
        'fields': widgets,
    }, page_texts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', type=Path, default=Path('/tmp/fillout-uscis-inventory'))
    parser.add_argument('--output', type=Path, default=ROOT / 'data/uscis-form-inventory.json')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    forms = {}
    for name in ['eligibility-main.json', 'eligibility-other.json']:
        for form in json.loads((ROOT / 'data' / name).read_text())['forms']:
            if form.get('pdfUrl'):
                forms[form['id']] = form
    with ThreadPoolExecutor(max_workers=6) as executor:
        sources = dict(executor.map(lambda form: download(form, args.cache), forms.values()))
    result = {
        'schemaVersion': 1,
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'purpose': 'Official blank PDF widget evidence for manually reviewed questionnaire and output mapping. This is not a complete interview or filing-readiness assertion.',
        'coverageWarning': 'Every form needs manual field-to-question mapping, conditional rules, checkbox mutual exclusion, repeat/overflow handling, signatures and visual output validation. Read-only does not mean excluded: Adobe XFA uses it for conditional fields.',
        'forms': {},
    }
    for form_id, form in forms.items():
        item, texts = inspect(form, sources[form_id])
        result['forms'][form_id] = item
        (args.cache / (form_id.lower() + '.txt')).write_text('\n\f\n'.join(texts))
        print(f"{form_id}: {item['pageCount']} pages, {item['widgetCount']} widgets, {item['tooltipCount']} tooltips, edition {item['edition']}, HTTP {sources[form_id].get('httpStatus', 'cached')}")
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')


if __name__ == '__main__':
    main()
