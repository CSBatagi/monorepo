const { setup } = require('../setupTeamSpeak');

test('setup defaults to a read-only summary and never returns a credential', async () => {
  const query = { close: jest.fn(), command: jest.fn(async name => ({
    serverinfo: [{ virtualserver_default_server_group: '8' }],
    servergrouplist: [{ sgid: '8', name: 'Guest', type: '1' }],
    channellist: [],
  }[name] || [])) };
  const result = await setup({ queryPassword: 'private-fixture' }, false, async () => query);
  expect(result.apply).toBe(false);
  expect(JSON.stringify(result)).not.toContain('private-fixture');
  expect(query.command.mock.calls.map(([name]) => name)).toEqual(['serverinfo', 'servergrouplist', 'channellist']);
  expect(query.close).toHaveBeenCalled();
});

test('an unexpected default group is rejected before a permission or password change', async () => {
  const query = { close: jest.fn(), command: jest.fn(async name => ({
    serverinfo: [{ virtualserver_default_server_group: '6' }],
    servergrouplist: [{ sgid: '6', name: 'Server Admin', type: '1' }],
  }[name] || [])) };
  await expect(setup({}, true, async () => query)).rejects.toThrow();
  expect(query.command.mock.calls.map(([name]) => name)).toEqual(['serverinfo', 'servergrouplist']);
  expect(query.close).toHaveBeenCalled();
});
