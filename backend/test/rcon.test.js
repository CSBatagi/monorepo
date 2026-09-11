const RconConnection = require('../rcon');

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

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
