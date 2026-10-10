// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { ObsAuthError, ObsRequestError } from '../../src/obs/client';
import { compareVersions } from '../../src/obs/version';
import { FakeObsClient } from '../support/fake-obs';

describe('compareVersions', () => {
  it('compares dotted versions numerically', () => {
    expect(compareVersions('1.4.0', '1.4.0')).toBe(0);
    expect(compareVersions('1.10.0', '1.4.0')).toBeGreaterThan(0);
    expect(compareVersions('1.3.9', '1.4.0')).toBeLessThan(0);
    expect(compareVersions('1.4', '1.4.0')).toBe(0);
    expect(compareVersions('2', '1.9.9')).toBeGreaterThan(0);
  });
});

describe('FakeObsClient', () => {
  it('connects, answers configured requests and emits events', async () => {
    const obs = new FakeObsClient();
    obs.respond('GetVersion', () => ({ obsVersion: '31.0.0' }));
    expect(await obs.connect('ws://127.0.0.1:4455', 'pw')).toEqual({ obsWebSocketVersion: '5.5.0', negotiatedRpcVersion: 1 });
    expect(obs.connected).toBe(true);
    expect(await obs.call('GetVersion')).toEqual({ obsVersion: '31.0.0' });
    expect(obs.calls).toEqual([{ type: 'GetVersion', data: undefined }]);
    const seen: unknown[] = [];
    const fn = (d: unknown) => seen.push(d);
    obs.on('CurrentProgramSceneChanged', fn);
    obs.emit('CurrentProgramSceneChanged', { sceneName: 'CAM 1' });
    obs.off('CurrentProgramSceneChanged', fn);
    obs.emit('CurrentProgramSceneChanged', { sceneName: 'CAM 2' });
    expect(seen).toEqual([{ sceneName: 'CAM 1' }]);
  });

  it('fails unknown requests with ObsRequestError and can refuse auth', async () => {
    const obs = new FakeObsClient();
    await obs.connect('ws://x', undefined);
    await expect(obs.call('Nope')).rejects.toBeInstanceOf(ObsRequestError);
    const locked = new FakeObsClient();
    locked.connectError = new ObsAuthError('Authentication failed');
    await expect(locked.connect('ws://x', 'bad')).rejects.toBeInstanceOf(ObsAuthError);
    expect(locked.connected).toBe(false);
  });

  it('disconnect emits ConnectionClosed once', async () => {
    const obs = new FakeObsClient();
    await obs.connect('ws://x', undefined);
    let closed = 0;
    obs.on('ConnectionClosed', () => closed++);
    await obs.disconnect();
    await obs.disconnect();
    expect(closed).toBe(1);
  });
});
