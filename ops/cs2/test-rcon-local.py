"""Local RCON address selection; no live connections or credentials."""
import importlib.util
import pathlib
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('rcon_local', pathlib.Path(__file__).with_name('rcon-local.py'))
rcon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rcon)


class LocalConnectionTests(unittest.TestCase):
    def test_prefers_loopback_without_route_lookup(self):
        with mock.patch.object(rcon.socket, 'create_connection') as connect, mock.patch.object(rcon.socket, 'socket') as probe:
            self.assertIs(rcon.connect_local(), connect.return_value)
            connect.assert_called_once_with(('127.0.0.1', 27015), timeout=5)
            probe.assert_not_called()

    def test_discovers_private_interface_after_loopback_refusal(self):
        for address in ['10.156.0.11', '10.156.0.25', '172.16.1.2', '192.168.1.2']:
            with self.subTest(address=address), mock.patch.object(rcon.socket, 'create_connection', side_effect=[ConnectionRefusedError(), 'connected']) as connect, mock.patch.object(rcon.socket, 'socket') as probe:
                route = probe.return_value.__enter__.return_value
                route.getsockname.return_value = (address, 12345)
                self.assertEqual(rcon.connect_local(), 'connected')
                route.connect.assert_called_once_with(('169.254.169.254', 80))
                self.assertEqual(connect.call_args_list[-1], mock.call((address, 27015), timeout=5))
                route.send.assert_not_called()

    def test_never_sends_rcon_credentials_to_public_or_non_private_addresses(self):
        for address in ['8.8.8.8', '169.254.1.2', '127.0.0.1', '0.0.0.0']:
            with self.subTest(address=address), mock.patch.object(rcon.socket, 'create_connection', side_effect=ConnectionRefusedError()) as connect, mock.patch.object(rcon.socket, 'socket') as probe:
                probe.return_value.__enter__.return_value.getsockname.return_value = (address, 12345)
                with self.assertRaisesRegex(RuntimeError, 'private RCON address unavailable'):
                    rcon.connect_local()
                self.assertEqual(connect.call_count, 1)

    def test_does_not_retry_loopback_timeouts(self):
        with mock.patch.object(rcon.socket, 'create_connection', side_effect=TimeoutError()), mock.patch.object(rcon.socket, 'socket') as probe:
            with self.assertRaises(TimeoutError):
                rcon.connect_local()
            probe.assert_not_called()


if __name__ == '__main__':
    unittest.main()
