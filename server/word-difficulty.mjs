// Our calibration model; this is not skribbl.io's private algorithm.
export const difficultyVersion = 'pilot-v1';
export function wordDifficulty({turns,artists,solveRate,medianGuessMs,drawTimeMs,ambiguity,drawability}) {
  for (const value of [solveRate,ambiguity,drawability]) if (!Number.isFinite(value)||value<0||value>1) throw new Error('Ratings must be between 0 and 1.');
  if (!Number.isInteger(turns)||turns<0||!Number.isInteger(artists)||artists<0||!Number.isFinite(drawTimeMs)||drawTimeMs<=0||medianGuessMs!==null&&(!Number.isFinite(medianGuessMs)||medianGuessMs<0)) throw new Error('Invalid pilot sample.');
  const time = medianGuessMs===null ? 1 : Math.min(1,medianGuessMs/drawTimeMs);
  const score = .55*(1-solveRate)+.25*time+.10*ambiguity+.10*(1-drawability);
  const calibrated = turns>=20&&artists>=5;
  return {version:difficultyVersion,calibrated,score:Number(score.toFixed(4)),tier:calibrated?(score>=.65?'hard':score<=.35?'easy':'normal'):'unmeasured'};
}
// Editorial priors for the existing original hard pool, never fake pilot data.
export const originalHardRatings = Object.freeze({
 'time travel':[.8,.3], 'optical illusion':[.6,.35], photosynthesis:[.5,.5], 'continental drift':[.4,.4],
 'parallel universe':[.9,.25], 'chain reaction':[.5,.55], metamorphosis:[.4,.5], 'gravitational wave':[.7,.25],
 ecosystem:[.8,.4], 'supply and demand':[.8,.3], 'infinite loop':[.5,.5], 'magnetic field':[.5,.4],
});
