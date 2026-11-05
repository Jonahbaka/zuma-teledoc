const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../routes/contact'), 'utf8');
const admin = 'evolvedu@outlook.com';
const body = { name: 'Synthetic Partner', email: 'partner@example.invalid', subject: 'Fictional pilot inquiry', message: 'A synthetic nonclinical partnership inquiry.', type: 'partnership' };

function fixture({ env = { SMTP_HOST: 'smtp.example.invalid', SMTP_PORT: '587' }, outcomes = [], creationError = false } = {}) {
  const sent = []; const logs = []; const settings = []; let handler;
  vm.runInNewContext(source, {
    module: { exports: {} }, process: { env },
    require(name) {
      if (name === 'express') return { Router: () => ({ post: (path, fn) => { assert.equal(path, '/'); handler = fn; } }) };
      if (name === 'zod') return require('zod');
      if (name === '../middleware/logger') return { warn: (...args) => logs.push(args), info: (...args) => logs.push(args) };
      if (name === 'nodemailer') return { createTransport(config) {
        if (creationError) throw new Error('PRIVATE_SMTP_CREDENTIAL');
        settings.push(config);
        return { async sendMail(mail) {
          sent.push(mail);
          const outcome = outcomes[sent.length - 1];
          if (outcome instanceof Error) throw outcome;
          return outcome === undefined ? { accepted: [mail.to], rejected: [], pending: [] } : outcome;
        } };
      } };
      throw new Error('Unexpected fixture dependency: ' + name);
    },
  });
  return { sent, logs, settings, async submit(input = body) {
    let status; let result; const headers = {};
    const response = { set: (key, value) => { headers[key] = value; return response; }, status: value => { status = value; return response; }, json: value => { result = JSON.parse(JSON.stringify(value)); return response; } };
    await handler({ body: input }, response);
    return { status, result, headers };
  } };
}

test('missing SMTP is unavailable in production and development without pretending to deliver', async () => {
  for (const NODE_ENV of ['production', 'development']) {
    const f = fixture({ env: { NODE_ENV } });
    const response = await f.submit();
    assert.equal(response.status, 503);
    assert.equal(response.result.success, false);
    assert.equal(response.result.code, 'CONTACT_UNAVAILABLE');
    assert.equal(response.result.contactEmail, 'info@doctarx.com');
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.equal(f.sent.length, 0);
    assert.equal(f.settings.length, 0);
  }
});

test('invalid SMTP ports and incomplete authentication fail closed', async () => {
  for (const patch of [{ SMTP_PORT: '' }, { SMTP_PORT: '587oops' }, { SMTP_PORT: '65536' }, { SMTP_USER: 'fixture' }, { SMTP_PASSWORD: 'fixture' }]) {
    const f = fixture({ env: { SMTP_HOST: 'smtp.example.invalid', SMTP_PORT: '587', ...patch } });
    assert.equal((await f.submit()).status, 503);
    assert.equal(f.sent.length, 0);
  }
});

test('primary recipient must be accepted, with no rejection or pending status', async () => {
  for (const receipt of [{ messageId: 'not-proof' }, { accepted: [] }, { accepted: ['other@example.invalid'] }, { accepted: [admin], rejected: [admin] }, { accepted: [admin], pending: [admin] }, null]) {
    const f = fixture({ outcomes: [receipt] });
    const response = await f.submit();
    assert.equal(response.status, 503);
    assert.equal(response.result.code, 'CONTACT_UNCONFIRMED');
    assert.equal(f.sent.length, 1, 'do not acknowledge an unconfirmed enquiry');
  }
});

test('confirmed primary and acknowledgement preserve successful submission', async () => {
  const f = fixture({ outcomes: [{ accepted: [{ address: admin.toUpperCase() }] }, { accepted: [body.email] }] });
  const response = await f.submit();
  assert.equal(response.status, 200);
  assert.equal(response.result.success, true);
  assert.equal(response.result.acknowledgementSent, true);
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[0].replyTo, body.email);
  assert.equal(f.sent[0].to, admin);
  assert.equal(f.sent[1].to, body.email);
  assert.equal(f.settings[0].socketTimeout, 15000);
});

test('acknowledgement rejection or exception does not fail an accepted primary enquiry', async () => {
  for (const acknowledgement of [new Error('PRIVATE_RECIPIENT_ERROR'), { accepted: [], rejected: [body.email] }, { messageId: 'not-proof' }]) {
    const f = fixture({ outcomes: [{ accepted: [admin] }, acknowledgement] });
    const response = await f.submit();
    assert.equal(response.status, 200);
    assert.equal(response.result.success, true);
    assert.equal(response.result.acknowledgementSent, false);
    assert.equal(f.sent.length, 2);
    assert.ok(!JSON.stringify(f.logs).includes('PRIVATE_RECIPIENT_ERROR'));
  }
});

test('HTML content is escaped and acknowledgement does not repeat the inquiry', async () => {
  const f = fixture();
  const input = { ...body, name: '<img src=x> O\'Neil & Co', subject: '<script>Example</script>', message: 'PRIVATE_INQUIRY <img src=x onerror="attack()">\nSecond line & more.' };
  const response = await f.submit(input);
  assert.equal(response.status, 200);
  assert.ok(f.sent[0].html.includes('&lt;img src=x&gt; O&#39;Neil &amp; Co'));
  assert.ok(f.sent[0].html.includes('&lt;script&gt;Example&lt;/script&gt;'));
  assert.ok(f.sent[0].html.includes('&quot;attack()&quot;'));
  assert.ok(f.sent[0].text.includes(input.message));
  for (const mail of f.sent) {
    assert.ok(!mail.html.includes('<img'));
    assert.ok(!mail.html.includes('<script>'));
  }
  assert.ok(!JSON.stringify(f.sent[1]).includes('PRIVATE_INQUIRY'));
  assert.ok(!JSON.stringify(f.logs).includes(input.email));
  assert.ok(!JSON.stringify(f.logs).includes('PRIVATE_INQUIRY'));
  assert.ok(!JSON.stringify(f.logs).includes(input.subject));
});

test('configuration and SMTP exceptions never expose secrets or recipient details', async () => {
  for (const settings of [{ creationError: true }, { outcomes: [new Error('PRIVATE_SMTP_CREDENTIAL partner@example.invalid PRIVATE_INQUIRY')] }]) {
    const f = fixture(settings);
    const response = await f.submit();
    assert.equal(response.status, 503);
    assert.ok(!JSON.stringify([response, f.logs]).includes('PRIVATE_SMTP_CREDENTIAL'));
    assert.ok(!JSON.stringify([response, f.logs]).includes(body.email));
    assert.ok(!JSON.stringify([response, f.logs]).includes('PRIVATE_INQUIRY'));
  }
});

test('invalid input and header injection are rejected without sending or logging input', async () => {
  for (const patch of [{ email: 'not-an-email' }, { name: ' ' }, { subject: 'Short' + '\r\nBcc: secret@example.invalid' }, { email: 'partner@example.invalid\r\nBcc: other@example.invalid' }, { message: 'short' }, { message: 'a'.repeat(5001) }, { type: 'PRIVATE_UNKNOWN_TYPE' }]) {
    const f = fixture();
    const response = await f.submit({ ...body, ...patch });
    assert.equal(response.status, 400);
    assert.equal(response.result.code, 'CONTACT_INVALID');
    assert.equal(f.sent.length, 0);
    assert.equal(f.logs.length, 0);
    assert.ok(!JSON.stringify(response).includes('PRIVATE_UNKNOWN_TYPE'));
  }
});
