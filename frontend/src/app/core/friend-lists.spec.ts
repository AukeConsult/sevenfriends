import { DeviceList, deviceListHash } from '../models';
import { chainHolds } from './friend-lists.service';
import { firstDeviceList, listSignatureHolds } from './device-list';
import { generateIdentityKey } from './device-key';

/** These run in Chrome (karma) with the real Web Crypto: the first device list, its signature, and the chain check. */
describe('the signed device list', () => {
  let originalTimeout: number;
  beforeAll(() => {
    originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 60_000; // a 3072 bit key takes a few seconds
  });
  afterAll(() => (jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout));

  it('version 1 is signed by its own device, with a date, and the chain holds', async () => {
    const key = await generateIdentityKey();
    const v1 = (await firstDeviceList(key, 'Test device'))!;
    expect(v1.version).toBe(1);
    expect(v1.since).toBeTruthy();
    expect(await listSignatureHolds(v1, v1.devices)).toBeTrue();
    expect(await chainHolds([v1])).toBeTrue();
  });

  it('breaks when the signed text, the signature or the link to the version before is changed', async () => {
    const key = await generateIdentityKey();
    const v1 = (await firstDeviceList(key, 'Test device'))!;
    expect(await chainHolds([{ ...v1, devices: [{ ...v1.devices[0], label: 'Other' }] }])).toBeFalse();
    expect(await chainHolds([{ ...v1, since: '2020-01-01T00:00:00.000Z' }])).toBeFalse();
    expect(await chainHolds([{ ...v1, version: 2 }])).toBeFalse(); // a chain starts at version 1
    const v2: DeviceList = { ...v1, version: 2, prev: await deviceListHash(v1) }; // not signed again: the signature is the one of version 1
    delete (v2 as { since?: string }).since;
    expect(await chainHolds([v1, v2])).toBeFalse();
  });
});
