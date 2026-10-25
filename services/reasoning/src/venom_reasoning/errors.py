from venom_contracts.models import ReasoningFailure

RETRYABLE: frozenset[ReasoningFailure] = frozenset({"rate_limited", "unavailable", "timeout", "invalid_output"})


class ReasoningError(Exception):
    def __init__(self, reason: ReasoningFailure, detail: str) -> None:
        super().__init__(detail)
        self.reason: ReasoningFailure = reason
        self.detail = detail

    @property
    def retryable(self) -> bool:
        return self.reason in RETRYABLE
