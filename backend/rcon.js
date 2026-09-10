const Rcon = require('rcon');

module.exports = class RconConnection {
  executeCommand(command) {
    return new Promise((resolve, reject) => {
      const connection = new Rcon(process.env.CS2_RCON_HOST || '10.156.0.11', 27015, process.env.RCON_PASSWORD);
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        connection.disconnect();
        error ? reject(error) : resolve(result);
      };
      const timer = setTimeout(() => finish(new Error('Game server RCON timed out')), 8000);
      connection.on('auth', () => connection.send(command));
      connection.on('response', response => finish(null, response));
      connection.on('error', () => finish(new Error('Game server RCON failed')));
      connection.on('end', () => { if (!settled) finish(new Error('Game server closed RCON without a response')); });
      connection.connect();
    });
  }

  async status() {
    const response = await this.executeCommand('csbatagi_status');
    const start = response.indexOf('{');
    const end = response.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error('Game server did not return its status');
    return JSON.parse(response.slice(start, end + 1));
  }

  async startMatch(id) {
    await this.executeCommand(`matchzy_loadmatch_url "https://csbatagi.com/backend/get-match/${id}"`);
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      try {
        const status = await this.status();
        if (status.matchLoaded && status.matchId === id) return status;
      } catch { /* A map change can temporarily interrupt RCON. */ }
    }
    throw new Error('Match saved, but the game server did not acknowledge loading it');
  }
};
