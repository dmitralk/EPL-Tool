import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_PUBLISH_SECONDS, CHANGE_CHECK_SECONDS, compareVersions, describeSeconds, installerVersion } from './sync';

describe('installerVersion', () => {
  it('reads the version from the built and the GitHub setup names', () => {
    assert.equal(installerVersion('EPL Tool-0.8.1 Setup.exe'), '0.8.1');
    assert.equal(installerVersion('EPL.Tool-0.8.1.Setup.exe'), '0.8.1');
    assert.equal(installerVersion('EPL Tool-0.10.0 Setup.EXE'), '0.10.0');
  });

  it('refuses other files', () => {
    assert.equal(installerVersion('EPL Tool-0.8.1 Setup.exe.tmp'), null);
    assert.equal(installerVersion('EPL.Tool-win32-x64-0.8.1.zip'), null);
    assert.equal(installerVersion('Setup.exe'), null);
    assert.equal(installerVersion('tool-1.2.3.4 Setup.exe'), null);
    assert.equal(installerVersion(''), null);
  });
});

describe('compareVersions', () => {
  it('compares numerically, part by part', () => {
    assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
    assert.equal(compareVersions('0.6.1', '0.7.0'), -1);
    assert.equal(compareVersions('1.0', '1.0.0'), 0);
    assert.equal(compareVersions('0.7.0-beta.1', '0.7.0'), 0);
  });
});

describe('shared-database delays', () => {
  it('check more often than auto-publish', () => {
    assert.ok(CHANGE_CHECK_SECONDS > 0 && AUTO_PUBLISH_SECONDS >= CHANGE_CHECK_SECONDS);
  });

  it('are described in words', () => {
    assert.equal(describeSeconds(60), 'about a minute');
    assert.equal(describeSeconds(30), '30 seconds');
    assert.equal(describeSeconds(900), '15 minutes');
  });
});
