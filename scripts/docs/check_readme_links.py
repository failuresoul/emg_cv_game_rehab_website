"""Checks that every link, image and file path in README.md exists (Day 20).

    python scripts\\docs\\check_readme_links.py [README.md ...]

- Markdown links and images, and HTML src/href: relative targets must exist (an #anchor on a
  Markdown file is checked against its headings); "#section" links must match a README heading.
- Repository paths written in backticks (`web/src/...`, `server/app/...`, `docs/...`): must exist.
  Paths with placeholders (<...>, {...}, *) are skipped.
Web links (http, https) are not fetched. Exit code 1 lists everything broken.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LINK = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
HTML = re.compile(r"""(?:src|href)=["']([^"']+)["']""")
CODE = re.compile(r"`([^`\s]+)`")
TOP = ("web/", "server/", "firmware/", "analysis/", "shared/", "scripts/", "docs/", "data/",
       ".github/", "tools/")  # fmt: skip
ROOT_FILES = {"README.md", "CHANGELOG.md", "THIRD_PARTY_NOTICES.md", "docker-compose.yml",
              "docker-compose.dev.yml", ".dockerignore", ".gitignore", "LICENSE", "CITATION.cff"}  # fmt: skip


def slug(heading: str) -> str:
    """GitHub's heading anchor: lower case, punctuation dropped, spaces to hyphens."""
    text = re.sub(r"<[^>]+>", "", heading).strip().lower()
    text = re.sub(r"[^\w\- ]", "", text, flags=re.UNICODE)
    return text.replace(" ", "-")


def anchors(markdown: str) -> set[str]:
    found: set[str] = set()
    counts: dict[str, int] = {}
    in_code = False
    for line in markdown.splitlines():
        if line.startswith("```"):
            in_code = not in_code
        if in_code:
            continue
        match = re.match(r"#{1,6}\s+(.*)", line)
        if match:
            base = slug(match.group(1))
            number = counts.get(base, 0)
            counts[base] = number + 1
            found.add(base if number == 0 else f"{base}-{number}")
    found.update(re.findall(r'<a (?:id|name)="([^"]+)"', markdown))
    return found


def without_code_blocks(markdown: str) -> str:
    return re.sub(r"```.*?```", "", markdown, flags=re.S)


def check(readme: Path) -> list[str]:
    text = readme.read_text(encoding="utf-8")
    prose = without_code_blocks(text)
    base = readme.parent
    own_anchors = anchors(text)
    problems: list[str] = []
    targets = LINK.findall(prose) + HTML.findall(prose)
    for target in targets:
        if re.match(r"^[a-z]+:", target):  # http:, https:, mailto:
            continue
        path_part, _, fragment = target.partition("#")
        if not path_part:
            if fragment not in own_anchors:
                problems.append(f"anchor #{fragment} has no heading")
            continue
        path = (base / path_part).resolve()
        if not path.exists():
            problems.append(f"missing: {target}")
        elif fragment and path.suffix == ".md" and fragment not in anchors(path.read_text(encoding="utf-8")):
            problems.append(f"anchor missing in {path_part}: #{fragment}")
    for token in CODE.findall(prose):
        token = token.rstrip(".,;:")
        if any(mark in token for mark in "<>{}*$|") or "=" in token:
            continue
        if token.startswith(TOP) or token in ROOT_FILES:
            if not (ROOT / token).exists():
                problems.append(f"missing path: `{token}`")
    return problems


def main(argv: list[str]) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    files = [Path(arg) for arg in argv] or [ROOT / "README.md"]
    broken = 0
    for readme in files:
        problems = check(readme.resolve())
        broken += len(problems)
        print(f"{readme}: {'OK' if not problems else f'{len(problems)} broken'}")
        for problem in problems:
            print(f"  {problem}")
    return 1 if broken else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
