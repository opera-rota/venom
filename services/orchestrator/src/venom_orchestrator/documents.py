from dataclasses import dataclass

from venom_contracts.models import ChatDocument

OPEN = "<document>"
CLOSE = "</document>"
TITLE_CHARACTERS = 120
BODY_CHARACTERS = 32_000
UNTITLED = "Document"
HANDED_OVER = "Here it is."
WRITING = "\n\n*Writing the document…*"
BODY_CUT = "\n\n*The document was cut here because it reached the length limit.*"


@dataclass
class DocumentStream:
    pending: str = ""
    inside: bool = False
    announced: bool = False

    def feed(self, text: str) -> str:
        self.pending += text
        shown: list[str] = []
        while self.pending:
            tag = CLOSE if self.inside else OPEN
            at = self.pending.find(tag)
            if at < 0:
                kept = held_back(self.pending, tag)
                if not self.inside:
                    shown.append(self.pending[: len(self.pending) - kept])
                self.pending = self.pending[len(self.pending) - kept :]
                break
            if not self.inside:
                shown.append(self.pending[:at])
            self.pending = self.pending[at + len(tag) :]
            self.inside = not self.inside
            if self.inside and not self.announced:
                shown.append(WRITING)
                self.announced = True
        return "".join(shown)


def held_back(text: str, tag: str) -> int:
    for size in range(min(len(tag) - 1, len(text)), 0, -1):
        if tag.startswith(text[-size:]):
            return size
    return 0


def split(text: str) -> tuple[str, ChatDocument | None]:
    start = text.find(OPEN)
    if start < 0:
        return text, None
    end = text.find(CLOSE, start)
    inner = text[start + len(OPEN) : len(text) if end < 0 else end]
    after = "" if end < 0 else text[end + len(CLOSE) :]
    words = without_tags(text[:start] + after).strip()
    document = parsed(inner)
    if document is None:
        return words or without_tags(inner).strip() or HANDED_OVER, None
    return words or HANDED_OVER, document


def parsed(inner: str) -> ChatDocument | None:
    lines = without_tags(inner).strip().splitlines()
    if not lines:
        return None
    first = lines[0].strip()
    titled = first.startswith("# ")
    title = first[2:].strip() if titled else UNTITLED
    body = "\n".join(lines[1:] if titled else lines).strip()
    if not body:
        return None
    return ChatDocument(title=shortened(title or UNTITLED), body=bounded(body))


def without_tags(text: str) -> str:
    return text.replace(OPEN, "").replace(CLOSE, "")


def shortened(title: str) -> str:
    return title if len(title) <= TITLE_CHARACTERS else title[: TITLE_CHARACTERS - 1].rstrip() + "…"


def bounded(body: str) -> str:
    if len(body) <= BODY_CHARACTERS:
        return body
    return body[: BODY_CHARACTERS - len(BODY_CUT)].rstrip() + BODY_CUT
