#!/usr/bin/env python3
"""Read-only, fail-closed exact-commit prerequisite for the existing deploy flow.

Never dispatches/reruns workflows, downloads artifacts, or executes API content.
Pending or unavailable evidence blocks deployment until an authorized later run.
"""
import json
from datetime import datetime
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

WORKFLOWS = ('ci.yml', 'careops-foundation.yml')
MAX_RESPONSE_BYTES = 2 * 1024 * 1024


class GateError(RuntimeError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise GateError('Release evidence API redirects are not accepted')


def timestamp(run, field, workflow):
    value = run.get(field)
    try:
        stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if stamp.tzinfo is None:
            raise ValueError('timezone required')
        return stamp
    except (AttributeError, TypeError, ValueError) as error:
        raise GateError(f'{workflow}: missing run recency evidence') from error


def validate_context(repository, sha, ref, event):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9][A-Za-z0-9_.-]*', repository or ''):
        raise GateError('Missing or invalid repository identity')
    if not re.fullmatch(r'[0-9a-f]{40}', sha or ''):
        raise GateError('A complete lower-case source SHA is required')
    if ref != 'refs/heads/main' or event not in ('push', 'workflow_dispatch'):
        raise GateError('Deployment prerequisites require this repository main branch')


def evaluate_runs(data, *, repository, sha, workflow):
    if not isinstance(data, dict) or not isinstance(data.get('workflow_runs'), list):
        raise GateError(f'{workflow}: malformed workflow evidence')
    runs = data['workflow_runs']
    count = data.get('total_count')
    if type(count) is not int or count < 0 or count != len(runs):
        raise GateError(f'{workflow}: incomplete workflow evidence')
    eligible = []
    for run in runs:
        if not isinstance(run, dict):
            raise GateError(f'{workflow}: malformed run')
        # A PR workflow, even from the same repository and SHA, is not main-branch
        # release acceptance. No workflow_run trigger or privileged PR checkout.
        if run.get('event') not in ('push', 'workflow_dispatch'):
            continue
        if (run.get('head_sha') != sha or run.get('head_branch') != 'main'
                or not isinstance(run.get('head_repository'), dict)
                or not isinstance(run.get('repository'), dict)
                or run['head_repository'].get('full_name') != repository
                or run['repository'].get('full_name') != repository
                or str(run.get('path', '')).split('@', 1)[0] != f'.github/workflows/{workflow}'):
            raise GateError(f'{workflow}: run identity does not match this release')
        if any(type(run.get(key)) is not int or run[key] <= 0
               for key in ('id', 'run_number', 'run_attempt')):
            raise GateError(f'{workflow}: missing run identity')
        started = timestamp(run, 'run_started_at', workflow)
        updated = timestamp(run, 'updated_at', workflow)
        if updated < started:
            raise GateError(f'{workflow}: inconsistent run recency evidence')
        eligible.append(run)
    if not eligible:
        raise GateError(f'{workflow}: no main-branch evidence for the exact SHA')
    # A list response may retain an older start while an older run ID is retried.
    # Do not let any queued/running attempt hide behind a later green run.
    if any(run.get('status') != 'completed' for run in eligible):
        raise GateError(f'{workflow}: an exact-SHA execution is still unaccepted')
    # Completion time cannot define recency: an older success can finish after a
    # newer failure. Use start time for selection, but conservatively reject any
    # unsuccessful update overlapping/after the selected start. This does not
    # assume list run_started_at is current-attempt evidence for a rerun.
    latest_start = max(timestamp(run, 'run_started_at', workflow) for run in eligible)
    latest_attempts = [run for run in eligible if timestamp(run, 'run_started_at', workflow) == latest_start]
    # GitHub timestamps have limited precision. Do not break a same-time tie in
    # favor of a success while another equally recent attempt remains unaccepted.
    if any(run.get('status') != 'completed' or run.get('conclusion') != 'success' for run in latest_attempts):
        raise GateError(f'{workflow}: latest exact-SHA attempt is not completed successfully')
    if any(run.get('conclusion') != 'success' and timestamp(run, 'updated_at', workflow) >= latest_start for run in eligible):
        raise GateError(f'{workflow}: unsuccessful attempt overlaps accepted evidence')
    latest = max(latest_attempts, key=lambda run: (run['run_number'], run['run_attempt'], run['id']))
    return latest['id']


def fetch_runs(repository, sha, workflow, token, opener=None):
    if workflow not in WORKFLOWS:
        raise GateError('Unknown required workflow')
    query = urllib.parse.urlencode({'head_sha': sha, 'branch': 'main', 'per_page': 100})
    url = f'https://api.github.com/repos/{repository}/actions/workflows/{workflow}/runs?{query}'
    request = urllib.request.Request(url, method='GET', headers={
        'Authorization': f'Bearer {token}',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
    })
    opener = opener or urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(request, timeout=20) as response:
            if response.status != 200:
                raise GateError(f'{workflow}: workflow evidence unavailable')
            body = response.read(MAX_RESPONSE_BYTES + 1)
        if len(body) > MAX_RESPONSE_BYTES:
            raise GateError(f'{workflow}: workflow evidence exceeded the limit')
        return json.loads(body)
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        # Do not emit API bodies, request headers or tokens in CI output.
        raise GateError(f'{workflow}: workflow evidence unavailable') from error


def main(env=None):
    env = os.environ if env is None else env
    repository = env.get('GITHUB_REPOSITORY', '')
    sha = env.get('GITHUB_SHA', '')
    validate_context(repository, sha, env.get('GITHUB_REF'), env.get('GITHUB_EVENT_NAME'))
    token = env.get('GITHUB_TOKEN', '')
    if not token:
        raise GateError('Read-only workflow evidence token is unavailable')
    for workflow in WORKFLOWS:
        run_id = evaluate_runs(fetch_runs(repository, sha, workflow, token),
                               repository=repository, sha=sha, workflow=workflow)
        print(f'[release-checks] {workflow}: exact-SHA run {run_id} passed')
    print(f'[release-checks] Required workflow evidence accepted for {sha}')


if __name__ == '__main__':
    try:
        main()
    except GateError as error:
        print(f'::error::Release blocked: {error}', file=sys.stderr)
        sys.exit(1)
