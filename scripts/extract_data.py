#!/usr/bin/env python3
"""
Extracts lesson data from all 300 Vietnamese language HTML files.
Produces www/data/lessons.json for the Capacitor app.
"""

import os, re, json
from bs4 import BeautifulSoup

SRC_DIR = os.path.join(os.path.dirname(__file__), '..', '..')
OUT_FILE = os.path.join(os.path.dirname(__file__), '..', 'www', 'data', 'lessons.json')

LEVEL_COLORS = {
    'A0': {'primary': '#b71c1c', 'bg': '#faf7f2', 'header': 'linear-gradient(135deg, #b71c1c 0%, #7f0000 100%)'},
    'A1': {'primary': '#1a7a4f', 'bg': '#f0f7f4', 'header': 'linear-gradient(135deg, #1a7a4f 0%, #0e5435 100%)'},
    'A2': {'primary': '#1a7a4f', 'bg': '#f0f7f4', 'header': 'linear-gradient(135deg, #1a6b9a 0%, #0d4a6e 100%)'},
    'B1': {'primary': '#5b3fa0', 'bg': '#f5f2fa', 'header': 'linear-gradient(135deg, #5b3fa0 0%, #3d2878 100%)'},
    'B2': {'primary': '#1a7a4f', 'bg': '#f0f7f4', 'header': 'linear-gradient(135deg, #1a7a4f 0%, #0e5435 100%)'},
    'C1': {'primary': '#1a7a4f', 'bg': '#f0f7f4', 'header': 'linear-gradient(135deg, #1a7a4f 0%, #0e5435 100%)'},
}

def get_file_level_lesson(filename):
    """Parse level and lesson number from filename."""
    m = re.match(r'VG_(A0|A1|A2|B1|B2|C1)-(\d+)(?:-vi)?\.html', filename)
    if m:
        return m.group(1), int(m.group(2))
    return None, None

def _parse_js_objects(arr_str, vi_key='vi', ru_key='ru'):
    """Parse JS array of objects into Python list."""
    results = []
    # Find individual objects: { vi: "...", ru: "..." }
    obj_pat = r'\{[^{}]+\}'
    for obj_m in re.finditer(obj_pat, arr_str, re.DOTALL):
        obj = obj_m.group()
        vi_m = re.search(fr'{vi_key}:\s*["\']([^"\']*)["\']', obj)
        ru_m = re.search(fr'{ru_key}:\s*["\']([^"\']*)["\']', obj)
        note_m = re.search(r'note:\s*["\']([^"\']*)["\']', obj)
        if vi_m and ru_m:
            results.append({
                'vi': vi_m.group(1).strip(),
                'ru': ru_m.group(1).strip(),
                'note': note_m.group(1).strip() if note_m else ''
            })
    return results

def _parse_js_array_by_name(content, var_name, vi_key='vi', ru_key='ru'):
    """Extract and parse a named JS array variable."""
    # Match: const varName = [...]
    m = re.search(rf'(?:const|var|let)\s+{re.escape(var_name)}\s*=\s*(\[[\s\S]*?\]);', content)
    if m:
        return _parse_js_objects(m.group(1), vi_key, ru_key)
    return []

def extract_section_examples_from_render_calls(content, vi_key='vi', ru_key='ru'):
    """For A0/A1 format: parse render() calls to map sections to example arrays."""
    section_map = {}
    # render('section-id', varName) or render('section-id', varName, options)
    for m in re.finditer(r"render\('([^']+)',\s*(\w+)", content):
        sec_id = m.group(1)
        var_name = m.group(2)
        examples = _parse_js_array_by_name(content, var_name, vi_key, ru_key)
        if examples:
            if sec_id in section_map:
                section_map[sec_id].extend(examples)
            else:
                section_map[sec_id] = examples
    return section_map

def extract_examples_from_js_arrays(content):
    """Extract ALL examples from A0 format JS arrays."""
    pattern = r'\{\s*vi:\s*"([^"]*)"[^}]*ru:\s*"([^"]*)"'
    examples = []
    for m in re.finditer(pattern, content):
        note_m = re.search(r'note:\s*"([^"]*)"', content[m.start():m.end()+200])
        examples.append({
            'vi': m.group(1).strip(),
            'ru': m.group(2).strip(),
            'note': note_m.group(1).strip() if note_m else ''
        })
    return examples

def extract_examples_from_js_arrays_v2(content):
    """Extract ALL examples from A1-B1 format JS arrays."""
    pattern = r'\{\s*viet:\s*["\']([^"\']*)["\'][^}]*ru:\s*["\']([^"\']*)["\']'
    examples = []
    for m in re.finditer(pattern, content):
        note_m = re.search(r'note:\s*["\']([^"\']*)["\']', content[m.start():m.end()+300])
        examples.append({
            'vi': m.group(1).strip(),
            'ru': m.group(2).strip(),
            'note': note_m.group(1).strip() if note_m else ''
        })
    return examples

