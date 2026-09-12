import { describe, expect, it } from 'vitest';
import { displayRoleEntries, rolesLabel } from './roles';

// The Members & roles card lists a teammate's crafts. Video and Audio are one
// craft on a crew list, so holding both reads as a single entry rather than two
// tags — while every other role keeps its own.

describe('roster role display', () => {
  it('collapses Video + Audio into one entry', () => {
    expect(displayRoleEntries(['VIDEO', 'AUDIO'])).toEqual([
      { key: 'VIDEO_AUDIO', label: 'Video & Audio' },
    ]);
    expect(rolesLabel(['VIDEO', 'AUDIO'])).toBe('Video & Audio');
  });

  it('keeps Video alone as Video, and Audio alone as Audio', () => {
    expect(displayRoleEntries(['VIDEO'])).toEqual([{ key: 'VIDEO', label: 'Video' }]);
    expect(displayRoleEntries(['AUDIO'])).toEqual([{ key: 'AUDIO', label: 'Audio' }]);
  });

  it('leaves the other roles untouched alongside the merged pair', () => {
    expect(displayRoleEntries(['VIDEO', 'AUDIO', 'SCRIPT', 'THUMBNAIL'])).toEqual([
      { key: 'VIDEO_AUDIO', label: 'Video & Audio' },
      { key: 'SCRIPT', label: 'Script' },
      { key: 'THUMBNAIL', label: 'Thumbnail' },
    ]);
  });

  it('reads an empty role set as Viewer', () => {
    expect(rolesLabel([])).toBe('Viewer');
    expect(rolesLabel(null)).toBe('Viewer');
    expect(displayRoleEntries(undefined)).toEqual([]);
  });
});
