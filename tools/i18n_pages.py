"""Whole English pages (recipes, guides and their hubs) in the 22 languages, translated piece by piece.

The recipe and guide builders write English pages; this module reads them back and cuts them into
pieces ("segments"): each paragraph, list item, heading, cell, caption, image alt text, the title,
the descriptions and the text fields of the structured data. Each piece is keyed by a hash of its
English text, so:
  - a new recipe or guide only adds new keys (export, translate, back-translate, build);
  - an edited English line gets a new key, and that page stays English-only until it is translated;
  - a line used on several pages ("See the pack", "Method") is translated once.

Inline markup inside a piece is shown to translators as numbered markers: ⟦1⟧…⟦/1⟧ wrap text that
keeps its tag (a link, bold), and ⟦#1⟧ stands for something kept exactly as it is (a Telugu or Hindi
name, an image). The build puts the original tags back, so links and classes never pass through a
translation. Text marked with another language (lang="te", lang="hi", lang="sa") is never translated:
the Telugu, Hindi and Sanskrit names stay on every language's page, as on the English one. A Sanskrit
name (lang="sa") rides inside the marker of the Telugu or Hindi name just before it (see rides()), so
adding Sanskrit names changed no piece's key and no translation.

A language page is built only when every piece of it passes build_i18n.problem() (numbers, brand
name, markers, claim filter on the translation and on its blind back-translation).
"""
import hashlib
import html
import json
import re

INLINE = {"a", "span", "strong", "em", "b", "i", "bdi", "small", "s", "br", "img", "abbr", "sup", "sub", "time"}
VOID = {"img", "br", "meta", "link", "input", "hr", "source", "path", "circle", "rect", "line", "ellipse",
        "polygon", "polyline", "use", "stop"}
SKIP_TAGS = {"script", "style"}
SKIP_CLASSES = {"gd-sources"}  # citations stay as published
WORDS = re.compile(r"[A-Za-z]{2,}")
TOKEN = re.compile(r"<!--.*?-->|<[^>]+>|[^<]+", re.S)
MARK = re.compile(r"⟦/?#?\d+⟧")
LD_TEXT = {"name", "description", "text", "headline"}


def key_of(src):
    return "seg." + hashlib.sha1(src.encode("utf-8")).hexdigest()[:12]


class Node:
    __slots__ = ("tag", "open", "close", "start", "end", "kids", "text")

    def __init__(self, tag=None, open_="", start=0, text=None):
        self.tag, self.open, self.close, self.start, self.end = tag, open_, "", start, start
        self.kids, self.text = [], text


def parse(s, base=0):
    """A small tree of our own well-formed HTML, with offsets into s."""
    root = Node("#root", "", base)
    stack = [root]
    for m in TOKEN.finditer(s):
        tok, a, b = m.group(0), base + m.start(), base + m.end()
        if tok.startswith("<!--"):
            continue
        if tok.startswith("</"):
            node = stack.pop()
            if node.tag != tok[2:-1].strip().lower():
                raise ValueError(f"unbalanced HTML near {tok!r} (open {node.tag})")
            node.close, node.end = tok, b
            continue
        if tok.startswith("<"):
            tag = re.match(r"<\s*([a-zA-Z0-9]+)", tok).group(1).lower()
            node = Node(tag, tok, a)
            stack[-1].kids.append(node)
            if tag in VOID or tok.endswith("/>"):
                node.end = b
            else:
                stack.append(node)
            continue
        t = Node(None, "", a, tok)
        t.end = b
        stack[-1].kids.append(t)
    if len(stack) != 1:
        raise ValueError("unclosed tags: " + ", ".join(n.tag for n in stack[1:]))
    root.end = base + len(s)
    return root


def attr(node, name):
    m = re.search(r'\s%s="([^"]*)"' % name, node.open)
    return html.unescape(m.group(1)) if m else None


def foreign(node):
    lang = attr(node, "lang")
    return bool(lang) and not lang.startswith("en")


def skipped(node):
    classes = set((attr(node, "class") or "").split())
    return node.tag in SKIP_TAGS or bool(classes & SKIP_CLASSES) or attr(node, "translate") == "no"


def all_inline(node):
    if node.text is not None:
        return True
    if node.tag not in INLINE or skipped(node):
        return False
    return all(all_inline(k) for k in node.kids)


class Segment:
    def __init__(self, start, end, src, parts):
        self.start, self.end, self.src, self.parts = start, end, src, parts  # parts: marker -> raw html
        self.key = key_of(src)


