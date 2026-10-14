const net = require('node:net');
const { escapeQuery, unescapeQuery, parseRows, connectQuery } = require('../teamSpeakQuery');

test('query parameters escape separators, backslashes and newlines losslessly', () => {
  const value = 'hello world|token=x\\s/\n\r\t\v\f';
  expect(unescapeQuery(escapeQuery(value))).toBe(value);
  expect(escapeQuery(value)).not.toMatch(/[ |\n\r]/);
  expect(parseRows('token=abc\\/def+\\svalue=xyz|name=hello\\sworld')).toEqual([{ token: 'abc/def+ value=xyz' }, { name: 'hello world' }]);
});

async function fakeServer(handler) {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.write('TS3\n\rWelcome to the TeamSpeak 3 ServerQuery interface.\n\r');
    let buffer = '';
    socket.on('data', data => {
      buffer += data.toString();
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        handler(socket, line);
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { config: { queryHost: '127.0.0.1', queryPort: server.address().port, queryUser: 'test', queryPassword: 'pass', serverId: 1 },
    close: async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); } };
}
test('real TCP framing supports fragmented LFCR responses and command errors', async () => {
  const server = await fakeServer((socket, line) => {
    if (line.startsWith('login ') || line.startsWith('use ')) socket.write('error id=0 msg=ok\n\r');
    else if (line === 'tokenlist') { socket.write('token=a\\/b token_type=0|token=c'); setImmediate(() => socket.write(' token_type=0\n\rerror id=0 msg=ok\n\r')); }
    else if (line === 'customsearch') socket.write('error id=1281 msg=database\\sempty\\sresult\\sset\n\r');
    else socket.write('error id=2568 msg=insufficient\\sclient\\spermissions\n\r');
  });
  let query;
  try {
    query = await connectQuery(server.config);
    expect(await query.command('tokenlist')).toEqual([{ token: 'a/b', token_type: '0' }, { token: 'c', token_type: '0' }]);
    expect(await query.command('customsearch')).toEqual([]);
    await expect(query.command('serveredit')).rejects.toMatchObject({ code: '2568' });
  } finally { query?.close(); await server.close(); }
});
test('query parameters cannot inject extra protocol commands', async () => {
  const received = [];
  const server = await fakeServer((socket, line) => { received.push(line); socket.write('error id=0 msg=ok\n\r'); });
  let query;
  try {
    query = await connectQuery({ ...server.config, queryPassword: 'pass\nserverdelete sid=1' });
    await query.command('tokenadd', { tokencustomset: 'ident=steam value=123|ident=device value=456' });
    expect(received).toHaveLength(3);
    expect(received[0]).toContain('pass\\nserverdelete\\ssid=1');
    expect(received[2]).toContain('123\\pident=device\\svalue=456');
  } finally { query?.close(); await server.close(); }
});
test('disconnected queries reject rather than leaving the caller waiting', async () => {
  const server = await fakeServer(socket => socket.destroy());
  try { await expect(connectQuery(server.config)).rejects.toThrow('unavailable'); }
  finally { await server.close(); }
});
