import faultline from 'eslint-plugin-faultline';

export default [
  {
    files: ['src/**/*.ts'],
    plugins: { faultline },
    rules: {
      'faultline/no-raw-throw': 'warn',
    },
  },
];
