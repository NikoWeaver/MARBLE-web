#!/usr/bin/env python3
"""Preflight checks for the MARBLE supplementary website.

Run before submitting an anonymized 4open.science link:

    python3 tools/preflight.py [--strict] [--terms "name,lab,username"]

Checks (stdlib only):
  - lists TODO blocks in index.html (title + line number)
  - lists missing media referenced by data-video / data-poster / src
  - lists step chips with an empty data-seek
  - scans all text files for identity leaks (local paths, github.com links,
    email addresses, and any --terms / tools/anon_terms.txt entries)
  - confirms index.html has <meta name="robots" content="noindex, nofollow">
  - confirms no src/href/data-* attribute starts with a leading '/'

Exit status:
  0 - no errors (TODOs and missing media are warnings only, unless --strict)
  1 - identity leaks, a leading-slash path, or a missing noindex tag were
      found (or, with --strict, any warning was found)
"""

import argparse
import os
import re
import sys
from html.parser import HTMLParser

SCRIPT_PATH = os.path.abspath(__file__)
SCRIPT_DIR = os.path.dirname(SCRIPT_PATH)
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
INDEX_PATH = os.path.join(REPO_ROOT, "index.html")
ANON_TERMS_PATH = os.path.join(SCRIPT_DIR, "anon_terms.txt")

TEXT_EXTENSIONS = {".html", ".css", ".js", ".md", ".py", ".json", ".txt"}

# Files we deliberately do not scan for leaks: this script's own source
# (its regex literals contain the very substrings it looks for) and the
# gitignored term list (which by definition contains the banned terms).
SCAN_EXCLUDE = {SCRIPT_PATH, os.path.abspath(ANON_TERMS_PATH)}

USERS_PATH_RE = re.compile(r"/Users/")
GITHUB_RE = re.compile(r"github\.com/\S+")
GMAIL_RE = re.compile(r"@gmail\b")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
ALLOWED_EMAIL = "anonymous@example.com"

ASSET_ATTRS = ("data-video", "data-poster", "src")


