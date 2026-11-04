#!/usr/bin/env python3
"""Add the Nursing reverse-proxy routes to the active DoctaRx server block."""

from __future__ import annotations

import os
import re
from pathlib import Path


BEGIN = "# BEGIN DOCTARX NURSING EDUCATION"
END = "# END DOCTARX NURSING EDUCATION"
MARKED_BLOCK = re.compile(
    rf"\n?[ \t]*{re.escape(BEGIN)}.*?^[ \t]*{re.escape(END)}[ \t]*\n?",
    re.MULTILINE | re.DOTALL,
)

PROXY_HEADERS = """        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        client_max_body_size 25m;"""

LOCATIONS = f"""    {BEGIN}
    location = /nursing-education {{
        proxy_pass http://127.0.0.1:3004;
{PROXY_HEADERS}
    }}

    location = /nursing-education/ {{
        proxy_pass http://127.0.0.1:3004/nursing-education;
{PROXY_HEADERS}
    }}

    location ^~ /nursing-education/_next/ {{
        proxy_pass http://127.0.0.1:3004/_next/;
{PROXY_HEADERS}
    }}

    location ^~ /ng/nursing {{
        proxy_pass http://127.0.0.1:3004;
{PROXY_HEADERS}
    }}

    location ^~ /ng/education {{
        proxy_pass http://127.0.0.1:3004;
{PROXY_HEADERS}
    }}

    location ^~ /api/nursing {{
        proxy_pass http://127.0.0.1:3004;
{PROXY_HEADERS}
    }}

    location ^~ /images/nursing {{
        proxy_pass http://127.0.0.1:3004;
{PROXY_HEADERS}
    }}
    {END}
"""


def server_blocks(text: str) -> list[tuple[int, int]]:
    blocks: list[tuple[int, int]] = []
    for match in re.finditer(r"\bserver\s*\{", text):
        opening = text.find("{", match.start())
        depth = 0
        quote = ""
        escaped = False
        comment = False
        for index in range(opening, len(text)):
            character = text[index]
            if comment:
                if character == "\n":
                    comment = False
                continue
            if escaped:
                escaped = False
                continue
            if character == "\\":
                escaped = True
                continue
            if quote:
                if character == quote:
                    quote = ""
                continue
            if character in {"'", '"'}:
                quote = character
                continue
            if character == "#":
                comment = True
                continue
            if character == "{":
                depth += 1
            elif character == "}":
                depth -= 1
                if depth == 0:
                    blocks.append((match.start(), index))
                    break
    return blocks


def write_preserving_mode(path: Path, content: str) -> None:
    stat = path.stat()
    temporary = path.with_name(f".{path.name}.doctarx-aux.tmp")
    temporary.write_text(content, encoding="utf-8")
    os.chmod(temporary, stat.st_mode)
    if hasattr(os, "chown"):
        os.chown(temporary, stat.st_uid, stat.st_gid)
    os.replace(temporary, path)


def main() -> None:
    nginx_root = Path(os.environ.get("NGINX_ROOT", "/etc/nginx"))
    files = sorted(
        path
        for path in nginx_root.rglob("*.conf")
        if path.is_file() and "backup" not in str(path).lower()
    )
    if not files:
        raise SystemExit("No nginx configuration files were found")

    cleaned: dict[Path, str] = {}
    targets: dict[Path, list[int]] = {}
    for path in files:
        original = path.read_text(encoding="utf-8")
        content = MARKED_BLOCK.sub("\n", original)
        cleaned[path] = content
        for start, end in server_blocks(content):
            block = content[start : end + 1]
            if not re.search(r"\bserver_name\b[^;]*\b(?:www\.)?doctarx\.com\b", block):
                continue
            targets.setdefault(path, []).append(end)

    if not targets:
        raise SystemExit("Could not locate an active nginx server block for doctarx.com")

    for target, closing_braces in targets.items():
        content = cleaned[target]
        for closing_brace in sorted(set(closing_braces), reverse=True):
            content = (
                content[:closing_brace].rstrip()
                + "\n\n"
                + LOCATIONS
                + content[closing_brace:]
            )
        cleaned[target] = content

    for path, content in cleaned.items():
        if content != path.read_text(encoding="utf-8"):
            write_preserving_mode(path, content)

    print(", ".join(str(path) for path in sorted(targets)))


if __name__ == "__main__":
    main()
