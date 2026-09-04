import { describe, expect, it } from 'vitest';
import {
  AGENT_CONTROL_PORT,
  AGENT_PROTOCOL,
  agentControlBaseUrl,
  agentLaunchUrl,
} from '@/lib/agent-bridge';

describe('agent-bridge constants', () => {
  it('uses the fixed default loopback port when VITE_AGENT_CONTROL_PORT is unset', () => {
    expect(AGENT_PROTOCOL).toBe('tandem-agent');
    expect(AGENT_CONTROL_PORT).toBe(41737);
    expect(agentControlBaseUrl()).toBe('http://127.0.0.1:41737');
  });
});

describe('agentLaunchUrl', () => {
  it('builds a bare launch link with no context', () => {
    expect(agentLaunchUrl({})).toBe('tandem-agent://launch');
  });

  it('carries the project id and return url as query params', () => {
    const url = agentLaunchUrl({
      projectId: 'proj_123',
      returnUrl: 'https://app.tandem.dev/creators-den/projects/proj_123/role/video',
    });
    expect(url).toBe(
      'tandem-agent://launch?projectId=proj_123&returnUrl=https%3A%2F%2Fapp.tandem.dev%2Fcreators-den%2Fprojects%2Fproj_123%2Frole%2Fvideo',
    );
    const parsed = new URL(url);
    expect(parsed.host).toBe('launch');
    expect(parsed.searchParams.get('projectId')).toBe('proj_123');
    expect(parsed.searchParams.get('returnUrl')).toBe(
      'https://app.tandem.dev/creators-den/projects/proj_123/role/video',
    );
  });

  it('encodes special characters in the return url', () => {
    const url = agentLaunchUrl({ projectId: 'p1', returnUrl: 'http://localhost:5175/creators-den/?a=b&c=d' });
    expect(url).toBe('tandem-agent://launch?projectId=p1&returnUrl=http%3A%2F%2Flocalhost%3A5175%2Fcreators-den%2F%3Fa%3Db%26c%3Dd');
    expect(new URL(url).searchParams.get('returnUrl')).toBe('http://localhost:5175/creators-den/?a=b&c=d');
  });

  it('omits empty context fields', () => {
    expect(agentLaunchUrl({ projectId: '', returnUrl: '' })).toBe('tandem-agent://launch');
    expect(agentLaunchUrl({ projectId: 'p1', returnUrl: '' })).toBe('tandem-agent://launch?projectId=p1');
  });
});