#!/usr/bin/env python3
"""Prepare official blank USCIS PDFs for the explicit *static print* workflow.

Requires pikepdf. This build tool never receives customer answers. Original files
stay untouched. We deliberately discard XFA, JavaScript, and Adobe usage-rights
signatures in the derived print template, rather than leave stale XFA data in a
filled PDF. PDF page streams and existing widget appearances are preserved.
This is not an editable-XFA or digital-signature workflow.
"""
import argparse
import hashlib
import json
from pathlib import Path

import pikepdf


def digest(data):
    return hashlib.sha256(data).hexdigest()


def content_digest(page):
    contents = page.obj.get('/Contents', [])
    streams = contents if isinstance(contents, pikepdf.Array) else [contents]
    return [digest(stream.read_bytes()) for stream in streams]


def appearance_digest(pdf):
    result = []
    for page in pdf.pages:
        for widget in page.obj.get('/Annots', []):
            appearance = widget.get('/AP', {}).get('/N')
            if isinstance(appearance, pikepdf.Stream):
                result.append(digest(appearance.read_bytes()))
            elif isinstance(appearance, pikepdf.Dictionary):
                result.append({str(k): digest(v.read_bytes()) for k, v in appearance.items()})
            else:
                result.append(None)
    return result


def prepare(source, target, form_id):
    original = source.read_bytes()
    with pikepdf.open(source) as pdf:
        if not pdf.allow.modify_form or not pdf.allow.print_highres:
            raise ValueError(f'{form_id}: source does not permit form filling/printing')
        # Adobe reader usage rights (/Perms /UR3) are not a customer's signature.
        if '/Perms' in pdf.Root and '/DocMDP' in pdf.Root.Perms:
            raise ValueError(f'{form_id}: document contains a certification signature')
        for obj in pdf.objects:
            if isinstance(obj, pikepdf.Dictionary) and obj.get('/FT') == '/Sig' and obj.get('/V'):
                raise ValueError(f'{form_id}: document has a filled signature')
        before_content = [content_digest(page) for page in pdf.pages]
        before_appearance = appearance_digest(pdf)
        had_xfa = '/XFA' in pdf.Root.get('/AcroForm', {})
        if '/AcroForm' in pdf.Root:
            for key in ['/XFA', '/SigFlags']:
                if key in pdf.Root.AcroForm:
                    del pdf.Root.AcroForm[key]
        for key in ['/Perms', '/OpenAction', '/AA']:
            if key in pdf.Root:
                del pdf.Root[key]
        if '/Names' in pdf.Root and '/JavaScript' in pdf.Root.Names:
            del pdf.Root.Names['/JavaScript']
        # Remove calculated/validation actions. Preserve ordinary URI links.
        for obj in pdf.objects:
            if isinstance(obj, pikepdf.Dictionary):
                if '/AA' in obj:
                    del obj['/AA']
                if '/A' in obj and isinstance(obj.A, pikepdf.Dictionary) and obj.A.get('/S') == '/JavaScript':
                    del obj['/A']
        target.parent.mkdir(parents=True, exist_ok=True)
        pdf.save(target, deterministic_id=True)
    with pikepdf.open(target) as check:
        assert not check.is_encrypted
        assert '/XFA' not in check.Root.get('/AcroForm', {})
        assert before_content == [content_digest(page) for page in check.pages]
        assert before_appearance == appearance_digest(check)
        return {
            'id': form_id, 'filename': target.name,
            'originalSha256': digest(original), 'sha256': digest(target.read_bytes()),
            'pageCount': len(check.pages), 'sourceHadXfa': had_xfa,
            'pageContentPreserved': True, 'widgetAppearancesPreserved': True,
            'outputMode': 'static-print-only',
            'sourcePdfUrl': f'https://www.uscis.gov/sites/default/files/document/forms/{form_id.lower()}.pdf',
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-dir', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, default=Path('assets/uscis-print'))
    parser.add_argument('--manifest', type=Path, default=Path('data/uscis-print-templates.json'))
    parser.add_argument('--forms', nargs='+', default=['I-90'])
    args = parser.parse_args()
    templates = {}
    for form_id in args.forms:
        candidates = [args.input_dir / f'{form_id.lower()}.pdf', args.input_dir / f'eagle-{form_id.lower()}.pdf', args.input_dir / f'eagle-other-{form_id.lower()}.pdf']
        source = next((path for path in candidates if path.exists()), None)
        if source is None:
            raise FileNotFoundError(f'No source PDF found for {form_id}')
        templates[form_id] = prepare(source, args.output_dir / f'{form_id.lower()}.pdf', form_id)
        print(f'{form_id}: {templates[form_id]["pageCount"]} pages, content + appearances preserved')
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps({'version': 1, 'strategy': 'Static PDF print output; original page content and barcode appearances retained; no XFA, scripts, or Adobe usage rights in derived templates.', 'templates': templates}, indent=2) + '\n')


if __name__ == '__main__':
    main()
