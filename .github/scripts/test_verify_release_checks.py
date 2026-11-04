import copy
import io
import json
import unittest
import urllib.error
from unittest.mock import patch

import verify_release_checks as gate

REPO = 'example/doctarx'
SHA = 'a' * 40


def run(**changes):
    item = {'id': 1, 'run_number': 1, 'run_attempt': 1,
            'head_sha': SHA, 'head_branch': 'main', 'event': 'push',
            'repository': {'full_name': REPO}, 'head_repository': {'full_name': REPO},
            'path': '.github/workflows/ci.yml', 'status': 'completed', 'conclusion': 'success',
            'run_started_at': '2026-11-04T08:00:00Z',
            'updated_at': '2026-11-04T09:00:00Z'}
    item.update(changes)
    return item


def evaluate(runs, **changes):
    data = {'total_count': len(runs), 'workflow_runs': runs}
    data.update(changes)
    return gate.evaluate_runs(data, repository=REPO, sha=SHA, workflow='ci.yml')


class ReleaseChecks(unittest.TestCase):
    def test_exact_head_success_and_latest_attempt(self):
        self.assertEqual(evaluate([run()]), 1)
        self.assertEqual(evaluate([run(), run(id=2, run_number=2)]), 2)
        self.assertEqual(evaluate([run(), run(run_attempt=2)]), 1)

    def test_newer_failure_or_pending_cannot_fall_back_to_old_success(self):
        for status, conclusion in [('queued', None), ('in_progress', None), ('waiting', None),
                                   ('completed', 'failure'), ('completed', 'cancelled'),
                                   ('completed', 'skipped'), ('completed', 'neutral'),
                                   ('completed', 'timed_out'), ('completed', None)]:
            with self.subTest(status=status, conclusion=conclusion), self.assertRaises(gate.GateError):
                evaluate([run(), run(id=2, run_number=2, status=status, conclusion=conclusion)])
            with self.assertRaises(gate.GateError):
                evaluate([run(), run(run_attempt=2, status=status, conclusion=conclusion)])

    def test_wrong_source_branch_repository_or_workflow_is_rejected(self):
        for changed in [{'head_sha': 'b' * 40}, {'head_branch': 'feature'},
                        {'repository': {'full_name': 'other/doctarx'}},
                        {'head_repository': {'full_name': 'fork/doctarx'}},
                        {'path': '.github/workflows/other.yml'}, {'id': None},
                        {'run_attempt': None}, {'run_number': True}, {'head_repository': None},
                        {'updated_at': None}, {'updated_at': '2026-11-04T09:00:00'},
                        {'run_started_at': None}, {'run_started_at': '2026-11-04T10:00:00Z'}]:
            with self.subTest(changed=changed), self.assertRaises(gate.GateError):
                evaluate([run(**changed)])

    def test_recent_retry_of_older_run_supersedes_an_older_green_run(self):
        with self.assertRaises(gate.GateError):
            evaluate([run(id=2, run_number=2),
                      run(run_attempt=2, run_started_at='2026-11-04T09:30:00Z', updated_at='2026-11-04T10:00:00Z',
                          status='in_progress', conclusion=None)])

    def test_late_finishing_old_success_cannot_hide_a_newer_pending_or_failed_run(self):
        for status, conclusion in [('in_progress', None), ('completed', 'failure')]:
            with self.subTest(status=status), self.assertRaises(gate.GateError):
                evaluate([run(run_started_at='2026-11-04T09:00:00Z', updated_at='2026-11-04T10:05:00Z'),
                          run(id=2, run_number=2, run_started_at='2026-11-04T10:00:00Z',
                              updated_at='2026-11-04T10:04:00Z', status=status, conclusion=conclusion)])

    def test_equally_recent_unaccepted_attempt_cannot_be_hidden_by_green_tiebreaker(self):
        with self.assertRaises(gate.GateError):
            evaluate([run(status='in_progress', conclusion=None), run(id=2, run_number=2)])

    def test_retained_original_start_cannot_hide_pending_or_failed_old_id_retries(self):
        for status, conclusion in [('queued', None), ('in_progress', None), ('completed', 'failure')]:
            with self.subTest(status=status), self.assertRaises(gate.GateError):
                evaluate([run(run_attempt=2, run_started_at='2026-11-04T08:00:00Z',
                              updated_at='2026-11-04T11:00:00Z', status=status, conclusion=conclusion),
                          run(id=2, run_number=2, run_started_at='2026-11-04T10:00:00Z',
                              updated_at='2026-11-04T10:30:00Z')])

    def test_earlier_failure_completed_before_later_green_start_can_be_superseded(self):
        self.assertEqual(evaluate([
            run(status='completed', conclusion='failure'),
            run(id=2, run_number=2, run_started_at='2026-11-04T10:00:00Z',
                updated_at='2026-11-04T10:30:00Z'),
        ]), 2)

    def test_pr_and_unavailable_or_incomplete_evidence_fail_closed(self):
        for runs in [[], [run(event='pull_request')], [run(event='pull_request_target')],
                     [run(event='workflow_run')]]:
            with self.assertRaises(gate.GateError):
                evaluate(runs)
        for data in [{}, {'total_count': 1, 'workflow_runs': []},
                     {'total_count': 101, 'workflow_runs': [run()]},
                     {'total_count': True, 'workflow_runs': [run()]}]:
            with self.assertRaises(gate.GateError):
                gate.evaluate_runs(data, repository=REPO, sha=SHA, workflow='ci.yml')

    def test_untrusted_context_and_missing_token_fail_before_network(self):
        valid = {'GITHUB_REPOSITORY': REPO, 'GITHUB_SHA': SHA, 'GITHUB_REF': 'refs/heads/main',
                 'GITHUB_EVENT_NAME': 'push', 'GITHUB_TOKEN': 'fictional-token'}
        for changes in [{'GITHUB_SHA': 'short'}, {'GITHUB_REF': 'refs/heads/feature'},
                        {'GITHUB_REPOSITORY': '../other'}, {'GITHUB_EVENT_NAME': 'pull_request'},
                        {'GITHUB_EVENT_NAME': 'workflow_run'}, {'GITHUB_TOKEN': ''}]:
            with patch.object(gate, 'fetch_runs', side_effect=AssertionError('must not fetch')):
                with self.assertRaises(gate.GateError):
                    gate.main({**valid, **changes})

    def test_only_get_fixed_workflow_endpoint_without_artifact_downloads(self):
        class Response(io.BytesIO):
            status = 200
        class Opener:
            def open(self, request, timeout):
                self.request, self.timeout = request, timeout
                return Response(json.dumps({'workflow_runs': [], 'total_count': 0}).encode())
        opener = Opener()
        gate.fetch_runs(REPO, SHA, 'ci.yml', 'fictional-token', opener)
        self.assertEqual(opener.request.method, 'GET')
        self.assertIsNone(opener.request.data)
        self.assertEqual(opener.request.full_url.split('?')[0],
                         f'https://api.github.com/repos/{REPO}/actions/workflows/ci.yml/runs')
        self.assertIn('head_sha=' + SHA, opener.request.full_url)
        self.assertEqual(opener.timeout, 20)

    def test_api_errors_and_redirects_fail_closed_without_private_details(self):
        class Opener:
            def open(self, *_args, **_kwargs):
                raise urllib.error.URLError('private-token-detail')
        with self.assertRaises(gate.GateError) as caught:
            gate.fetch_runs(REPO, SHA, 'ci.yml', 'fictional-token', Opener())
        self.assertNotIn('private-token-detail', str(caught.exception))
        with self.assertRaises(gate.GateError):
            gate.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other.example')

    def test_both_workflows_are_required_and_no_state_changing_tool_is_used(self):
        env = {'GITHUB_REPOSITORY': REPO, 'GITHUB_SHA': SHA, 'GITHUB_REF': 'refs/heads/main',
               'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_TOKEN': 'fictional-token'}
        calls = []
        def fetch(repository, sha, workflow, token):
            calls.append(workflow)
            item = copy.deepcopy(run())
            item['path'] = '.github/workflows/' + workflow
            return {'total_count': 1, 'workflow_runs': [item]}
        with patch.object(gate, 'fetch_runs', side_effect=fetch), patch('sys.stdout', new=io.StringIO()):
            gate.main(env)
        self.assertEqual(calls, ['ci.yml', 'careops-foundation.yml'])


if __name__ == '__main__':
    unittest.main()
