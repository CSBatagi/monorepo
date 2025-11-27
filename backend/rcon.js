const Rcon = require('rcon');

module.exports = class RconConnection {

  constructor() {
    this.matchCommand = 'exec load_match.cfg';
    this.pluginsCommand = 'exec load_all.cfg';
    this.conn = null;  // Will be initialized when needed
    this.isConnected = false;  // Track connection state

  }

  async startMatch() {
    if (this.isConnected) {
      console.log('Already connected to RCON server.');
      return;
    }
    await this.executeCommand(this.matchCommand);
  }

  async loadAllPlugins() {
    if (this.isConnected) {
      console.log('Already connected to RCON server.');
      return;
    }
    await this.executeCommand(this.pluginsCommand);
  }

  async executeCommand(command) {
    this.conn = Rcon('cs2.csbatagi.com', 27015, process.env.RCON_PASSWORD);
    this.conn.on('auth', () => {
      console.log('Authenticated to RCON server.');
      this.isConnected = true;
      this.conn.send(command);
    });

    this.conn.on('response', (str) => {
      console.log('Server response:', str);
      this.conn.disconnect();  // Close the connection after receiving a response
    });

    this.conn.on('end', () => {
      console.log('Connection to RCON server closed.');
      this.isConnected = false;  // Reset the connection status
    });

    this.conn.on('error', (err) => {
      console.error('Error:', err);
    });

    this.conn.connect();  // Establish connection
  }

}
