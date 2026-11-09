import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_PUBLISH_SECONDS, CHANGE_CHECK_SECONDS, compareVersions, describeSeconds } from './sync';

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
