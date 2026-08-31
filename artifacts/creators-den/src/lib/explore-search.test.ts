import { describe, expect, it } from 'vitest';
import { matchesCreatorQuery, matchesProjectQuery } from './explore-search';
import { tandemUid } from './tandem-uid';

const creator = {
  userId: 'user_2abc123',
  displayName: 'Ada Captain',
  imageUrl: null,
  publicProjectCount: 2,
  followerCount: 1,
  isFollowing: false,
};

const project = {
  id: 'proj-1',
  ownerId: 'user_2abc123',
  name: 'The Salt Road Vlog',
  description: '90 min of interview footage.',
  status: 'IN_PRODUCTION',
  visibility: 'PUBLIC' as const,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z',
  ownerName: 'Ada Captain',
  ownerImageUrl: null,
};

describe('matchesCreatorQuery', () => {
  it('matches by display name (case-insensitive)', () => {
    expect(matchesCreatorQuery(creator, 'ada')).toBe(true);
    expect(matchesCreatorQuery(creator, 'CAPTAIN')).toBe(true);
  });

  it('matches by the raw Clerk user id', () => {
    expect(matchesCreatorQuery(creator, 'user_2abc123')).toBe(true);
    expect(matchesCreatorQuery(creator, 'user_2abc')).toBe(true);
  });

  it('matches by the derived Tandem ID', () => {
    const uid = tandemUid(creator.userId);
    expect(uid).toMatch(/^TANDEM[0-9A-Z]{5}$/);
    expect(matchesCreatorQuery(creator, uid)).toBe(true);
    expect(matchesCreatorQuery(creator, uid.toLowerCase())).toBe(true);
  });

  it('an empty query matches everything', () => {
    expect(matchesCreatorQuery(creator, '  ')).toBe(true);
  });

  it('does not match unrelated text', () => {
    expect(matchesCreatorQuery(creator, 'zoe')).toBe(false);
  });
});

describe('matchesProjectQuery', () => {
  it('matches by project name and description', () => {
    expect(matchesProjectQuery(project, 'salt road')).toBe(true);
    expect(matchesProjectQuery(project, 'interview')).toBe(true);
  });

  it('matches by owner name, raw owner id, and Tandem ID', () => {
    expect(matchesProjectQuery(project, 'ada')).toBe(true);
    expect(matchesProjectQuery(project, 'user_2abc123')).toBe(true);
    expect(matchesProjectQuery(project, tandemUid(project.ownerId))).toBe(true);
  });

  it('an empty query matches everything', () => {
    expect(matchesProjectQuery(project, '')).toBe(true);
  });

  it('does not match unrelated text', () => {
    expect(matchesProjectQuery(project, 'nothing-here')).toBe(false);
  });
});
