#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Extract one source-faithful question crop for every seven-digit StudyQ code.

The source PDFs mix vector text and embedded images, so this extractor renders
the original page and crops by the printed StudyQ code location.  Blue answer
marks are saved separately and removed from the question crop.
"""
import io
import json
import os
import re
import sys

import fitz
import numpy as np
from PIL import Image, ImageFilter


PDF = sys.argv[1]
OUTDIR = 'book_out'
SCALE = 4
CODE_RE = re.compile(r'^\d{7}$')
os.makedirs(os.path.join(OUTDIR, 'img'), exist_ok=True)


def page_spans(page):
    width, height = page.rect.width, page.rect.height
    spans = []
    for block in page.get_text('dict').get('blocks', []):
        for line in block.get('lines', []):
            for span in line.get('spans', []):
                text = span.get('text', '').strip()
                if not text:
                    continue
                x0, y0, x1, y1 = span['bbox']
                spans.append({
                    'text': text,
                    'color': span.get('color'),
                    'x0': x0 / width,
                    'x1': x1 / width,
                    'y0': y0 / height,
                    'y1': y1 / height,
                    'cx': (x0 + x1) / (2 * width),
                    'cy': (y0 + y1) / (2 * height),
                })
    return spans


def crop_columns(code_span):
    if code_span['cx'] < 0.5:
        return 'L', 0.055, 0.475
    return 'R', 0.515, 0.945


def blue_mask(image):
    array = np.asarray(image.convert('RGB'))
    red = array[:, :, 0].astype(int)
    green = array[:, :, 1].astype(int)
    blue = array[:, :, 2].astype(int)
    return (blue > 140) & (red < 125) & (green < 145)


def clean_question(image):
    cleaned = np.asarray(image.convert('RGB')).copy()
    base_mask = blue_mask(image)
    # Rendering anti-aliases blue answer marks into pale edge pixels. Expand
    # the detected region slightly so those marks cannot leak into the crop.
    mask = np.asarray(
        Image.fromarray((base_mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))
    ) > 0
    cleaned[mask] = 255
    return Image.fromarray(cleaned), base_mask


def answer_crop(image, mask):
    ys, xs = np.where(mask)
    if len(xs) < 20:
        return None
    padding = 12
    left = max(0, int(xs.min()) - padding)
    top = max(0, int(ys.min()) - padding)
    right = min(image.width, int(xs.max()) + padding + 1)
    bottom = min(image.height, int(ys.max()) + padding + 1)
    original = np.asarray(image.convert('RGB'))
    answer = np.full((bottom - top, right - left, 3), 255, dtype=np.uint8)
    local_mask = mask[top:bottom, left:right]
    answer[local_mask] = original[top:bottom, left:right][local_mask]
    return Image.fromarray(answer)


def header_metadata(code_span, spans):
    nearby = [span for span in spans if abs(span['cy'] - code_span['cy']) < 0.032]
    nearby.sort(key=lambda span: span['x0'])
    type_name = next((span['text'].strip('| ').strip() for span in nearby if span['text'].startswith('|')), None)
    difficulty = next((span['text'] for span in nearby if span['color'] == 0x32c524), None)
    form = next((span['text'] for span in nearby if span['color'] == 0x666666 and not span['text'].isdigit() and len(span['text']) <= 4), None)
    return type_name, difficulty, form


document = fitz.open(PDF)
problems = []
for page_index, page in enumerate(document):
    spans = page_spans(page)
    code_spans = [span for span in spans if CODE_RE.fullmatch(span['text'])]
    grouped = {'L': [], 'R': []}
    for span in code_spans:
        column, _, _ = crop_columns(span)
        grouped[column].append(span)
    pixmap = page.get_pixmap(matrix=fitz.Matrix(SCALE, SCALE), alpha=False)
    page_image = Image.open(io.BytesIO(pixmap.tobytes('png'))).convert('RGB')
    for column in ('L', 'R'):
        headers = sorted(grouped[column], key=lambda span: span['y0'])
        for index, header in enumerate(headers):
            _, x0, x1 = crop_columns(header)
            top = max(0.0, header['y0'] - 0.025)
            bottom = (headers[index + 1]['y0'] - 0.018) if index + 1 < len(headers) else 0.95
            if bottom <= top + 0.02:
                raise RuntimeError(f'Invalid crop bounds for {header["text"]} on page {page_index + 1}')
            left_px = int(x0 * page_image.width)
            right_px = int(x1 * page_image.width)
            top_px = int(top * page_image.height)
            bottom_px = int(bottom * page_image.height)
            source_crop = page_image.crop((left_px, top_px, right_px, bottom_px))
            question_image, mask = clean_question(source_crop)
            code = header['text']
            question_path = os.path.join(OUTDIR, 'img', f'{code}.png')
            question_image.save(question_path)
            answer_path = None
            answer_image = answer_crop(source_crop, mask)
            if answer_image is not None:
                answer_path = os.path.join(OUTDIR, 'img', f'{code}_answer.png')
                answer_image.save(answer_path)
            type_name, difficulty, form = header_metadata(header, spans)
            problems.append({
                'problem_id': f'{os.path.splitext(os.path.basename(PDF))[0]}::{code}',
                'page': page_index + 1,
                'col': column,
                'type_name': type_name,
                'difficulty': difficulty,
                'form': form,
                'video_code': code,
                'answer_image': answer_path,
                'answer_text': None,
                'block_image': question_path,
                'block_px': [question_image.width, question_image.height],
                'number_slot': [0.02, max(0.0, (header['y0'] - top) / (bottom - top)), 0.04],
                'assets': ['page_render_crop'],
            })

with open(os.path.join(OUTDIR, 'problems.json'), 'w', encoding='utf-8') as handle:
    json.dump(problems, handle, ensure_ascii=False, indent=1)
print(f'PDF: {os.path.basename(PDF)}')
print(f'pages processed: {document.page_count} | problems extracted: {len(problems)}')
