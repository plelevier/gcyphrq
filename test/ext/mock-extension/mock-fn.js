// Mock function extension for testing
// Note: kept simple (no validate/helpers import) because this file is copied
// into node_modules for integration tests where relative imports would break.
// validate/helpers are fully covered by unit tests in registry.test.ts.

export default {
  register(registry) {
    registry.addFunction('hello', (args) => {
      const name = args[0];
      if (typeof name !== 'string' && args.length > 0) return null;
      return `Hello, ${name ?? 'World'}!`;
    });

    registry.addFunction('double', (args) => {
      const num = args[0];
      if (typeof num !== 'number') return null;
      return num * 2;
    });

    registry.addAggregation('sumOrNull', (values) => {
      const nums = values.filter((v) => v != null && typeof v === 'number');
      return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) : null;
    });
  },
};
