import unittest
from recover_ec2_ssm import host_script


class RecoveryCommandSafety(unittest.TestCase):
    def setUp(self):
        self.env = dict(RECOVERY_ACTION='diagnose-only', EC2_APP_DIR='/opt/zuma-teledoc', EC2_APP_USER='root', EC2_PM2_APP='doctarx', EC2_HEALTH_PORT='8080')

    def test_diagnosis_is_read_only(self):
        script = host_script(self.env)
        self.assertIn('127.0.0.1:8080/api/health', script)
        self.assertNotIn('pm2 restart', script)
        for forbidden in ('git reset', 'npm install', 'seed', 'systemctl', 'iptables', 'cftunnel', 'ssh'):
            self.assertNotIn(forbidden, script)

    def test_restart_targets_only_the_existing_named_app(self):
        self.env['RECOVERY_ACTION'] = 'restart-services'
        script = host_script(self.env)
        self.assertIn('pm2 restart doctarx --update-env', script)
        self.assertNotIn('ecosystem.config', script)
        self.assertNotIn('cloudflared', script)

    def test_untrusted_shell_fragments_and_privileged_ports_are_rejected(self):
        for key, value in [('EC2_APP_DIR', '/'), ('EC2_APP_DIR', '/opt/../other'), ('EC2_APP_USER', 'root;id'), ('EC2_PM2_APP', 'all'), ('EC2_HEALTH_PORT', '443'), ('RECOVERY_ACTION', 'rebuild')]:
            env = {**self.env, key: value}
            if key == 'EC2_PM2_APP':
                # PM2 reserves 'all' as a selector; it must never target the tunnel.
                with self.assertRaises(ValueError):
                    host_script(env)
            else:
                with self.assertRaises(ValueError):
                    host_script(env)


if __name__ == '__main__':
    unittest.main()
