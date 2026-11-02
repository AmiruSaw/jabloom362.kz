import unittest
from unittest.mock import patch

from server import verify_admin_totp


class TOTPTests(unittest.TestCase):
    def test_rfc6238_known_vector(self):
        # RFC 6238 SHA-1 at t=59 yields 94287082 (8 digits); 6-digit suffix is 287082.
        secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
        with patch("server.time.time", return_value=59):
            self.assertTrue(verify_admin_totp(secret, "287082"))
            self.assertFalse(verify_admin_totp(secret, "287083"))
            self.assertFalse(verify_admin_totp(secret, "123"))
            self.assertFalse(verify_admin_totp(secret, "abcdef"))

    def test_invalid_secret(self):
        with patch("server.time.time", return_value=59):
            self.assertFalse(verify_admin_totp("not-base32!!", "287082"))


if __name__ == "__main__":
    unittest.main()
