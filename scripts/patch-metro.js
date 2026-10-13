const fs = require('fs');
const path = require('path');

const targetFile = path.join(
  __dirname,
  '..',
  'node_modules',
  '@react-native',
  'community-cli-plugin',
  'dist',
  'commands',
  'start',
  'middleware.js'
);

if (fs.existsSync(targetFile)) {
  let content = fs.readFileSync(targetFile, 'utf8');
  const faultyLine =
    'communityMiddlewareFallback.indexPageMiddleware =\n    communityCliServerApi.indexPageMiddleware;';
  const fixedLine =
    'communityMiddlewareFallback.indexPageMiddleware =\n    communityCliServerApi.indexPageMiddleware ?? noopNextHandle;';

  if (content.includes(faultyLine)) {
    content = content.replace(faultyLine, fixedLine);
    fs.writeFileSync(targetFile, content, 'utf8');
    console.log('✓ Patched React Native 0.77 Metro indexPageMiddleware bug.');
  } else {
    console.log('✓ Metro middleware is already patched.');
  }
}
