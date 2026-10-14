import importlib.util
import pathlib
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('deployment', pathlib.Path(__file__).with_name('deploy-production.py'))
deployment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deployment)


class ComposePatchTests(unittest.TestCase):
    def test_existing_production_source_is_patched_without_changing_other_settings(self):
        original = subprocess.run(['git', 'show', '350c897:docker-compose.yml'], cwd=ROOT, check=True, capture_output=True, text=True).stdout
        patched = deployment.patch_compose(original)
        self.assertIn('127.0.0.1:10011:10011', patched)
        self.assertNotIn('      - "10011:10011"', patched)
        self.assertEqual(patched.count('mem_limit: 256m'), 2)
        self.assertEqual(patched.count('.teamspeak_secrets'), 1)
        self.assertEqual(patched.count('.teamspeak_server_secrets'), 1)
        for name in ['postgres', 'caddy', 'ddns']:
            self.assertEqual(deployment.block(original, name)[0], deployment.block(patched, name)[0])
        self.assertEqual(patched, deployment.patch_compose(patched))

    def test_unrecognized_query_publication_fails_before_any_file_write(self):
        original = (ROOT / 'docker-compose.yml').read_text().replace('127.0.0.1:10011:10011', '10012:10011')
        with self.assertRaises(RuntimeError):
            deployment.patch_compose(original)


if __name__ == '__main__':
    unittest.main()
