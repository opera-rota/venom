from uuid import UUID

import pytest

from venom_contracts.engines import get_engine
from venom_contracts.models import ChatDocument, TurnDelta, TurnDone, TurnRequest
from venom_orchestrator.documents import BODY_CHARACTERS, BODY_CUT, HANDED_OVER, UNTITLED, WRITING, DocumentStream, split
from venom_orchestrator.engines import EngineCatalogue
from venom_orchestrator.turns import Orchestrator
from venom_reasoning.reasoner import Limits, Reasoner
from venom_reasoning.testing import ScriptedProvider, answer, structured

pytestmark = pytest.mark.anyio

PRIMARY = get_engine("titan").models[0]

LIST_ANSWER = "Here is your list, buddy.\n<document>\n# Shopping list\n- Milk\n- Bread\n</document>"


def streamed(text: str, chunk: int) -> str:
    stream = DocumentStream()
    return "".join(stream.feed(text[start : start + chunk]) for start in range(0, len(text), chunk))


@pytest.mark.parametrize("chunk", [1, 2, 3, 5, 8, 64])
def test_streams_the_friendly_words_and_hides_the_document_whatever_the_chunks(chunk: int) -> None:
    assert streamed(LIST_ANSWER, chunk) == "Here is your list, buddy.\n" + WRITING


def test_streams_an_ordinary_answer_unchanged_even_with_angle_brackets() -> None:
    text = "Use a < b and <doc> tags freely; nothing is hidden."
    assert streamed(text, 3) == text


def test_splits_the_answer_into_words_and_a_titled_document() -> None:
    assert split(LIST_ANSWER) == ("Here is your list, buddy.", ChatDocument(title="Shopping list", body="- Milk\n- Bread"))


def test_leaves_an_ordinary_answer_alone() -> None:
    assert split("Just an answer.") == ("Just an answer.", None)


def test_gives_a_document_without_a_heading_a_plain_title_and_says_here_it_is() -> None:
    assert split("<document>\nLine one\nLine two\n</document>") == (HANDED_OVER, ChatDocument(title=UNTITLED, body="Line one\nLine two"))


def test_keeps_a_document_cut_off_before_its_closing_line() -> None:
    words, document = split("Sure.\n<document>\n# Notes\n- One\n- Two")
    assert (words, document) == ("Sure.", ChatDocument(title="Notes", body="- One\n- Two"))


def test_turns_an_empty_document_back_into_plain_words() -> None:
    assert split("Hmm.\n<document>\n# Only a title\n</document>") == ("Hmm.", None)


def test_cuts_a_document_that_is_too_long_and_says_so() -> None:
    _, document = split("<document>\n# Long\n" + "x" * (BODY_CHARACTERS + 50) + "\n</document>")
    assert document is not None
    assert len(document.body) == BODY_CHARACTERS
    assert document.body.endswith(BODY_CUT)


async def test_a_reply_hands_the_document_over_in_the_finished_turn() -> None:
    provider = ScriptedProvider({"quick": [structured('{"kind": "question"}', "quick")], PRIMARY: [answer(LIST_ANSWER, PRIMARY)]})
    reasoner = Reasoner(provider, Limits(first_output=0.5, idle=0.5, total=2.0))
    request = TurnRequest(
        request_id=UUID("0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e01"),
        account_id=UUID("0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e02"),
        device_id=UUID("0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e03"),
        engine="titan",
        history=[],
        memories=[],
        remembered=None,
        connectors=[],
        task_mode="loop",
        text="Write me a shopping list as a document",
    )
    events = [event async for event in Orchestrator(reasoner, EngineCatalogue(("quick",))).run(request)]

    assert "<document>" not in "".join(event.text for event in events if isinstance(event, TurnDelta))
    final = events[-1]
    assert isinstance(final, TurnDone)
    assert (final.intent, final.text, final.document) == ("question", "Here is your list, buddy.", ChatDocument(title="Shopping list", body="- Milk\n- Bread"))
