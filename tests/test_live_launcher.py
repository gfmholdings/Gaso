import contextlib
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('launcher', Path(__file__).resolve().parents[1] / 'test-prices.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class LauncherTests(unittest.TestCase):
    def test_environment_key_is_trimmed(self):
        with patch.dict(os.environ, {'PLACES_API_KEY': ' synthetic '}, clear=True):
            self.assertEqual(launcher.load_key(), 'synthetic')

    def test_local_env_file_is_data_not_executable_code(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, '.env').write_text('PLACES_API_KEY="synthetic-file-key"\n')
            with patch.dict(os.environ, {}, clear=True), patch.object(launcher, 'ROOT', Path(folder)):
                self.assertEqual(launcher.load_key(), 'synthetic-file-key')

    def test_missing_key_does_not_start_a_live_request(self):
        with patch.object(launcher, 'load_key', return_value=''), patch.object(launcher.sys, 'argv', ['test-prices.py']), \
             patch.object(launcher.subprocess, 'run') as run, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(launcher.main(), 1)
            run.assert_not_called()

    def test_key_is_passed_in_environment_not_command_arguments(self):
        with patch.object(launcher, 'load_key', return_value='synthetic-private-key'), \
             patch.object(launcher.sys, 'argv', ['test-prices.py', 'From', 'To']), \
             patch.object(launcher.subprocess, 'run', return_value=Mock(returncode=0)) as run:
            self.assertEqual(launcher.main(), 0)
            args, kwargs = run.call_args
            self.assertNotIn('synthetic-private-key', args[0])
            self.assertEqual(kwargs['env']['PLACES_API_KEY'], 'synthetic-private-key')