class SiteParser(HTMLParser):
    """Collects TODO blocks, media asset references, step chips, the
    noindex meta tag, and any leading-'/' src/href/data-* attributes."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.div_depth = 0
        self.todo_stack = []
        self.todos = []  # {'line': int, 'title': str}
        self.assets = []  # {'attr': str, 'value': str, 'line': int}
        self.chips = []  # {'line': int, 'value': str}
        self.has_noindex = False
        self.leading_slash = []  # {'attr': str, 'value': str, 'line': int}

    def handle_starttag(self, tag, attrs):
        self._handle(tag, attrs)

    def handle_startendtag(self, tag, attrs):
        self._handle(tag, attrs)

    def _handle(self, tag, attrs):
        attrs_dict = dict(attrs)
        line, _col = self.getpos()

        if tag == "div":
            self.div_depth += 1
            classes = (attrs_dict.get("class") or "").split()
            if "todo" in classes:
                self.todo_stack.append(
                    {"depth": self.div_depth, "line": line, "title": None,
                     "capturing_h4": False, "title_parts": []}
                )

        if tag == "h4" and self.todo_stack:
            top = self.todo_stack[-1]
            if top["title"] is None:
                top["capturing_h4"] = True
                top["title_parts"] = []

        if tag == "meta" and (attrs_dict.get("name") or "").lower() == "robots":
            content = (attrs_dict.get("content") or "").lower()
            if "noindex" in content and "nofollow" in content:
                self.has_noindex = True

        if tag == "button":
            classes = (attrs_dict.get("class") or "").split()
            if "step-chip" in classes and "data-seek" in attrs_dict:
                self.chips.append({"line": line, "value": attrs_dict.get("data-seek", "")})

        for attr in ASSET_ATTRS:
            if attr in attrs_dict:
                self.assets.append({"attr": attr, "value": attrs_dict[attr], "line": line})

        for key, value in attrs_dict.items():
            if value is None:
                continue
            if (key.startswith("data-") or key in ("src", "href")) and value.startswith("/") \
                    and not value.startswith("//"):
                self.leading_slash.append({"attr": key, "value": value, "line": line})

    def handle_data(self, data):
        if self.todo_stack and self.todo_stack[-1].get("capturing_h4"):
            self.todo_stack[-1]["title_parts"].append(data)

    def handle_endtag(self, tag):
        if tag == "h4" and self.todo_stack and self.todo_stack[-1].get("capturing_h4"):
            top = self.todo_stack[-1]
            top["title"] = "".join(top["title_parts"]).strip()
            top["capturing_h4"] = False

        if tag == "div":
            if self.todo_stack and self.todo_stack[-1]["depth"] == self.div_depth:
                finished = self.todo_stack.pop()
                self.todos.append({
                    "line": finished["line"],
                    "title": finished["title"] or "(no <h4> title found)",
                })
            self.div_depth -= 1


def ensure_gitignore_entry():
    """Make sure tools/anon_terms.txt is gitignored (append if missing)."""
    entry = "tools/anon_terms.txt"
    gitignore_path = os.path.join(REPO_ROOT, ".gitignore")
    try:
        content = ""
        if os.path.exists(gitignore_path):
            with open(gitignore_path, "r", encoding="utf-8") as f:
                content = f.read()
        if entry in content.splitlines():
            return
        with open(gitignore_path, "a", encoding="utf-8") as f:
            if content and not content.endswith("\n"):
                f.write("\n")
            f.write(entry + "\n")
    except OSError as exc:
        print("warning: could not update .gitignore (%s)" % exc)


def load_terms(cli_terms):
    terms = []
    if cli_terms:
        terms.extend(t.strip() for t in cli_terms.split(",") if t.strip())
    if os.path.exists(ANON_TERMS_PATH):
        try:
            with open(ANON_TERMS_PATH, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#"):
                        terms.append(line)
        except OSError:
            pass
    return terms


def iter_text_files():
    for dirpath, dirnames, filenames in os.walk(REPO_ROOT):
        dirnames[:] = [d for d in dirnames if d != ".git"]
        for name in filenames:
            if os.path.splitext(name)[1].lower() in TEXT_EXTENSIONS:
                path = os.path.join(dirpath, name)
                if os.path.abspath(path) in SCAN_EXCLUDE:
                    continue
                yield path


def scan_for_leaks(terms):
    leaks = []  # (relpath, lineno, description)
    for path in iter_text_files():
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()
        except OSError:
            continue
        relpath = os.path.relpath(path, REPO_ROOT)
        for i, line in enumerate(lines, start=1):
            if USERS_PATH_RE.search(line):
                leaks.append((relpath, i, "local path containing '/Users/'"))
            for m in GITHUB_RE.finditer(line):
                leaks.append((relpath, i, "github.com link: %s" % m.group(0)))
            if GMAIL_RE.search(line):
                leaks.append((relpath, i, "'@gmail' address"))
            for m in EMAIL_RE.finditer(line):
                if m.group(0) != ALLOWED_EMAIL:
                    leaks.append((relpath, i, "email address: %s" % m.group(0)))
            low = line.lower()
            for term in terms:
                if term.lower() in low:
                    leaks.append((relpath, i, "banned term '%s'" % term))
    return leaks


def check_missing_media(assets):
    missing = []
    for asset in assets:
        value = asset["value"]
        if not value or value.startswith("http://") or value.startswith("https://"):
            continue
        clean_value = value.split("?")[0].split("#")[0]
        local_path = os.path.join(REPO_ROOT, clean_value)
        if not os.path.exists(local_path):
            missing.append(asset)
    return missing


def section(lines, title):
    lines.append("")
    lines.append(title)
    lines.append("-" * len(title))


def main():
    parser = argparse.ArgumentParser(description="Preflight checks for the MARBLE site.")
    parser.add_argument("--terms", default="", help="comma-separated identity terms to flag (names, lab, GitHub username)")
    parser.add_argument("--strict", action="store_true", help="treat warnings (TODOs, missing media) as failures too")
    args = parser.parse_args()

    ensure_gitignore_entry()
    terms = load_terms(args.terms)

    out = []
    out.append("MARBLE preflight report")
    out.append("repo root: %s" % REPO_ROOT)

    html_exists = os.path.exists(INDEX_PATH)
    todos, missing_media, empty_chips, leading_slash, has_noindex = [], [], [], [], False

    if not html_exists:
        section(out, "index.html")
        out.append("  index.html not found yet -- skipping TODO/media/step-chip/noindex checks.")
    else:
        with open(INDEX_PATH, "r", encoding="utf-8", errors="ignore") as f:
            html_text = f.read()
        site_parser = SiteParser()
        site_parser.feed(html_text)
        site_parser.close()

        todos = site_parser.todos
        missing_media = check_missing_media(site_parser.assets)
        empty_chips = [c for c in site_parser.chips if not c["value"].strip()]
        leading_slash = site_parser.leading_slash
        has_noindex = site_parser.has_noindex

        section(out, "TODO blocks (%d)" % len(todos))
        if todos:
            for t in sorted(todos, key=lambda x: x["line"]):
                out.append("  line %4d: %s" % (t["line"], t["title"]))
        else:
            out.append("  none found")

        section(out, "Missing media (%d)" % len(missing_media))
        if missing_media:
            for a in sorted(missing_media, key=lambda x: x["line"]):
                out.append("  line %4d: %s=\"%s\"" % (a["line"], a["attr"], a["value"]))
        else:
            out.append("  none -- all relative media paths exist")

        section(out, "Step chips with empty data-seek (%d)" % len(empty_chips))
        if empty_chips:
            for c in sorted(empty_chips, key=lambda x: x["line"]):
                out.append("  line %4d: <button class=\"step-chip\" data-seek=\"\">" % c["line"])
        else:
            out.append("  none")

        section(out, "Leading-slash paths (%d)" % len(leading_slash))
        if leading_slash:
            for p in sorted(leading_slash, key=lambda x: x["line"]):
                out.append("  line %4d: %s=\"%s\"" % (p["line"], p["attr"], p["value"]))
        else:
            out.append("  none -- all paths are relative")

        section(out, "noindex meta tag")
        out.append("  present" if has_noindex else "  MISSING <meta name=\"robots\" content=\"noindex, nofollow\">")

    leaks = scan_for_leaks(terms)
    section(out, "Identity leaks (%d)" % len(leaks))
    if leaks:
        for relpath, lineno, desc in leaks:
            out.append("  %s:%d: %s" % (relpath, lineno, desc))
    else:
        out.append("  none found")
    if terms:
        out.append("  (checked against %d custom term(s): %s)" % (len(terms), ", ".join(terms)))
    else:
        out.append("  (no custom terms supplied -- pass --terms or add tools/anon_terms.txt)")

    errors = bool(leaks) or bool(leading_slash) or (html_exists and not has_noindex)
    warnings = bool(todos) or bool(missing_media) or bool(empty_chips) or not html_exists

    out.append("")
    if errors:
        out.append("RESULT: FAIL -- fix identity leaks / leading-slash paths / missing noindex tag before anonymizing.")
    elif warnings:
        out.append("RESULT: PASS with warnings -- TODOs and/or missing media remain.")
    else:
        out.append("RESULT: PASS -- clean.")

    print("\n".join(out))

    if errors:
        return 1
    if args.strict and warnings:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
