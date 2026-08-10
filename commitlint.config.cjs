module.exports = {
  parserPreset: {
    parserOpts: {
      headerPattern: /^(ARB-\d+): (\w+)(?:\(([^)]+)\))?!?: (.+)$/,
      headerCorrespondence: ['ticket', 'type', 'scope', 'subject'],
    },
  },
  rules: {
    'header-max-length': [2, 'always', 320],
    'type-enum': [
      2,
      'always',
      ['build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'revert', 'test'],
    ],
    'subject-empty': [2, 'never'],
  },
};
