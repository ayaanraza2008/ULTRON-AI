import socket
import unittest

from navigation_policy import build_host_resolver_rules, resolve_public_https_targets


def fake_resolver(*addresses):
    def resolve(host, port, type=socket.SOCK_STREAM):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (address, port))
            for address in addresses
        ]
    return resolve


class NavigationPolicyTests(unittest.TestCase):
    def test_pins_explicit_public_https_target_and_fails_closed_for_other_hosts(self):
        urls, pins = resolve_public_https_targets(
            "Open this public page: https://docs.python.org/3/library/",
            fake_resolver("8.8.8.8"),
        )
        self.assertEqual(urls, ["https://docs.python.org/3/library/"])
        self.assertEqual(pins, {"docs.python.org": "8.8.8.8"})
        rules = build_host_resolver_rules(pins)
        self.assertEqual(rules, "MAP docs.python.org 8.8.8.8,MAP * ~NOTFOUND")

    def test_accepts_multiple_explicit_public_targets_and_deduplicates_host_pins(self):
        urls, pins = resolve_public_https_targets(
            "Compare https://docs.python.org/3/ and https://docs.python.org/3/library/ "
            "plus https://www.python.org/",
            fake_resolver("8.8.8.8"),
        )
        self.assertEqual(len(urls), 3)
        self.assertEqual(set(pins), {"docs.python.org", "www.python.org"})

    def test_rejects_unscoped_browser_tasks_without_explicit_urls(self):
        with self.assertRaisesRegex(ValueError, "explicit public HTTPS URL"):
            resolve_public_https_targets("Search for public documentation")

    def test_rejects_http_urls_even_when_a_public_hostname_is_used(self):
        with self.assertRaisesRegex(ValueError, "only to explicit HTTPS"):
            resolve_public_https_targets("Visit http://docs.python.org/", fake_resolver("8.8.8.8"))

    def test_rejects_credentials_and_nonstandard_ports(self):
        with self.assertRaisesRegex(ValueError, "credentials"):
            resolve_public_https_targets("Visit https://user:password@docs.python.org/", fake_resolver("8.8.8.8"))
        with self.assertRaisesRegex(ValueError, "port 443"):
            resolve_public_https_targets("Visit https://docs.python.org:8443/", fake_resolver("8.8.8.8"))

    def test_rejects_ipv4_and_ipv6_literal_hosts(self):
        for url in ("https://127.0.0.1/", "https://169.254.169.254/latest/meta-data/", "https://[::1]/", "https://[fd00::1]/"):
            with self.subTest(url=url):
                with self.assertRaises(ValueError):
                    resolve_public_https_targets("Visit " + url, fake_resolver("8.8.8.8"))

    def test_rejects_local_and_reserved_dns_names_before_lookup(self):
        for host in ("localhost", "myhost.local", "metadata.google.internal", "service.test", "site.example"):
            with self.subTest(host=host):
                with self.assertRaises(ValueError):
                    resolve_public_https_targets("Visit https://" + host + "/", fake_resolver("8.8.8.8"))

    def test_rejects_dns_answers_that_include_private_or_link_local_ips(self):
        cases = [
            ("10.12.0.4",),
            ("8.8.8.8", "169.254.169.254"),
            ("127.0.0.1",),
            ("::1",),
            ("fc00::1",),
        ]
        for addresses in cases:
            with self.subTest(addresses=addresses):
                with self.assertRaisesRegex(ValueError, "non-public"):
                    resolve_public_https_targets("Visit https://docs.python.org/", fake_resolver(*addresses))

    def test_rejects_dns_failure_and_empty_results(self):
        def fail(_host, _port, type=socket.SOCK_STREAM):
            raise socket.gaierror("synthetic failure")
        with self.assertRaisesRegex(ValueError, "could not be safely resolved"):
            resolve_public_https_targets("Visit https://docs.python.org/", fail)
        with self.assertRaisesRegex(ValueError, "at least one public"):
            resolve_public_https_targets("Visit https://docs.python.org/", lambda *_args, **_kwargs: [])

    def test_caps_explicit_targets(self):
        text = " ".join(f"https://host{i}.example.org/" for i in range(6))
        with self.assertRaisesRegex(ValueError, "At most 5"):
            resolve_public_https_targets(text, fake_resolver("8.8.8.8"))

    def test_host_resolver_policy_never_allows_an_empty_target_list(self):
        with self.assertRaisesRegex(ValueError, "(?i)at least one"):
            build_host_resolver_rules({})


if __name__ == "__main__":
    unittest.main()