def extract_examples_from_html(soup):
    """Extract examples from inline HTML (B2/C1 format)."""
    examples = []
    for card in soup.find_all('div', class_='example-card'):
        vi_el = card.find(class_='example-viet')
        ru_el = card.find(class_='example-ru')
        note_el = card.find(class_='example-note')
        if vi_el and ru_el:
            examples.append({
                'vi': vi_el.get_text(strip=True),
                'ru': ru_el.get_text(strip=True),
                'note': note_el.get_text(strip=True) if note_el else ''
            })
    return examples

def extract_vocab_a0(content):
    """Extract vocab from A0 format (vi/pron/ru)."""
    items = []
    pattern = r'\{\s*vi:\s*"([^"]*)"[^}]*pron:\s*"([^"]*)"[^}]*ru:\s*"([^"]*)"'
    for m in re.finditer(pattern, content):
        items.append({'vi': m.group(1), 'pron': m.group(2), 'ru': m.group(3)})
    return items

def extract_vocab_a1b1(content):
    """Extract vocab from A1-B1 format (viet/ru or viet/pron/ru)."""
    items = []
    # Try with pron
    pattern_pron = r'\{\s*viet:\s*["\']([^"\']*)["\'][^}]*pron:\s*["\']([^"\']*)["\'][^}]*ru:\s*["\']([^"\']*)["\']'
    for m in re.finditer(pattern_pron, content):
        items.append({'vi': m.group(1), 'pron': m.group(2), 'ru': m.group(3)})
    if items:
        return items
    # Without pron
    pattern_no_pron = r'\{\s*viet:\s*["\']([^"\']*)["\'][^}]*ru:\s*["\']([^"\']*)["\']'
    for m in re.finditer(pattern_no_pron, content):
        items.append({'vi': m.group(1), 'pron': '', 'ru': m.group(2)})
    return items

def extract_vocab_from_html(soup):
    """Extract vocab from inline HTML table (B2/C1 format)."""
    items = []
    vocab_section = soup.find(id='vocabulary')
    if not vocab_section:
        vocab_section = soup.find('div', id=re.compile(r'vocab'))
    if not vocab_section:
        # Try finding vocab table
        for tbl in soup.find_all('table'):
            rows = tbl.find_all('tr')
            for row in rows[1:]:  # skip header
                cells = row.find_all('td')
                if len(cells) >= 2:
                    vi_el = row.find(class_='vocab-vi')
                    if vi_el:
                        tds = row.find_all('td')
                        vi = tds[0].get_text(strip=True) if tds else ''
                        pron = tds[1].get_text(strip=True) if len(tds) > 1 else ''
                        ru = tds[2].get_text(strip=True) if len(tds) > 2 else ''
                        if vi:
                            items.append({'vi': vi, 'pron': pron, 'ru': ru})
        return items
    # Parse table in vocab section
    for row in vocab_section.find_all('tr'):
        vi_el = row.find(class_='vocab-vi')
        if vi_el:
            tds = row.find_all('td')
            vi = tds[0].get_text(strip=True) if tds else ''
            pron = tds[1].get_text(strip=True) if len(tds) > 1 else ''
            ru = tds[2].get_text(strip=True) if len(tds) > 2 else ''
            if vi:
                items.append({'vi': vi, 'pron': pron, 'ru': ru})
    return items

def extract_sections(soup, content):
    """Extract sections with their IDs and titles."""
    sections = []
    for section in soup.find_all('div', class_='section'):
        sec_id = section.get('id', '')
        title_el = section.find(class_='section-title')
        title = title_el.get_text(strip=True) if title_el else ''
        # Determine section type
        if 'vocab' in sec_id.lower() or 'vocabulary' in sec_id.lower() or 'vocab' in title.lower() or 'Словарь' in title:
            sec_type = 'vocab'
        elif 'review' in sec_id.lower() or 'final' in sec_id.lower() or 'Итог' in title or 'review' in title.lower():
            sec_type = 'review'
        elif 'summary' in sec_id.lower() or 'Итог урока' in title:
            sec_type = 'summary'
        else:
            sec_type = 'rule'
        sections.append({'id': sec_id, 'title': title, 'type': sec_type})
    return sections

def extract_autoplay_section_ids(content):
    """Extract the sectionIds array used in AutoPlay.start()."""
    # Try to find sectionIds array in JS
    m = re.search(r'const sectionIds\s*=\s*(\[[^\]]+\])', content)
    if m:
        try:
            ids = json.loads(m.group(1))
            return ids
        except:
            # Parse manually
            ids = re.findall(r'"([^"]+)"', m.group(1))
            return ids
    # Fallback: collect all div IDs in ap-section elements
    soup = BeautifulSoup(content, 'html.parser')
    ap_ids = []
    for el in soup.find_all(class_='ap-section'):
        if el.get('id'):
            ap_ids.append(el.get('id'))
    return ap_ids

