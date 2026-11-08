import unittest
from unittest.mock import MagicMock, patch

import server


class ConnectionLifecycleTests(unittest.TestCase):
    def test_postgres_connection_is_closed_after_success(self):
        conn = MagicMock()
        with patch.object(server, "USE_POSTGRES", True), patch.object(server.psycopg2, "connect", return_value=conn):
            with server.connect() as db:
                self.assertIs(db, conn)
        conn.__enter__.assert_called_once()
        conn.__exit__.assert_called_once()
        conn.close.assert_called_once()

    def test_postgres_connection_is_closed_after_exception(self):
        conn = MagicMock()
        with patch.object(server, "USE_POSTGRES", True), patch.object(server.psycopg2, "connect", return_value=conn):
            with self.assertRaisesRegex(RuntimeError, "test failure"):
                with server.connect():
                    raise RuntimeError("test failure")
        conn.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
