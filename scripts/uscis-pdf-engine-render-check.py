#!/usr/bin/env python3
"""Pixel-compare official source pages and static blank engine outputs.

Run uscis-pdf-engine-check.cjs first. Source PDFs
are fetched separately and hash-pinned by the inventory. Requires Poppler/Pillow.
Synthetic files remain under tmp/; they are not completed customer applications.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import subprocess

from PIL import Image, ImageChops


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-dir', type=Path, required=True)
    parser.add_argument('--forms', nargs='+', default=['I-90', 'G-1145', 'I-485'])
    parser.add_argument('--dpi', type=int, default=90)
    args = parser.parse_args()
    output = Path('tmp/pdfs/engine-check')
    rendered = output / 'render'
    rendered.mkdir(parents=True, exist_ok=True)
    environment = dict(os.environ)
    if Path('/opt/homebrew/etc/fonts/fonts.conf').exists():
        environment.setdefault('FONTCONFIG_FILE', '/opt/homebrew/etc/fonts/fonts.conf')
    work = []
    for form_id in args.forms:
        for label, source in [
            ('original', args.input_dir / f'{form_id.lower()}.pdf'),
            ('blank', output / f'{form_id.lower()}-blank.pdf'),
            ('synthetic', output / f'{form_id.lower()}-synthetic.pdf'),
        ]:
            if source.exists():
                work.append((form_id, label, source))

    def render(item):
        form_id, label, source = item
        result = subprocess.run(['pdftoppm', '-r', str(args.dpi), '-png', str(source), str(rendered / f'{form_id.lower()}-{label}')], env=environment, capture_output=True)
        if result.returncode:
            raise RuntimeError(result.stderr.decode())

    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(render, work))
    results = {}
    for form_id in args.forms:
        pages = []
        for source in sorted(rendered.glob(f'{form_id.lower()}-original-*.png')):
            target = rendered / source.name.replace('-original-', '-blank-')
            before, after = Image.open(source).convert('RGB'), Image.open(target).convert('RGB')
            if before.size != after.size:
                raise AssertionError(f'{form_id}: page size changed')
            difference = ImageChops.difference(before, after).getbbox()
            pages.append({'page': int(source.stem.split('-')[-1]), 'pixelExact': difference is None, 'differenceBox': difference})
        assert pages, f'{form_id}: no rendered source pages'
        results[form_id] = pages
        print(f'{form_id}: {sum(page["pixelExact"] for page in pages)}/{len(pages)} pages pixel-exact at {args.dpi} DPI')
    (output / 'visual-proof.json').write_text(json.dumps({'dpi': args.dpi, 'forms': results}, indent=2) + '\n')
    assert all(page['pixelExact'] for pages in results.values() for page in pages), 'A blank print output differs from the official source. Review the diff before enabling it.'


if __name__ == '__main__':
    main()
