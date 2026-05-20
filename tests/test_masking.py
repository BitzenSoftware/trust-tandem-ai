import pytest
from masking import mask_cpf, mask_email

FALLBACK = "invalid_data***"


class TestMaskCpf:
    def test_valid(self):
        assert mask_cpf("123.456.789-00") == "***.***.***-00"

    def test_none(self):
        assert mask_cpf(None) == FALLBACK

    def test_empty_string(self):
        assert mask_cpf("") == FALLBACK

    def test_whitespace_only(self):
        assert mask_cpf("   ") == FALLBACK

    def test_letters_in_cpf(self):
        assert mask_cpf("123.ABC.789-XX") == FALLBACK

    def test_unformatted_digits(self):
        # fullmatch exige formato com pontos e traço
        assert mask_cpf("12345678900") == FALLBACK

    def test_incomplete(self):
        assert mask_cpf("123.456") == FALLBACK

    def test_strips_whitespace_before_validating(self):
        assert mask_cpf("  123.456.789-00  ") == "***.***.***-00"

    def test_preserves_verificador_digits(self):
        result = mask_cpf("123.456.789-99")
        assert result.endswith("-99")

    def test_non_string_input(self):
        assert mask_cpf(12345678900) == FALLBACK


class TestMaskEmail:
    def test_valid(self):
        result = mask_email("ana.costa@gmail.com")
        assert result.startswith("a***@")
        assert "***" in result
        assert "ana.costa" not in result
        assert "gmail.com" not in result

    def test_none(self):
        assert mask_email(None) == FALLBACK

    def test_empty_string(self):
        assert mask_email("") == FALLBACK

    def test_whitespace_only(self):
        assert mask_email("   ") == FALLBACK

    def test_no_at_symbol(self):
        assert mask_email("joao.silva.com") == FALLBACK

    def test_local_too_short(self):
        assert mask_email("z@gmail.com") == FALLBACK  # local < 2 chars

    def test_domain_name_too_short(self):
        assert mask_email("user@x.com") == FALLBACK  # domain_name < 2 chars

    def test_no_tld(self):
        assert mask_email("user@nodot") == FALLBACK

    def test_none_as_string(self):
        # str(None) = "None" — sem @ → fallback
        assert mask_email("None") == FALLBACK

    def test_strips_whitespace_before_validating(self):
        result = mask_email("  ana.costa@gmail.com  ")
        assert result.startswith("a***@")

    def test_non_string_input(self):
        assert mask_email(42) == FALLBACK
