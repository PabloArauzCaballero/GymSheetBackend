import { CounterRegistry } from './counter-registry';

describe('CounterRegistry', () => {
  it('renders counters in Prometheus text format with escaped, sorted labels', () => {
    const registry = new CounterRegistry();
    registry.increment('signup_total', 'Signups.', { risk: 'LOW', outcome: 'accepted' });
    registry.increment('signup_total', 'Signups.', { outcome: 'accepted', risk: 'LOW' });
    registry.increment('signup_total', 'Signups.', { outcome: 'rejected', risk: 'a"b' });

    expect(registry.render()).toEqual([
      '# HELP signup_total Signups.',
      '# TYPE signup_total counter',
      'signup_total{outcome="accepted",risk="LOW"} 2',
      'signup_total{outcome="rejected",risk="a\\"b"} 1',
    ]);
  });

  it('bounds the number of series', () => {
    const registry = new CounterRegistry();
    for (let index = 0; index < 500; index += 1) registry.increment('c', 'h', { value: String(index) });
    expect(registry.render().length).toBe(2 + 200);
  });
});
