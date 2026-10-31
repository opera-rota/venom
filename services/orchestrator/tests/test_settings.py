import pytest

from venom_orchestrator.settings import BrainSettings, SettingsError


def test_uses_the_real_engines_by_default() -> None:
    settings = BrainSettings.from_environment({"OPENROUTER_API_KEY": "sk-or-test"})
    assert settings.test_drive is False
    assert settings.understand_models[0] == "anthropic/claude-haiku-5.5"


def test_test_drive_switches_to_free_models() -> None:
    settings = BrainSettings.from_environment({"OPENROUTER_API_KEY": "sk-or-test", "VENOM_TEST_DRIVE": "1"})
    assert settings.test_drive is True


def test_refuses_a_missing_key_and_an_unclear_test_drive() -> None:
    with pytest.raises(SettingsError, match="OPENROUTER_API_KEY"):
        BrainSettings.from_environment({})
    with pytest.raises(SettingsError, match="VENOM_TEST_DRIVE"):
        BrainSettings.from_environment({"OPENROUTER_API_KEY": "sk-or-test", "VENOM_TEST_DRIVE": "maybe"})
