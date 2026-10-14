const net = require('node:net');

const escaped = { '\\': '\\\\', '/': '\\/', ' ': '\\s', '|': '\\p', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\v': '\\v', '\f': '\\f' };
const unescaped = Object.fromEntries(Object.entries(escaped).map(([key, value]) => [value.slice(1), key]));
function escapeQuery(value) { return String(value).replace(/[\\/ |\n\r\t\v\f]/g, char => escaped[char]); }
function unescapeQuery(value) { return value.replace(/\\([\\/spnrtvf])/g, (_, char) => unescaped[char]); }
function parseRows(value) {
  return value ? value.split('|').filter(Boolean).map(row => Object.fromEntries(row.split(' ').filter(Boolean).map(field => {
    const index = field.indexOf('=');
    return [field.slice(0, index), unescapeQuery(field.slice(index + 1))];
  }))) : [];
}

// A bounded, short-lived private-network connection. Never log commands or replies:
// both may contain query credentials or member privilege keys.
async function connectQuery(config) {
  const socket = net.createConnection({ host: config.queryHost, port: config.queryPort });
  socket.setEncoding('utf8');
  let buffer = '', pending = null, failure = null;
  const fail = () => {
    failure = new Error('TeamSpeak query unavailable');
    const job = pending; pending = null;
    job?.reject(failure);
    socket.destroy();
  };
  const deadline = setTimeout(fail, 15000);
  deadline.unref();
  socket.on('error', fail);
  socket.on('close', () => { clearTimeout(deadline); fail(); });
  socket.on('data', chunk => {
    buffer += chunk;
    if (buffer.length > 1024 * 1024) return fail();
    let index;
    // TeamSpeak sends LFCR; normalize both that and CRLF without splitting escapes.
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).replace(/\r/g, '');
      buffer = buffer.slice(index + 1).replace(/^\r/, '');
      if (!pending || !line || line === 'TS3' || line.startsWith('Welcome') || line.startsWith('notify')) continue;
      if (line.startsWith('error ')) {
        const job = pending; pending = null;
        const status = parseRows(line.slice(6))[0];
        if (status.id === '0' || status.id === '1281') job.resolve(parseRows(job.lines.join('|'))); // empty result set
        else { const error = new Error('TeamSpeak query command failed'); error.code = status.id; error.failedPermission = /^\d+$/.test(status.failed_permid || '') ? status.failed_permid : null; error.commandName = job.name; job.reject(error); }
      } else {
        pending.bytes += line.length;
        if (pending.bytes > 1024 * 1024) return fail();
        pending.lines.push(line);
      }
    }
  });
  const command = (name, params = {}, flags = '') => new Promise((resolve, reject) => {
    if (failure || pending || socket.destroyed) return reject(failure || new Error('Query busy'));
    pending = { resolve, reject, lines: [], bytes: 0, name };
    socket.write(`${name}${Object.entries(params).map(([key, value]) => ` ${key}=${escapeQuery(value)}`).join('')}${flags ? ` ${flags}` : ''}\n`);
  });
  try {
    await command('login', { client_login_name: config.queryUser, client_login_password: config.queryPassword });
    await command('use', { sid: config.serverId });
    return { command, close: () => { clearTimeout(deadline); socket.destroy(); } };
  } catch (error) { clearTimeout(deadline); socket.destroy(); throw error; }
}

module.exports = { escapeQuery, unescapeQuery, parseRows, connectQuery };
