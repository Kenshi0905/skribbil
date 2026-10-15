// Report using normal database initialization. Never changes the live word pool automatically.
import {openDatabase} from '../server/db.mjs';
import {wordDifficulty,originalHardRatings} from '../server/word-difficulty.mjs';
const db=await openDatabase();
try {
 const samples=(await db.query(`SELECT word,difficulty_version,count(*)::int AS turns,count(DISTINCT artist_id)::int AS artists,
   sum(solved_count)::float/NULLIF(sum(electorate_size),0) AS solve_rate,
   percentile_cont(.5) WITHIN GROUP(ORDER BY median_guess_ms) AS median_ms,
   percentile_cont(.5) WITHIN GROUP(ORDER BY draw_time_ms) AS budget_ms
   FROM skribbil.drawing_turns WHERE solved_count IS NOT NULL AND electorate_size>0
   GROUP BY word,difficulty_version ORDER BY count(*) DESC`)).rows;
 console.log(JSON.stringify(samples.map(s=>({word:s.word,sourceVersion:s.difficulty_version,turns:s.turns,artists:s.artists,
   ...(originalHardRatings[s.word]?wordDifficulty({turns:s.turns,artists:s.artists,solveRate:Number(s.solve_rate),medianGuessMs:s.median_ms===null?null:Number(s.median_ms),drawTimeMs:Number(s.budget_ms),ambiguity:originalHardRatings[s.word][0],drawability:originalHardRatings[s.word][1]}):{tier:'unrated'})})),null,2));
}finally{await db.close();}
