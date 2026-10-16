import importlib.util
import pathlib
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('control', HERE / 'control-production.py')
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)
SOURCE = (HERE.parent.parent / 'docker-compose.yml').read_text()


class ComposeRepairTests(unittest.TestCase):
    def test_installs_tunnel_and_preserves_unrelated_host_settings(self):
        before = '''services:
  backend:
    image: private-existing-image
    environment:
      CS2_GCP_ZONE: europe-west3-c
      CUSTOM_SETTING: keep-me
    depends_on:
      - postgres
    volumes:
      - ./cs2-control:/app/cs2-control
  frontend-nextjs:
    image: keep-existing-frontend
networks:
  db2:
    external: true
'''
        after = control.patch_compose(before, SOURCE)
        self.assertIn('      CS2_RCON_HOST: cs2-rcon-tunnel\n', after)
        self.assertIn('    image: private-existing-image\n', after)
        self.assertIn('      CUSTOM_SETTING: keep-me\n', after)
        self.assertIn('      - ./cs2-control:/app/cs2-control\n', after)
        self.assertTrue(after.endswith(before[before.index('  frontend-nextjs:'):]))
        self.assertNotIn('    ports:', after[:after.index('  backend:')])

    def test_reapplying_does_not_duplicate_service_override_or_dependency(self):
        after = control.patch_compose(SOURCE, SOURCE)
        self.assertEqual(control.patch_compose(after, SOURCE), after)
        self.assertEqual(after.count('  cs2-rcon-tunnel:\n'), 1)
        self.assertEqual(after.count('      CS2_RCON_HOST:'), 1)
        self.assertEqual(after.count('      - cs2-rcon-tunnel\n'), 1)

    def test_existing_private_override_is_replaced(self):
        before = SOURCE.replace('CS2_RCON_HOST: cs2-rcon-tunnel', 'CS2_RCON_HOST: 10.156.0.11')
        self.assertEqual(control.patch_compose(before, SOURCE), control.patch_compose(SOURCE, SOURCE))

    def test_unknown_host_configuration_is_rejected(self):
        for before in ['services:\n  frontend:\n    image: old\n', SOURCE.replace('    depends_on:', '    other:').replace('      - cs2-rcon-tunnel\n', '')]:
            with self.assertRaises(ValueError):
                control.patch_compose(before, SOURCE)


if __name__ == '__main__':
    unittest.main()
