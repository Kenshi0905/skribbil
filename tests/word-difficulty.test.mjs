import {readFileSync} from 'node:fs';
import test from 'node:test';import assert from 'node:assert/strict';
import {wordDifficulty,originalHardRatings,difficultyVersion} from '../server/word-difficulty.mjs';
const sample={turns:20,artists:5,solveRate:.9,medianGuessMs:12000,drawTimeMs:80000,ambiguity:.1,drawability:.9};
test('difficulty requires pilot evidence and separates easy and hard using measurable results',()=>{
 assert.equal(wordDifficulty(sample).tier,'easy');
 assert.equal(wordDifficulty({...sample,solveRate:.1,medianGuessMs:72000,ambiguity:.8,drawability:.2}).tier,'hard');
 assert.equal(wordDifficulty({...sample,solveRate:.5,medianGuessMs:40000,ambiguity:.5,drawability:.5}).tier,'normal');
 for(const patch of [{turns:19},{artists:4}])assert.equal(wordDifficulty({...sample,...patch}).tier,'unmeasured');
 assert.equal(wordDifficulty({...sample,solveRate:0,medianGuessMs:null}).calibrated,true);
 assert.throws(()=>wordDifficulty({...sample,ambiguity:2}));assert.equal(difficultyVersion,'pilot-v1');assert.equal(Object.keys(originalHardRatings).length,12);
});

test('editorial difficulty ratings cover exactly the original forced-hard pool',()=>{
 const source=readFileSync(new URL('../engine/internal/game/league.go',import.meta.url),'utf8');
 const match=source.match(/var hardWordsV1 = \[\]string\{([^}]+)\}/);
 assert.ok(match);const pool=JSON.parse('['+match[1]+']');
 assert.deepEqual(Object.keys(originalHardRatings).sort(),pool.sort());
});
