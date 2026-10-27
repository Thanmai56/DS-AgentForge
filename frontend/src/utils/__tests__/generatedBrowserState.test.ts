import { describe, expect, it } from 'vitest';
import { clearGeneratedBrowserState } from '../generatedBrowserState';

describe('clearGeneratedBrowserState', () => {
  it('removes generated data but preserves authentication and runtime identity', () => {
    const generatedKeys = [
      'activePlan',
      'activePlanId',
      'activePlanRequestId',
      'activePlanWarnings',
      'activeSampleDataSummary',
      'activeSourceEntities',
    ];

    generatedKeys.forEach((key) => sessionStorage.setItem(key, 'generated'));
    localStorage.setItem('activeRun', 'generated');
    localStorage.setItem('token', 'auth-token');
    localStorage.setItem('ds-agentforge-server-instance', 'instance-id');

    clearGeneratedBrowserState();

    generatedKeys.forEach((key) => expect(sessionStorage.getItem(key)).toBeNull());
    expect(localStorage.getItem('activeRun')).toBeNull();
    expect(localStorage.getItem('token')).toBe('auth-token');
    expect(localStorage.getItem('ds-agentforge-server-instance')).toBe('instance-id');
  });
});
