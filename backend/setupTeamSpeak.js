const fs = require('node:fs');
const { connectQuery } = require('./teamSpeakQuery');
const { configFromEnv, GROUP_NAME, GUEST_LIMITS, unsafePermissions, verifyConfiguration } = require('./teamSpeak');

async function setup(config, apply = false, openQuery = connectQuery) {
  const query = await openQuery(config);
  try {
    const server = (await query.command('serverinfo'))[0];
    const groups = await query.command('servergrouplist');
    const guest = groups.find(group => group.sgid === server.virtualserver_default_server_group);
    if (!guest || guest.name !== 'Guest' || guest.type !== '1') throw new Error('Default Guest group must be reviewed');
    const channels = await query.command('channellist');
    const existing = groups.find(group => group.name === GROUP_NAME && group.type === '1');
    if (!apply) return { apply: false, memberGroupExists: !!existing, changes: ['restricted silent verification lobby', 'Steam member voice group', 'private limited query account'] };
    const permissions = await query.command('permissionlist');
    const supported = new Set(permissions.map(p => p.permname));
    const permissionIds = new Map(permissions.map(p => [p.permname, p.permid]));
    const addPermission = async (sgid, permsid, value, negated = 0, skip = 0) => {
      if (!supported.has(permsid)) throw new Error('Required permission unavailable');
      await query.command('servergroupaddperm', { sgid, permid: permissionIds.get(permsid), permvalue: value, permnegated: negated, permskip: skip });
    };
    const groupId = existing?.sgid || (await query.command('servergroupcopy', {
      ssgid: guest.sgid, tsgid: 0, name: GROUP_NAME, type: 1,
    }))[0]?.sgid;
    if (!groupId) throw new Error('Member group creation failed');
    for (const permission of await query.command('servergrouppermlist', { sgid: groupId }, '-permsid')) {
      if (unsafePermissions([permission])) await addPermission(groupId, permission.permsid, 0);
    }
    for (const [name, value] of Object.entries({
      b_group_is_permanent: 1, i_channel_join_power: 50, i_client_talk_power: 50, i_channel_subscribe_power: 50,
      i_client_private_textmessage_power: 0, i_ft_file_upload_power: 0, i_ft_file_download_power: 0,
      b_client_server_textmessage_send: 1, b_client_channel_textmessage_send: 1,
      i_group_needed_member_add_power: 50, i_group_needed_member_remove_power: 50,
      i_client_needed_kick_from_server_power: 50, i_client_needed_move_power: 50,
      b_client_use_reserved_slot: 1,
    })) await addPermission(groupId, name, value);
    const channel = async name => channels.find(row => row.channel_name === name)?.cid ||
      (await query.command('channelcreate', { channel_name: name, channel_flag_permanent: 1, channel_codec: 4, channel_codec_quality: 5 }))[0]?.cid;
    const lobbyId = await channel('Steam Doğrulama');
    const memberChannelId = await channel('Kulüp');
    if (!lobbyId || !memberChannelId) throw new Error('Channel setup failed');
    await query.command('channeladdperm', { cid: lobbyId, permid: permissionIds.get('i_channel_needed_join_power'), permvalue: -1 });
    await query.command('channeladdperm', { cid: lobbyId, permid: permissionIds.get('i_client_needed_talk_power'), permvalue: 0 });
    await query.command('channeladdperm', { cid: lobbyId, permid: permissionIds.get('i_channel_needed_subscribe_power'), permvalue: -1 });
    await query.command('channeledit', { cid: lobbyId, channel_flag_default: 1, channel_description: 'csbatagi.com/teamspeak sayfasından Steam ile doğrula. Doğrulanmadan sesli odalara erişilemez.' });
    for (const row of await query.command('channellist')) {
      if (row.cid !== lobbyId) {
        const permissions = await query.command('channelpermlist', { cid: row.cid }, '-permsid');
        const current = Number(permissions.find(p => p.permsid === 'i_channel_needed_join_power')?.permvalue || 0);
        // Preserve stronger existing restrictions, including administrator rooms.
        if (current < 50) await query.command('channeladdperm', { cid: row.cid, permid: permissionIds.get('i_channel_needed_join_power'), permvalue: 50 });
      }
    }
    for (const permission of await query.command('servergrouppermlist', { sgid: guest.sgid }, '-permsid')) {
      if (unsafePermissions([permission])) await addPermission(guest.sgid, permission.permsid, 0, 1, 1);
    }
    for (const [name, value] of Object.entries(GUEST_LIMITS)) await addPermission(guest.sgid, name, value, 1, 1);
    await query.command('serveredit', { virtualserver_name: 'CS Batağı', virtualserver_password: '', virtualserver_weblist_enabled: 0,
      virtualserver_reserved_slots: Math.min(10, Math.max(0, Number(server.virtualserver_maxclients || 32) - 10)) });
    // Global query login is isolated from serveradmin and receives only the
    // permissions needed for verification, member assignment and revocation.
    const globalGroups = await query.command('servergrouplist');
    const queryName = 'CS Batagi Website Query';
    const queryGroup = globalGroups.find(group => group.name === queryName && group.type === '2')?.sgid ||
      (await query.command('servergroupadd', { name: queryName, type: 2 }))[0]?.sgid;
    const needed = {
      b_group_is_permanent: 1, b_virtualserver_select: 1, b_virtualserver_info_view: 1, b_permission_list: 1, b_client_ignore_antiflood: 1,
      b_virtualserver_client_list: 1, b_virtualserver_channel_list: 1, b_virtualserver_channel_search: 1,
      b_virtualserver_servergroup_list: 1, b_virtualserver_servergroup_client_list: 1,
      b_virtualserver_servergroup_permission_list: 1, b_virtualserver_channel_permission_list: 1,
      b_virtualserver_client_dbinfo: 1, b_virtualserver_client_dbsearch: 1, b_virtualserver_client_search: 1,
      b_client_info_view: 1, b_client_custom_info_view: 1, b_virtualserver_custom_search: 1, b_client_modify_description: 1,
      i_client_private_textmessage_power: 50, i_client_move_power: 50, i_client_kick_from_server_power: 50,
      i_client_modify_power: 50, i_client_info_view_power: 50, i_channel_join_power: 50,
      i_group_member_add_power: 50, i_group_member_remove_power: 50,
    };
    for (const permission of await query.command('servergrouppermlist', { sgid: queryGroup }, '-permsid')) {
      if (!(permission.permsid in needed)) await addPermission(queryGroup, permission.permsid, 0);
    }
    for (const [name, value] of Object.entries(needed)) if (supported.has(name)) await addPermission(queryGroup, name, value);
    const loginName = 'csbatagi_website';
    // Group commands require a selected virtual server, even for type-2 groups.
    // Only login creation/deletion selects the global client namespace.
    await query.command('use', { sid: 0 });
    for (const login of await query.command('queryloginlist', { pattern: loginName })) {
      if (login.client_login_name === loginName) await query.command('querylogindel', { cldbid: login.cldbid });
    }
    const login = (await query.command('queryloginadd', { client_login_name: loginName }))[0];
    if (!login?.client_login_password || !login.cldbid) throw new Error('Private query account creation failed');
    await query.command('use', { sid: 1 });
    await query.command('servergroupaddclient', { sgid: queryGroup, cldbid: login.cldbid });
    const result = { ...config, groupId, lobbyId, memberChannelId, queryUser: loginName, queryPassword: login.client_login_password };
    const privateQuery = await openQuery(result);
    try {
      await verifyConfiguration(privateQuery, result);
      await privateQuery.command('customsearch', { ident: 'csbatagi_steam_id', pattern: '%' });
      await privateQuery.command('clientlist', {}, '-uid -groups');
      const mustDeny = async (name, params = {}) => {
        try { await privateQuery.command(name, params); }
        catch (error) { if (error.code === '2568') return; throw error; }
        throw new Error('Website query account has administrative access');
      };
      await mustDeny('serveredit', { virtualserver_name: 'CS Batağı' });
      await mustDeny('servergroupaddperm', { sgid: groupId, permid: permissionIds.get('i_client_talk_power'), permvalue: 50, permnegated: 0, permskip: 0 });
      await mustDeny('tokenlist');
    } finally { privateQuery.close(); }
    return { groupId, lobbyId, memberChannelId, queryUser: result.queryUser, queryPassword: result.queryPassword, queryGroup };
  } finally { query.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  const output = args.find(arg => arg.startsWith('--output-private='))?.slice('--output-private='.length);
  if (args.some(arg => !['--apply', '--config-stdin'].includes(arg) && !arg.startsWith('--output-private='))) throw new Error('Invalid setup options');
  if (args.includes('--apply') && (!output || !require('node:path').isAbsolute(output))) throw new Error('Apply requires an absolute private output path');
  require('dotenv').config({ quiet: true });
  const config = args.includes('--config-stdin') ? JSON.parse(fs.readFileSync(0, 'utf8')) : configFromEnv();
  if (!config.queryUser || !config.queryPassword) throw new Error('Private bootstrap credentials required');
  const result = await setup(config, args.includes('--apply'));
  if (args.includes('--apply')) {
    fs.writeFileSync(output, JSON.stringify(result), { mode: 0o600, flag: 'wx' });
    const { queryPassword, queryUser, ...publicResult } = result;
    process.stdout.write(JSON.stringify({ ...publicResult, privateCredentialsWritten: true }));
  } else process.stdout.write(JSON.stringify(result));
}
if (require.main === module) main().catch(error => {
  process.stderr.write(JSON.stringify({ setupFailed: true, queryCode: error.code || null, failedPermission: error.failedPermission || null, command: /^[a-z]+$/.test(error.commandName || '') ? error.commandName : null }));
  process.exitCode = 1;
});
module.exports = { setup };
