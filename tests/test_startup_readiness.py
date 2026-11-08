import unittest
from unittest.mock import patch

import server


class StartupReadinessTests(unittest.TestCase):
    def test_database_failure_does_not_abort_http_startup(self):
        # The DB initialization worker retries failures rather than crashing
        # the process. Verify the worker succeeds on its next attempt.
        server.DB_READY.clear()
        calls = []

        def initialize():
            calls.append(1)
            if len(calls) == 1:
                raise ConnectionError("temporary Supabase outage")

        with patch.object(server, "init_db", side_effect=initialize), patch.object(server.time, "sleep", return_value=None):
            server.initialize_database_with_retry()
        self.assertEqual(len(calls), 2)
        self.assertTrue(server.DB_READY.is_set())
        server.DB_READY.clear()


if __name__ == "__main__":
    unittest.main()