RIDE_SEP = re.compile(r"\s*·?\s*")  # what may sit between a name and the Sanskrit name that follows it


def rides(nodes, i):
    """Index of the last Sanskrit name (lang="sa") that follows the other-language name nodes[i], or i.
    Sanskrit names ride with the Telugu/Hindi name before them inside one ⟦#n⟧ marker, so adding them
    (05-11-2026: "wherever there is Telugu there should be Sanskrit") changes no segment key and no
    translation: the Sanskrit sits on every language's page next to the Telugu and Hindi, untranslated."""
    end, j = i, i + 1
    while True:
        k = j
        if k < len(nodes) and nodes[k].text is not None and RIDE_SEP.fullmatch(nodes[k].text):
            k += 1
        if k < len(nodes) and nodes[k].text is None and attr(nodes[k], "lang") == "sa":
            end, j = k, k + 1
        else:
            return end


def serialize(nodes, parts, counter):
    out = []
    nodes = list(nodes)
    i = 0
    while i < len(nodes):
        n = nodes[i]
        if n.text is not None:
            out.append(html.unescape(n.text))
        elif n.tag in VOID or foreign(n) or not n.kids:
            counter[0] += 1
            m = f"⟦#{counter[0]}⟧"
            last = rides(nodes, i) if foreign(n) and attr(n, "lang") != "sa" else i
            if attr(n, "lang") == "sa" and n.tag is not None:
                raise ValueError("a lang=\"sa\" name must follow a Telugu or Hindi name (it rides in that name's marker)")
            parts[m] = SRC[0][n.start - SRC[1]:nodes[last].end - SRC[1]]
            out.append(m)
            i = last + 1
            continue
        else:
            counter[0] += 1
            c = counter[0]
            parts[f"⟦{c}⟧"], parts[f"⟦/{c}⟧"] = n.open, n.close
            out.append(f"⟦{c}⟧" + serialize(n.kids, parts, counter) + f"⟦/{c}⟧")
        i += 1
    return "".join(out)


SRC = ["", 0]  # the HTML being cut, and its offset (serialize() copies atomic pieces from it)


def runs(node, out):
    """Collect segments under node into out."""
    if node.tag is not None and (skipped(node) or foreign(node)):
        return
    group = []

    def flush():
        if not group:
            return
        direct = "".join(k.text for k in group if k.text is not None).strip()
        elements = [k for k in group if k.text is None]
        if not direct and len(elements) >= 1:
            for k in elements:  # nothing between them: each one is its own piece
                if k.tag in VOID or foreign(k):
                    continue
                runs_inline(k, out)
        else:
            emit(group, out)
        group.clear()

    for k in node.kids:
        if all_inline(k):
            group.append(k)
        else:
            flush()
            runs(k, out)
    flush()


def runs_inline(node, out):
    """An inline element standing alone: translate what is inside it."""
    if skipped(node) or foreign(node):
        return
    kids = node.kids
    direct = "".join(k.text for k in kids if k.text is not None).strip()
    if not direct and len([k for k in kids if k.text is None]) >= 1:
        for k in kids:
            if k.text is None and k.tag not in VOID and not foreign(k):
                runs_inline(k, out)
        return
    emit(kids, out)


def emit(nodes, out):
    # trim whitespace-only text at both ends so the page keeps its layout
    nodes = list(nodes)
    while nodes and nodes[0].text is not None and not nodes[0].text.strip():
        nodes.pop(0)
    while nodes and nodes[-1].text is not None and not nodes[-1].text.strip():
        nodes.pop()
    if not nodes:
        return
    parts, counter = {}, [0]
    src = serialize(nodes, parts, counter)
    lead = len(src) - len(src.lstrip())
    src = src.strip()
    if not WORDS.search(MARK.sub("", src)):
        return
    start, end = nodes[0].start, nodes[-1].end
    if nodes[0].text is not None:
        start += len(nodes[0].text) - len(nodes[0].text.lstrip())
    if nodes[-1].text is not None:
        end -= len(nodes[-1].text) - len(nodes[-1].text.rstrip())
    _ = lead
    out.append(Segment(start, end, re.sub(r"\s+", " ", src), parts))


def cut(page):
    """Segments of <main> plus head texts and alt texts: [(kind, Segment-or-info)]."""
    m = re.search(r"<main\b.*?</main>", page, re.S)
    if not m:
        raise ValueError("no <main> in page")
    SRC[0], SRC[1] = m.group(0), m.start()
    segs = []
    runs(parse(m.group(0), m.start()), segs)
    return segs


