"""Input sanitization utility.

Strips HTML tags, script injection patterns, and control characters
from text inputs before they reach the LLM.
"""

from __future__ import annotations

import re

# Matches HTML/XML tags including self-closing
_HTML_TAG_RE = re.compile(r"<[^>]+>")

# Matches common script injection patterns (case-insensitive)
_SCRIPT_PATTERNS = re.compile(
    r"(?:javascript\s*:|on\w+\s*=|eval\s*\(|expression\s*\(|url\s*\()",
    re.IGNORECASE,
)

# Control characters (C0 and C1) except common whitespace (\t, \n, \r)
_CONTROL_CHAR_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]")


def sanitize_text(text: str) -> str:
    """Remove HTML tags, script injection patterns, and control characters."""
    text = _HTML_TAG_RE.sub("", text)
    text = _SCRIPT_PATTERNS.sub("", text)
    text = _CONTROL_CHAR_RE.sub("", text)
    return text.strip()
