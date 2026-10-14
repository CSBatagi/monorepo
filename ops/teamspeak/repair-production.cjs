// Narrow native permission repair; credentials arrive on stdin, never argv/logs.
// A unique non-authorizing metadata probe is removed; no member role is granted.
const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { connectQuery } = require('/app/teamSpeakQuery');
const { configFromEnv, verifyConfiguration } = require('/app/teamSpeak');
let phase = 'private configuration';
const report = value => console.log(JSON.stringify(value));
async function main() {
  const config = configFromEnv();
  assert.notEqual(config.queryUser, 'serveradmin');
  const { adminPassword } = JSON.parse(fs.readFileSync(0, 'utf8'));
  phase = 'private bootstrap login';
  const admin = await connectQuery({ ...config, queryUser: 'serveradmin', queryPassword: adminPassword });
  let query;
  try {
    phase = 'query group lookup';
    const group = (await admin.command('servergrouplist')).find(row => row.name === 'CS Batagi Website Query' && row.type === '2');
    assert.ok(group);
    phase = 'identity write permission lookup';
    const permission = (await admin.command('permissionlist')).find(row => row.permname === 'b_client_modify_dbproperties');
    assert.ok(permission);
    await admin.command('servergroupaddperm', { sgid: group.sgid, permid: permission.permid, permvalue: 1, permnegated: 0, permskip: 0 });
    report({ identity_write_permission_repaired: true, credential_rotated: false });
    query = await connectQuery(config);
    await verifyConfiguration(query, config);
    phase = 'administrative denial checks';
    const server = (await query.command('serverinfo'))[0];
    for (const [name, params] of [['serveredit', { virtualserver_name: server.virtualserver_name }],
      ['servergroupaddperm', { sgid: config.groupId, permsid: 'i_client_talk_power', permvalue: 50, permnegated: 0, permskip: 0 }], ['tokenlist', {}]]) {
      await assert.rejects(() => query.command(name, params), error => error.code === '2568');
    }
    report({ administrative_denial_checks_passed: 3 });
    phase = 'native metadata write/readback';
    let native = (await query.command('clientlist', {}, '-uid -groups')).find(row => row.client_type === '0');
    if (!native) {
      // Offline native identities can also exercise the exact persistence path.
      // IDs/custom fields stay on the host; only a unique inert field is touched.
      const saved = (await admin.command('clientdblist', { start: 0, limit: 100 })).find(row => /^[A-Za-z0-9+/]{27}=$/.test(row.client_unique_identifier || ''));
      if (saved) native = { client_database_id: saved.cldbid };
    }
    if (native) {
      const ident = 'csbatagi_probe_' + crypto.randomUUID().replaceAll('-', '');
      const value = crypto.randomUUID();
      try {
        await query.command('customset', { cldbid: native.client_database_id, ident, value });
        const found = await query.command('custominfo', { cldbid: native.client_database_id });
        assert.ok(found.some(row => row.ident === ident && row.value === value));
        report({ native_identity_write_readback_passed: true, member_group_assigned: false });
      } finally {
        await admin.command('customdelete', { cldbid: native.client_database_id, ident });
        assert.ok(!(await admin.command('custominfo', { cldbid: native.client_database_id })).some(row => row.ident === ident));
        report({ temporary_probe_removed: true });
      }
    } else report({ native_identity_write_readback_passed: null, reason: 'no connected native client' });
  } finally { query?.close(); admin.close(); }
}
main().catch(error => {
  report({ repair_failed: true, phase, error_type: error.name, query_code: /^\d+$/.test(error.code || '') ? error.code : null,
    permission_id: error.failedPermission || null, command: /^[a-z]+$/.test(error.commandName || '') ? error.commandName : null, credentials_logged: false });
  process.exitCode = 1;
});
