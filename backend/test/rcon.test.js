const RconConnection = require('../rcon');
const Rcon = require('rcon');
const { EventEmitter } = require('events');
jest.mock('rcon');

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('private address discovery', () => {
  const originalHost = process.env.CS2_RCON_HOST;
  beforeEach(() => {
    delete process.env.CS2_RCON_HOST;
    Rcon.mockClear();
    Rcon.mockImplementation(() => Object.assign(new EventEmitter(), {
      connect: jest.fn(), disconnect: jest.fn(), send: jest.fn(),
    }));
  });
  afterEach(() => {
    if (originalHost === undefined) delete process.env.CS2_RCON_HOST;
    else process.env.CS2_RCON_HOST = originalHost;
  });
  test('resolves the private host for every command, including after an address change', async () => {
    const resolveHost = jest.fn().mockResolvedValueOnce('10.0.0.8').mockResolvedValueOnce('10.0.0.9');
    const rcon = new RconConnection(resolveHost);
    for (const host of ['10.0.0.8', '10.0.0.9']) {
      const pending = rcon.executeCommand('csbatagi_status');
      await Promise.resolve();
      const connection = Rcon.mock.results.at(-1).value;
      expect(Rcon).toHaveBeenLastCalledWith(host, 27015, process.env.RCON_PASSWORD);
      connection.emit('auth');
      expect(connection.send).toHaveBeenCalledWith('csbatagi_status');
      connection.emit('response', '{}');
      await expect(pending).resolves.toBe('{}');
    }
    expect(resolveHost).toHaveBeenCalledTimes(2);
  });
  test('never opens a connection if discovery is unavailable', async () => {
    await expect(new RconConnection(async () => null).executeCommand('status')).rejects.toThrow('private address');
    await expect(new RconConnection(async () => { throw new Error('discovery failed'); }).executeCommand('status')).rejects.toThrow('discovery failed');
    expect(Rcon).not.toHaveBeenCalled();
  });
  test('supports an explicit private host override for local development', async () => {
    process.env.CS2_RCON_HOST = 'localhost';
    const resolveHost = jest.fn();
    const pending = new RconConnection(resolveHost).executeCommand('status');
    Rcon.mock.results.at(-1).value.emit('response', '{}');
    await pending;
    expect(Rcon).toHaveBeenLastCalledWith('localhost', 27015, process.env.RCON_PASSWORD);
    expect(resolveHost).not.toHaveBeenCalled();
  });
});

test('waits for the new match ID through a map-change disconnect', async () => {
  const rcon = new RconConnection();
  jest.spyOn(rcon, 'executeCommand').mockResolvedValue('');
  jest.spyOn(rcon, 'status')
    .mockResolvedValueOnce({ matchLoaded: true, matchId: 123 })
    .mockRejectedValueOnce(new Error('RCON reconnecting'))
    .mockResolvedValueOnce({ matchLoaded: true, matchId: 456 });
  const pending = rcon.startMatch(456);
  const expectation = expect(pending).resolves.toEqual({ matchLoaded: true, matchId: 456 });
  await jest.advanceTimersByTimeAsync(4500);
  await expectation;
  expect(rcon.status).toHaveBeenCalledTimes(3);
});

test('reports an explicit plugin load rejection immediately', async () => {
  const rcon = new RconConnection();
  jest.spyOn(rcon, 'executeCommand').mockResolvedValue('CSBATAGI_LOAD_ERROR: Invalid match configuration');
  jest.spyOn(rcon, 'status');
  await expect(rcon.startMatch(456)).rejects.toThrow('Invalid match configuration');
  expect(rcon.status).not.toHaveBeenCalled();
});

test('does not acknowledge a previous match as a successful replacement', async () => {
  const rcon = new RconConnection();
  jest.spyOn(rcon, 'executeCommand').mockResolvedValue('');
  jest.spyOn(rcon, 'status').mockResolvedValue({ matchLoaded: true, matchId: 123 });
  const pending = rcon.startMatch(456);
  const expectation = expect(pending).rejects.toThrow('did not acknowledge');
  await jest.advanceTimersByTimeAsync(45000);
  await expectation;
});
