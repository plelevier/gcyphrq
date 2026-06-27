// Mock function extension for testing

export default {
  register(registry) {
    registry.addFunction('hello', (args) => {
      const name = args[0] ?? 'World';
      return `Hello, ${name}!`;
    });

    registry.addFunction('double', (args) => {
      const num = args[0];
      if (typeof num !== 'number') return null;
      return num * 2;
    });

    registry.addAggregation('sumOrNull', (values) => {
      const nums = values.filter(v => v != null && typeof v === 'number');
      return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) : null;
    });
  },
};
