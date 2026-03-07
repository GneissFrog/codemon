// Simple bitmask calculation test
// Tests: NW corner ( edge tiles, corners, center tiles

// Directions: N=1, NE=2, E=4, SE=8
// S=16, SW=32, W=64
// NW=128

// Test 1: Single isolated tile (no neighbors)
const testGrid = new Array(TEST_SIZE * TEST_SIZE).fill(null);
testGrid[0] = 'grass';

const mask = 0;
console.log('Single tile bitmask:', mask);
console.log('Expected: 0 (no neighbors)');

// Test 2: NW corner tile at (0,0)
testGrid[0] = 'grass';
testGrid[10] = 'grass';
testGrid[20] = 'grass';

const mask2 = calculateBitmask(0, 0, 'grass');
console.log('Bitmask for tile at (0,0):', mask);
console.log('Binary:', mask.toString(2).padStart(8, '0'));

// Test 3: NW corner with only east/south/west neighbors
testGrid[0] = 'grass';
testGrid[10] = 'grass';
testGrid[21] = null;
testGrid[2] = 'grass';
const mask3 = calculateBitmask(0, 1, 'grass');
console.log('Bitmask for tile at (0,1):', mask);
console.log('Binary:', mask.toString(2).padStart(8, '0'));
console.log('Looking for sprite with mask:', mask, 'grass-corner-nw');

console.log('Found sprite:', spriteName);

// Test 4: Center tile surrounded by neighbors
testGrid =55] = 'grass';
const mask4 = calculateBitmask(5, 5, 'grass');
console.log('Bitmask for tile at (5,5):', mask);
console.log('Binary:', mask.toString(2).padStart(8, '0'));
console.log('Expected: 255 (all directions)');
console.log('Looking for sprite with mask:', mask, 'grass-center');
console.log('Found sprite:', spriteName);