def head_texts(page):
    """[(regex for the value, english text)] for title, descriptions, og title, image alts, aria-labels."""
    out = []
    t = re.search(r"<title>(.*?)</title>", page, re.S)
    out.append(("title", html.unescape(t.group(1))))
    for prop in ('name="description"', 'property="og:title"', 'property="og:description"'):
        mm = re.search(r'<meta %s content="([^"]*)"' % re.escape(prop), page)
        if mm:
            out.append((prop, html.unescape(mm.group(1))))
    main = re.search(r"<main\b.*?</main>", page, re.S).group(0)
    for a in re.findall(r'\b(?:alt|aria-label)="([^"]*)"', main):
        if WORDS.search(a):
            out.append(("attr", html.unescape(a)))
    return out


def ld_texts(page):
    out = []
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', page, re.S):
        walk_ld(json.loads(block), out.append)
    return out


def walk_ld(o, fn, k=None):
    if isinstance(o, dict):
        for kk, v in o.items():
            if kk == "author" or kk == "publisher":
                continue
            if isinstance(v, str) and kk in LD_TEXT and WORDS.search(v):
                fn(v)
            elif kk == "recipeIngredient" and isinstance(v, list):
                for x in v:
                    if WORDS.search(x):
                        fn(x)
            else:
                walk_ld(v, fn, kk)
    elif isinstance(o, list):
        for x in o:
            walk_ld(x, fn, k)


def sources(page, where):
    """{key: (english, note)} for every piece of the page."""
    out = {}
    for s in cut(page):
        note = f"text on {where}"
        if s.parts:
            note += "; keep every ⟦n⟧ ⟦/n⟧ ⟦#n⟧ marker, around the matching words"
        out[s.key] = (s.src, note)
    for kind, text in head_texts(page):
        note = {"title": "browser tab / Google title; keep ' | 1acrefarms' at the end",
                'name="description"': "Google description", "attr": "image description / label"}.get(kind, "share preview text")
        out.setdefault(key_of(text), (text, f"{note} on {where}"))
    for text in ld_texts(page):
        out.setdefault(key_of(text), (text, f"search-engine data on {where}"))
    return out


def translate(page, tr, esc):
    """page with every piece replaced; tr(english) -> translation; esc(text) escapes body text
    (build_i18n.x, which also keeps numbers left-to-right on rtl pages)."""
    segs = cut(page)
    for s in sorted(segs, key=lambda s: s.start, reverse=True):
        t = tr(s.src)
        body = "".join(s.parts[p] if MARK.fullmatch(p) else esc(p) for p in re.split(r"(⟦/?#?\d+⟧)", t))
        page = page[:s.start] + body + page[s.end:]

    def head_attr(m):
        return m.group(1) + html.escape(tr(html.unescape(m.group(2))), quote=True) + '"'

    page = re.sub(r"(<title>)(.*?)(</title>)", lambda m: m.group(1) + html.escape(tr(html.unescape(m.group(2))), quote=False) + m.group(3), page, count=1, flags=re.S)
    for prop in ('name="description"', 'property="og:title"', 'property="og:description"'):
        page = re.sub(r'(<meta %s content=")([^"]*)"' % re.escape(prop), head_attr, page, count=1)
    main = re.search(r"<main\b.*?</main>", page, re.S)
    body = re.sub(r'(\b(?:alt|aria-label)=")([^"]*)"',
                  lambda m: head_attr(m) if WORDS.search(m.group(2)) else m.group(0), main.group(0))
    page = page[:main.start()] + body + page[main.end():]

    def ld(m):
        doc = json.loads(m.group(1))
        doc = map_ld(doc, tr)
        return '<script type="application/ld+json">\n' + json.dumps(doc, ensure_ascii=False, indent=2) + "\n  </script>"

    return re.sub(r'<script type="application/ld\+json">(.*?)</script>', ld, page, flags=re.S)


def map_ld(o, tr, k=None):
    if isinstance(o, dict):
        out = {}
        for kk, v in o.items():
            if kk in ("author", "publisher"):
                out[kk] = v
            elif isinstance(v, str) and kk in LD_TEXT and WORDS.search(v):
                out[kk] = tr(v)
            elif kk == "recipeIngredient" and isinstance(v, list):
                out[kk] = [tr(x) if WORDS.search(x) else x for x in v]
            else:
                out[kk] = map_ld(v, tr, kk)
        return out
    if isinstance(o, list):
        return [map_ld(x, tr, k) for x in o]
    return o