def extract_lesson_title(soup, content, level, num):
    """Get lesson title and subtitle."""
    # Try h1
    h1 = soup.find('h1', class_='lesson-title')
    if h1:
        title = h1.get_text(strip=True)
    else:
        # Try from <title> tag
        t = soup.find('title')
        title = t.get_text(strip=True) if t else f'Урок {num}'
        # Clean up
        title = re.sub(r'\s*\|.*$', '', title).strip()
        title = re.sub(r'^Урок \d+\s*[—-]\s*', '', title).strip()

    subtitle_el = soup.find(class_='lesson-subtitle')
    subtitle = subtitle_el.get_text(strip=True) if subtitle_el else ''
    return title, subtitle

def parse_lesson(filepath, level, num):
    """Parse a single lesson HTML file."""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    soup = BeautifulSoup(content, 'html.parser')
    title, subtitle = extract_lesson_title(soup, content, level, num)

    # Detect format
    has_vi_key = bool(re.search(r'\bvi:\s*"', content))
    has_viet_key = bool(re.search(r'\bviet:\s*["\']', content))
    has_inline_cards = bool(soup.find('div', class_='example-viet'))

    # Extract all examples
    all_examples = []
    # Build per-section examples
    section_examples = {}

    if has_inline_cards:
        # B2/C1 format: inline HTML
        all_examples = extract_examples_from_html(soup)
        # Build section_examples from HTML sections
        for section in soup.find_all('div', class_='section'):
            sec_id = section.get('id', '')
            if not sec_id:
                continue
            cards = section.find_all('div', class_='example-card')
            sec_examples = []
            for card in cards:
                vi_el = card.find(class_='example-viet')
                ru_el = card.find(class_='example-ru')
                note_el = card.find(class_='example-note')
                if vi_el and ru_el:
                    sec_examples.append({
                        'vi': vi_el.get_text(strip=True),
                        'ru': ru_el.get_text(strip=True),
                        'note': note_el.get_text(strip=True) if note_el else ''
                    })
            if sec_examples:
                section_examples[sec_id] = sec_examples
    elif has_vi_key:
        # A0 format: examples in JS arrays, rendered to div containers
        all_examples = extract_examples_from_js_arrays(content)
        section_examples = extract_section_examples_from_render_calls(content, 'vi', 'ru')
    elif has_viet_key:
        # A1/A2/B1 format
        all_examples = extract_examples_from_js_arrays_v2(content)
        section_examples = extract_section_examples_from_render_calls(content, 'viet', 'ru')

    # Extract vocab
    vocab = []
    if has_vi_key and not has_inline_cards:
        vocab = extract_vocab_a0(content)
    elif has_viet_key and not has_inline_cards:
        vocab = extract_vocab_a1b1(content)
    else:
        vocab = extract_vocab_from_html(soup)

    # Extract sections metadata
    sections = extract_sections(soup, content)

    # Extract autoplay section IDs (non-vocab sections)
    autoplay_ids = extract_autoplay_section_ids(content)
    if not autoplay_ids:
        autoplay_ids = list(section_examples.keys())

    return {
        'id': f'{level}-{num:02d}',
        'level': level,
        'num': num,
        'title': title,
        'subtitle': subtitle,
        'all_examples': all_examples,
        'vocab': vocab,
        'sections': sections,
        'autoplay_ids': autoplay_ids,
        'section_examples': section_examples,
        'format': 'inline' if has_inline_cards else ('vi' if has_vi_key else 'viet'),
    }

def main():
    print("Extracting lesson data from HTML files...")
    files = sorted(os.listdir(SRC_DIR))
    html_files = [f for f in files if f.startswith('VG_') and f.endswith('.html')]

    lessons = []
    stats = {'total': 0, 'examples': 0, 'vocab': 0, 'errors': 0}

    for fname in html_files:
        level, num = get_file_level_lesson(fname)
        if not level:
            continue
        filepath = os.path.join(SRC_DIR, fname)
        try:
            lesson = parse_lesson(filepath, level, num)
            lessons.append(lesson)
            stats['total'] += 1
            stats['examples'] += len(lesson['all_examples'])
            stats['vocab'] += len(lesson['vocab'])
            print(f"  {lesson['id']}: {len(lesson['all_examples'])} examples, {len(lesson['vocab'])} vocab, {len(lesson['sections'])} sections")
        except Exception as e:
            print(f"  ERROR {fname}: {e}")
            stats['errors'] += 1

    # Sort lessons
    level_order = {'A0': 0, 'A1': 1, 'A2': 2, 'B1': 3, 'B2': 4, 'C1': 5}
    lessons.sort(key=lambda x: (level_order.get(x['level'], 99), x['num']))

    # Build output
    output = {
        'version': '1.0',
        'generated': __import__('datetime').datetime.now().isoformat(),
        'stats': stats,
        'level_colors': LEVEL_COLORS,
        'lessons': lessons
    }

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nDone! {stats['total']} lessons, {stats['examples']} examples, {stats['vocab']} vocab items")
    print(f"Output: {OUT_FILE}")
    print(f"File size: {os.path.getsize(OUT_FILE) // 1024} KB")

if __name__ == '__main__':
    main()
