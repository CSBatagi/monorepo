const GcpManager = require('../gcp');

function instance(status = 'RUNNING', publicIp = '203.0.113.8', privateIp = '10.0.0.8') {
  return { status, networkInterfaces: [{ networkIP: privateIp,
    accessConfigs: [{ type: 'ONE_TO_ONE_NAT', networkTier: 'PREMIUM', natIP: publicIp }] }] };
}

let gcp;
beforeEach(() => {
  jest.useFakeTimers();
  // Exercise real lookup/cache logic without reading credentials or contacting Google.
  gcp = Object.assign(Object.create(GcpManager.prototype), {
    vmName: 'cs2-server', zone: 'europe-west3-c', projectId: 'test-project',
    compute: { get: jest.fn().mockResolvedValue([instance()]) },
  });
});
afterEach(() => jest.useRealTimers());

test('discovers Premium ephemeral NAT and private addresses from the configured VM', async () => {
  await expect(gcp.getConnectionInfo()).resolves.toEqual({ status: 'RUNNING', privateHost: '10.0.0.8', address: '203.0.113.8:27015' });
  expect(gcp.compute.get).toHaveBeenCalledWith(
    { project: 'test-project', zone: 'europe-west3-c', instance: 'cs2-server' },
    { timeout: 4000, retry: null }
  );
});

test('shares concurrent lookups, caches briefly and discovers changed IPs after expiry', async () => {
  const values = await Promise.all([gcp.getConnectionInfo(), gcp.getConnectionInfo(), gcp.getConnectionInfo()]);
  expect(values[0]).toEqual(values[2]);
  await gcp.getConnectionInfo();
  expect(gcp.compute.get).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(10001);
  gcp.compute.get.mockResolvedValue([instance('RUNNING', '203.0.113.9', '10.0.0.9')]);
  await expect(gcp.getConnectionInfo()).resolves.toMatchObject({ address: '203.0.113.9:27015', privateHost: '10.0.0.9' });
  expect(gcp.compute.get).toHaveBeenCalledTimes(2);
});

test.each(['TERMINATED', 'STOPPING', 'STAGING'])('never advertises a retained address while %s', async status => {
  gcp.compute.get.mockResolvedValue([instance(status)]);
  await expect(gcp.getConnectionInfo()).resolves.toEqual({ status, privateHost: null, address: null });
});

test('does not invent a public address when NAT is missing', async () => {
  const noNat = instance(); delete noNat.networkInterfaces[0].accessConfigs[0].natIP;
  gcp.compute.get.mockResolvedValue([noNat]);
  await expect(gcp.getConnectionInfo()).resolves.toMatchObject({ address: null, privateHost: '10.0.0.8' });
});

test('cloud outages never reuse an expired IP and do not poison subsequent discovery', async () => {
  await gcp.getConnectionInfo();
  jest.advanceTimersByTime(10001);
  gcp.compute.get.mockRejectedValueOnce(new Error('cloud unavailable'));
  await expect(gcp.getConnectionInfo()).rejects.toThrow('cloud unavailable');
  gcp.compute.get.mockResolvedValue([instance('RUNNING', '203.0.113.9')]);
  await expect(gcp.getConnectionInfo()).resolves.toMatchObject({ address: '203.0.113.9:27015' });
});

test('power invalidation prevents an old in-flight lookup from caching its result', async () => {
  let complete;
  gcp.compute.get.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const old = gcp.getConnectionInfo();
  gcp.invalidateConnectionInfo();
  gcp.compute.get.mockResolvedValue([instance('RUNNING', '203.0.113.9')]);
  await gcp.getConnectionInfo();
  complete([instance()]);
  await old;
  await expect(gcp.getConnectionInfo()).resolves.toMatchObject({ address: '203.0.113.9:27015' });
});

test('refuses discovery for any VM other than the game server', async () => {
  gcp.vmName = 'backend-1';
  await expect(gcp.getConnectionInfo()).rejects.toThrow('Refusing');
  expect(gcp.compute.get).not.toHaveBeenCalled();
});
