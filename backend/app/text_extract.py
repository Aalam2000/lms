"""Текст из файла урока — для Помощника квиза (промпт с материалами урока).

docx / pptx — это zip с XML: читаем стандартной библиотекой (без новых
зависимостей). pdf — через pypdf. txt / md — как есть. html — только суть:
текст со структурой, без стилей и скриптов (задания часто — оформленные
HTML-страницы; см. «Проверка с ИИ», routers/homework.py). Картинки и сканы
текста не дают — вернётся пустая строка.
"""
import io
import re
from html.parser import HTMLParser
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"

SUPPORTED = {".docx", ".pptx", ".pdf", ".txt", ".md", ".html", ".htm"}


def _docx(data: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    lines = []
    for p in root.iter(f"{W}p"):
        text = "".join(t.text or "" for t in p.iter(f"{W}t")).strip()
        if text:
            lines.append(text)
    return "\n".join(lines)


def _pptx(data: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = [n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)]
        names.sort(key=lambda n: int(re.search(r"(\d+)", n.rsplit("/", 1)[1]).group(1)))
        out = []
        for i, name in enumerate(names, 1):
            root = ET.fromstring(z.read(name))
            paras = []
            for p in root.iter(f"{A}p"):
                text = "".join(t.text or "" for t in p.iter(f"{A}t")).strip()
                if text:
                    paras.append(text)
            if paras:
                out.append(f"[Слайд {i}]\n" + "\n".join(paras))
    return "\n\n".join(out)


def _pdf(data: bytes) -> str:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    return "\n".join((page.extract_text() or "").strip() for page in reader.pages).strip()


class _HtmlText(HTMLParser):
    """HTML → текст. Выбрасывает head, style, script, комментарии и блоки с
    классом no-ai (так автор задания помечает то, что для проверки не нужно:
    «как сделать скриншот», шпаргалки…). Заголовки → «#», пункты списков → «- »,
    ячейки таблиц → « | »; текст в pre — как есть."""
    SKIP = {"head", "style", "script", "noscript", "svg", "template"}
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
    BLOCK = {"p", "div", "section", "article", "header", "footer", "main", "aside", "nav", "li", "tr",
             "h1", "h2", "h3", "h4", "h5", "h6", "pre", "br", "table", "ul", "ol", "blockquote", "hr"}
    # Вёрстка кладёт такие куски вплотную («<span>0</span>Приготовься») — разделяем пробелом
    GAP = {"span", "small", "label", "button", "sup", "sub"}

    def __init__(self):
        super().__init__()
        self.out = []
        self.skip = []   # стек открытых тегов внутри выброшенного блока
        self.pre = 0

    def handle_starttag(self, tag, attrs):
        void = tag in self.VOID
        if self.skip:
            if not void:
                self.skip.append(tag)
            return
        classes = (dict(attrs).get("class") or "").split()
        if tag in self.SKIP or "no-ai" in classes:
            if not void:
                self.skip.append(tag)
            return
        if tag == "pre":
            self.pre += 1
        if tag in self.BLOCK:
            self.out.append("\n")
        elif tag in self.GAP:
            self.out.append(" ")
        if len(tag) == 2 and tag[0] == "h" and tag[1].isdigit():
            self.out.append("#" * int(tag[1]) + " ")
        elif tag == "li":
            self.out.append("- ")
        elif tag in ("td", "th"):
            self.out.append(" | ")

    def handle_endtag(self, tag):
        if self.skip:
            if tag in self.skip:  # закрываем до своего тега — незакрытые внутри не ломают счёт
                while self.skip and self.skip.pop() != tag:
                    pass
            return
        if tag == "pre":
            self.pre = max(0, self.pre - 1)
        if tag in self.BLOCK:
            self.out.append("\n")
        elif tag in self.GAP:
            self.out.append(" ")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data if self.pre else re.sub(r"\s+", " ", data))


def _html(data: bytes) -> str:
    parser = _HtmlText()
    parser.feed(data.decode("utf-8", errors="replace"))
    parser.close()
    lines = []
    for line in "".join(parser.out).split("\n"):
        line = line.rstrip()
        if not line.strip():
            continue
        if line.lstrip().startswith("#") and lines:
            lines.append("")  # пустая строка перед заголовком — читается легче
        if not line.startswith(" " * 2):  # отступ — это код из pre, его не трогаем
            line = re.sub(r" {2,}", " ", line.strip())
            line = re.sub(r" ([.,:;!?)»])", r"\1", line)
        lines.append(line)
    return "\n".join(lines).strip()


def extract_text(filename: str, data: bytes) -> str:
    ext = Path(filename).suffix.lower()
    if ext == ".docx":
        return _docx(data)
    if ext == ".pptx":
        return _pptx(data)
    if ext == ".pdf":
        return _pdf(data)
    if ext in (".html", ".htm"):
        return _html(data)
    if ext in (".txt", ".md"):
        return data.decode("utf-8", errors="replace")
    raise ValueError("Текст из этого формата не достать — поддерживаются docx, pptx, pdf, txt, md, html")
